/*\
title: $:/core/modules/commands/inspect/mcp/mcp-lib.js
type: application/javascript
module-type: library

Zero-dependency MCP (Model Context Protocol) server for TiddlyWiki.
Implements JSON-RPC 2.0 over stdio transport.

\*/

"use strict";

// Node-only modules — guard so this library loads cleanly in the browser
// (where it's exposed via plugin payload but only ever called server-side).
var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null,
	net = $tw.node ? require("net") : null,
	crypto = $tw.node ? require("crypto") : null;

var handlers = require("$:/core/modules/commands/inspect/mcp-handlers.js");

var PROTOCOL_VERSION = "2026-07-28";
var MODERN_VERSIONS = [PROTOCOL_VERSION];

// Handshake-era revisions, still served. The trigger is not a legacy client:
// a DUAL-era client falls back to initialize when server/discover does not
// answer inside its own probe window, and a slow wiki boot is enough to cause
// that. Measured 2026-08-16 — a cold tw5.com boot took 18.6s to reach
// startMCPServer, the client had already fallen back, and answering -32022 to
// the fallback turned a slow start into a hard connection failure.
var LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var LEGACY_DEFAULT_VERSION = LEGACY_VERSIONS[0];

var SUPPORTED_VERSIONS = MODERN_VERSIONS.concat(LEGACY_VERSIONS);
var SERVER_NAME = "tiddlywiki-mcp";
var PLUGIN_TITLE = "$:/plugins/wikilabs/tw-mcp";

// Spec-defined _meta keys. 2026-07-28 has no handshake, so a request carries
// its own version and identity and a result carries the server's.
var META_VERSION = "io.modelcontextprotocol/protocolVersion";
var META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
var META_CLIENT_CAPS = "io.modelcontextprotocol/clientCapabilities";
var META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

// tw-mcp's own pipe-transport metadata. Statelessness removes the single
// initialize that used to carry the token and identify the connecting process,
// so every message over the pipe now carries both.
var TW_AUTH = "wikilabs.tw-mcp/auth";
var TW_PID = "wikilabs.tw-mcp/pid";
var TW_LABEL = "wikilabs.tw-mcp/label";
var TW_ROLE = "wikilabs.tw-mcp/role";

var RELOAD_FILE_METHOD = "wikilabs.tw-mcp/reloadFile";
var LSP_HELLO_METHOD = "wikilabs.tw-mcp/lspHello";
var UNREADABLE_CODES = ["EBUSY", "EPERM", "EACCES", "ENOENT"];

// Freshness hint for list results. Deliberately short: the tool list is not
// static here, since it varies with readonly mode and reload_mcp_modules can
// change it mid-process, and we advertise no listChanged notification.
var LIST_TTL_MS = 60000;

function getServerVersion() {
	var pluginTiddler = $tw.wiki.getTiddler(PLUGIN_TITLE);
	return (pluginTiddler && pluginTiddler.fields.version) || "0.0.0";
}

var readonlyMode = false;
var allowedPaths = null; // null = no restriction, array of absolute paths = restrict output to these directories
var authToken = null; // generated at startup for pipe transport authentication
var serverLabel = null; // optional user-defined label to identify this instance
var pipeClients = {}; // clientId -> { send, socket } — authenticated pipe clients
var currentPipeServer = null; // reference to the active net.Server for the pipe
var takeoverInProgress = false; // guard against concurrent takeover requests
var lspClients = {}; // clientId -> what an editor's LSP process said about itself

// --- Path validation helpers ---

function isPathAllowed(targetPath) {
	if(!allowedPaths || allowedPaths.length === 0) {
		return true;
	}
	// Normalize separators for consistent comparison (Windows can mix / and \)
	var resolved = path.resolve(targetPath).replace(/\\/g, "/");
	for(var i = 0; i < allowedPaths.length; i++) {
		var allowed = path.resolve(allowedPaths[i]).replace(/\\/g, "/");
		// Ensure allowed ends without trailing slash for consistent prefix matching
		if(allowed.length > 1 && allowed.charAt(allowed.length - 1) === "/") {
			allowed = allowed.slice(0, -1);
		}
		// Check that target is inside or equal to an allowed directory
		if(resolved === allowed || resolved.indexOf(allowed + "/") === 0) {
			return true;
		}
	}
	return false;
}

function checkPathAllowed(targetPath) {
	if(!isPathAllowed(targetPath)) {
		process.stderr.write("[tw-mcp] BLOCKED path: " + path.resolve(targetPath) + " | allowed: " + allowedPaths.join(", ") + "\n");
		return {
			isError: true,
			content: [{ type: "text", text: "Path not allowed: " + path.resolve(targetPath) + ". Allowed directories: " + allowedPaths.join(", ") }]
		};
	}
	return null;
}

// --- JSON-RPC helpers ---

function serverIdentity() {
	return { name: SERVER_NAME, version: getServerVersion() };
}

// The _meta of an inbound request, or an empty object when it carries none.
function getMeta(parsed) {
	return (parsed && parsed.params && parsed.params._meta) || {};
}

// A proxy front-end is itself a client of the primary, so its own requests must
// declare version and identity exactly like any other client's.
function buildRequestMeta() {
	var params = { _meta: {} };
	params._meta[META_VERSION] = PROTOCOL_VERSION;
	params._meta[META_CLIENT_INFO] = serverIdentity();
	// Empty rather than absent: a proxy front-end relays, so it declares no
	// capabilities of its own. A relayed client message keeps the client's.
	params._meta[META_CLIENT_CAPS] = {};
	return params;
}

// Under 2026-07-28 every result MUST carry resultType and SHOULD identify the
// server, so both are stamped here rather than at each call site. A
// handshake-era result carries neither: it has no resultType in its schema and
// it was already given the server's identity once, at initialize. Era defaults
// to modern so a call site that omits it cannot silently downgrade a response.
function jsonrpcResponse(id, result, era) {
	var payload = result || {};
	if(era !== "legacy") {
		if(payload.resultType === undefined) {
			payload.resultType = "complete";
		}
		payload._meta = payload._meta || {};
		payload._meta[META_SERVER_INFO] = serverIdentity();
	}
	return JSON.stringify({ jsonrpc: "2.0", id: id, result: payload });
}

function jsonrpcError(id, code, message, data) {
	var err = { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
	if(data !== undefined) {
		err.error.data = data;
	}
	return JSON.stringify(err);
}

// Returns null when the line is not valid JSON. A SyntaxError is the one
// anticipated failure here; anything else is a bug and must propagate rather
// than be silently reinterpreted as "unparseable".
function parseJsonRpc(line) {
	try {
		return JSON.parse(line);
	} catch(e) {
		if(e instanceof SyntaxError) {
			return null;
		}
		throw e;
	}
}

// --- MCP Server ---

// --- Shared message dispatcher (used by stdio and pipe transports) ---

function log(msg) {
	var now = new Date();
	var ts = now.toISOString().slice(11, 23);
	process.stderr.write("[tw-mcp " + ts + "] " + msg + "\n");
}

// Shorten pipe paths after the first mention so repeated log lines stay readable.
var pipePathFullyShown = false;
function fmtPipe(p) {
	if(!p) return p;
	if(!pipePathFullyShown) {
		pipePathFullyShown = true;
		return p;
	}
	var idx = p.lastIndexOf("tiddlywiki-mcp-");
	if(idx < 0) return p;
	var tail = p.slice(idx + "tiddlywiki-mcp-".length);
	if(tail.length > 24) {
		tail = "…" + tail.slice(-22);
	}
	return "pipe:" + tail;
}

// Suppress the redundant "Initialized" log for pipe clients — the auth log already covers it.
var suppressNextInitLog = false;

// Readonly is the default but surprising — most expect RW from a debug tool.
// Render READONLY prominently so users notice when writes are disabled.
function fmtMode() {
	return "mode: " + (readonlyMode ? "READONLY" : "readwrite");
}

// Modern clients identify themselves per request, so there is no stored session
// to name them from — read it off whichever message we happen to be handling.
// A handshake-era client puts the same thing in params.clientInfo instead, and
// only once, on initialize.
function describeClient(parsed) {
	var info = getMeta(parsed)[META_CLIENT_INFO] || (parsed && parsed.params && parsed.params.clientInfo);
	if(info && info.name) {
		return info.name + (info.version ? " " + info.version : "");
	}
	return "unidentified client";
}

// Which revision a message belongs to: "modern", "legacy", or null when it
// declares a version we do not speak.
//
// This stays a pure function of the message, so serving two eras adds no
// per-connection state — which matters, because the pipe transport multiplexes
// clients and 2026-07-28 removed the handshake that per-connection state used
// to hang off. A modern request declares its version in _meta; a handshake-era
// one has nowhere to put it, so an ABSENT version means legacy rather than an
// error. server/discover is the era probe itself and is always answered as
// modern, since a client that speaks it needs no handshake.
function eraOfMessage(parsed) {
	if(parsed.method === "server/discover") {
		return "modern";
	}
	if(parsed.method === "initialize") {
		return "legacy";
	}
	var declared = getMeta(parsed)[META_VERSION];
	if(declared === undefined || declared === null) {
		return "legacy";
	}
	if(MODERN_VERSIONS.indexOf(declared) >= 0) {
		return "modern";
	}
	if(LEGACY_VERSIONS.indexOf(declared) >= 0) {
		return "legacy";
	}
	return null;
}

// Rolling history of recent requests so we can identify what was cancelled.
// Map: requestId -> { method, toolName, at }
var requestHistory = Object.create(null);
var requestHistoryOrder = [];
var REQUEST_HISTORY_SIZE = 50;

function recordRequest(id, method, toolName) {
	if(id === undefined || id === null) return;
	requestHistory[id] = { method: method, toolName: toolName, at: Date.now() };
	requestHistoryOrder.push(id);
	while(requestHistoryOrder.length > REQUEST_HISTORY_SIZE) {
		var old = requestHistoryOrder.shift();
		delete requestHistory[old];
	}
}

function describeRequest(id) {
	var entry = requestHistory[id];
	if(!entry) return "unknown (id=" + id + ")";
	var elapsed = Date.now() - entry.at;
	var name = entry.toolName ? entry.method + " " + entry.toolName : entry.method;
	return name + " (id=" + id + ", " + elapsed + "ms ago)";
}

// --- Confirmation gate (MRTR) ---

// Tools whose blast radius is invisible in their arguments. A filter string
// does not tell anyone it resolves to 43 tiddlers, so these are confirmed
// against the RESOLVED set instead of the arguments. Tools whose argument IS
// the consequence (delete_tiddler names one title) are deliberately absent:
// the client already prompts for them and would only ask the same thing twice.
var CONFIRM_TOOLS = { replace_in_tiddlers: true };
var CONFIRM_THRESHOLD = 1; // confirm when MORE than this many tiddlers change
var CONFIRM_KEY = "confirm_bulk_write";
var CONFIRM_TTL_MS = 5 * 60 * 1000;
var CONFIRM_TITLE_SAMPLE = 20;

// Per-process secret. requestState travels through the client, which the spec
// treats as attacker-controlled, so it is signed and verified on return.
var confirmSecret = crypto ? crypto.randomBytes(32) : null;

function signRequestState(payload) {
	var body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
	return body + "." + crypto.createHmac("sha256", confirmSecret).update(body).digest("hex");
}

// Valid only if the signature holds, the TTL has not lapsed, AND the impact
// digest still matches. A target set that shifted between round trips fails
// here, which forces a fresh confirmation rather than applying to a set the
// user never saw.
function verifyRequestState(state, expectedDigest) {
	if(typeof state !== "string") return false;
	var parts = state.split(".");
	if(parts.length !== 2) return false;
	var expectedMac = Buffer.from(crypto.createHmac("sha256", confirmSecret).update(parts[0]).digest("hex"), "utf8");
	var actualMac = Buffer.from(parts[1], "utf8");
	if(expectedMac.length !== actualMac.length || !crypto.timingSafeEqual(expectedMac, actualMac)) {
		return false;
	}
	var payload = JSON.parse(Buffer.from(parts[0], "base64").toString("utf8"));
	return payload.exp > Date.now() && payload.digest === expectedDigest;
}

function impactDigest(toolName, toolArgs, titles) {
	return crypto.createHash("sha256").update(JSON.stringify({
		tool: toolName,
		rules: toolArgs.rules,
		filter: toolArgs.filter,
		fields: toolArgs.fields,
		titles: titles.slice().sort()
	}), "utf8").digest("hex");
}

function confirmMessage(titles, impact) {
	var shown = titles.slice(0, CONFIRM_TITLE_SAMPLE);
	var more = titles.length - shown.length;
	return "Apply " + impact.totalReplacements + " replacement(s) across " + titles.length + " tiddlers?\n\n" +
		shown.join("\n") + (more > 0 ? "\n... and " + more + " more" : "") +
		(impact.truncated ? "\n\n(the preview was truncated by a limit, so more may match)" : "");
}

// Returns true when it has answered the request itself and the caller must not
// run the tool. Returns false to let the call proceed normally.
function confirmationHandled(parsed, toolName, toolArgs, id, send) {
	if(!CONFIRM_TOOLS[toolName] || !crypto) return false;
	// dry_run defaults true, so only an explicit apply is destructive.
	if(toolArgs.dry_run !== false) return false;
	// The spec forbids sending an input request a client has not declared.
	// Without elicitation there is no way to ask, so behaviour is unchanged.
	var caps = getMeta(parsed)[META_CLIENT_CAPS];
	if(!caps || !caps.elicitation) return false;

	// Resolve the real impact by previewing. This is what we confirm against.
	var previewArgs = $tw.utils.extend({}, toolArgs);
	previewArgs.dry_run = true;
	var preview = handlers.handleToolCall(toolName, previewArgs);
	var impact = preview && preview.structuredContent;
	if(!impact || !impact.affectedTitles || impact.affectedTitles.length <= CONFIRM_THRESHOLD) {
		return false; // narrow enough to need no confirmation
	}

	var digest = impactDigest(toolName, toolArgs, impact.affectedTitles);
	var responses = parsed.params && parsed.params.inputResponses;
	var answer = responses && responses[CONFIRM_KEY];
	if(answer && verifyRequestState(parsed.params && parsed.params.requestState, digest)) {
		if(answer.action === "accept" && answer.content && answer.content.confirm === true) {
			return false; // confirmed against this exact set — proceed
		}
		send(jsonrpcResponse(id, {
			isError: true,
			content: [{ type: "text", text: toolName + ": cancelled, not confirmed. Nothing was written." }]
		}));
		return true;
	}

	var request = { method: "elicitation/create", params: {
		mode: "form",
		message: confirmMessage(impact.affectedTitles, impact),
		requestedSchema: {
			type: "object",
			properties: { confirm: { type: "boolean", description: "Apply these changes" } },
			required: ["confirm"]
		}
	}};
	var result = { resultType: "input_required", inputRequests: {}, requestState: signRequestState({
		digest: digest,
		exp: Date.now() + CONFIRM_TTL_MS
	})};
	result.inputRequests[CONFIRM_KEY] = request;
	send(jsonrpcResponse(id, result));
	return true;
}

// The guidance a client is given about this wiki. Both eras hand it over, one
// on server/discover and one on initialize, so it lives in one place.
function buildInstructions() {
	return "TiddlyWiki MCP server." +
		(readonlyMode ? " READONLY mode — writes disabled." : "") +
		($tw.wiki.getTiddler("$:/temp/mcp/html-import") && $tw.wiki.getTiddler("$:/temp/mcp/html-import").fields.status === "pending" ?
			"\n\n## HTML import pending\n" +
			"$:/temp/mcp/html-import staged but not on disk. Read it for analysis, let user review/edit $:/config/FileSystemPaths, then call extract_html_wiki."
			: "") +
		"\n\n## Safety\n" +
		"- Never write tiddlers without explicit user request (create/edit/update/delete/rename/tag/untag). 'list','show','find','search' = read-only.\n" +
		"- Bulk ops: list affected tiddlers and confirm first.\n" +
		"- get_tiddler before overwriting.\n" +
		"\n## System tiddlers\n" +
		"- Default-exclude '$:/' — prepend '!is[system]' to filters unless user asks for system/shadow tiddlers.\n" +
		"- Shadow fallback: if 2-3 searches return empty, retry with '[all[shadows+tiddlers]]'. Many important tiddlers are shadows.\n" +
		"- Don't fetch '$:/core/modules/...' unless user names one.\n" +
		"\n## Token use\n" +
		"- Tool results are pre-formatted; pass through, don't reformat.\n" +
		"- Render/filter/wiki-info → MCP. Code search → Read/Grep/Glob.\n" +
		"\n## Tool choice (trigger words)\n" +
		"- WRITE (create/edit/update/change/fix/delete/rename/tag/untag): get_tiddler(detailed=true) → edit_tiddler for small edits (LINE#HASH anchors), put_tiddler for new tiddlers or full rewrites.\n" +
		"- READ (show/list/find/search/what/how many/which): get_tiddler(detailed=true); format='tid' only when plain text needed.\n" +
		"- RENDER (render/preview/'what does X look like'): render_tiddler (whole), render_field (one field), render_text (raw wikitext). get_tiddler returns SOURCE, not rendered output.\n" +
		"- put_tiddler resends full text — never use for small edits.\n" +
		"- Omit type when it's text/vnd.tiddlywiki (default).\n" +
		"\n## Filters\n" +
		"- Narrow first: '[!is[system]search[x]]'. Shadows: '[all[shadows+tiddlers]prefix[$:/config/]]'.\n" +
		"\n## Single-file HTML wiki import\n" +
		"- import_html_wiki(path) into an empty wiki folder, then extract_html_wiki() once user approves FileSystemPaths.\n" +
		"\n## Hot reload (no server restart)\n" +
		"- Edition tiddlers on disk → reload_tiddlers (scope='tiddlers').\n" +
		"- Non-JS plugin subtiddler in tw-mcp → reload_mcp_modules. Other plugins: user re-adds plugin tiddler so TW auto-reloads.\n" +
		"- tw-mcp JS handler → reload_mcp_modules (disk re-read + JS re-exec).\n" +
		"- mcp.js / mcp-lib.js / shared.js / filesystem.js → full server restart.";
}

function dispatchMessage(line, send) {
	var parsed;
	try {
		parsed = JSON.parse(line);
	} catch(e) {
		send(jsonrpcError(null, -32700, "Parse error"));
		return;
	}

	// Notifications have no id — no response needed
	if(parsed.id === undefined || parsed.id === null) {
		if(parsed.method === "notifications/initialized") {
			log("Client initialized");
		} else if(parsed.method === "notifications/cancelled") {
			var params = parsed.params || {};
			var reason = params.reason || "no reason given";
			log("Request cancelled: " + describeRequest(params.requestId) + " — reason: " + reason);
		} else if(parsed.method === "notifications/takeover-request") {
			handleTakeoverRequest(parsed.params);
		}
		return;
	}

	var id = parsed.id;
	var method = parsed.method;
	var toolName = (method === "tools/call" && parsed.params) ? parsed.params.name : null;
	recordRequest(id, method, toolName);

	// A message that names a version we do not speak is refused in both eras.
	// An ABSENT version is not that case — it is how a handshake-era client
	// looks — so eraOfMessage reports legacy for it rather than null.
	var era = eraOfMessage(parsed);
	if(era === null) {
		send(jsonrpcError(id, -32022, "Unsupported protocol version",
			{ supported: SUPPORTED_VERSIONS, requested: getMeta(parsed)[META_VERSION] || null }));
		return;
	}
	switch(method) {
		case "initialize": {
			// The handshake spec says to echo the requested version when we speak
			// it and to name one we do speak otherwise, letting the client decide
			// whether to continue. A client arriving here has already given up on
			// server/discover, so refusing it strands the connection.
			var requested = (parsed.params && parsed.params.protocolVersion) || null;
			var negotiated = LEGACY_VERSIONS.indexOf(requested) >= 0 ? requested : LEGACY_DEFAULT_VERSION;
			send(jsonrpcResponse(id, {
				protocolVersion: negotiated,
				capabilities: { tools: {} },
				serverInfo: serverIdentity(),
				instructions: buildInstructions()
			}, era));
			log("Initialized by " + describeClient(parsed) + " (protocol " + negotiated + ", " + fmtMode() + ")");
			break;
		}

		case "server/discover":
			send(jsonrpcResponse(id, {
				supportedVersions: SUPPORTED_VERSIONS,
				capabilities: {
					tools: {}
				},
				instructions: buildInstructions()
			}, era));
			if(suppressNextInitLog) {
				suppressNextInitLog = false;
			} else {
				log("Discovered by " + describeClient(parsed) + " (protocol " + PROTOCOL_VERSION + ", " + fmtMode() + ")");
			}
			break;

		case "ping":
			// 2026-07-28 removed ping, but every handshake-era revision has it and
			// a legacy client may use it as a liveness check. Answer it for those
			// and keep it absent for modern ones, rather than serving one method
			// under two contradicting contracts.
			if(era === "legacy") {
				send(jsonrpcResponse(id, {}, era));
			} else {
				send(jsonrpcError(id, -32601, "Method not found: " + method));
			}
			break;

		case "tools/list": {
			// ttlMs and cacheScope are required on 2026-07-28 list results.
			// private, because the list is specific to this wiki and this readonly
			// mode and must never be reused by a shared intermediary. Neither
			// field exists in the handshake era, so neither is sent there.
			var listResult = { tools: handlers.getToolDefinitions(readonlyMode) };
			if(era === "modern") {
				listResult.ttlMs = LIST_TTL_MS;
				listResult.cacheScope = "private";
			}
			send(jsonrpcResponse(id, listResult, era));
			break;
		}

		case "tools/call": {
			var toolName = parsed.params && parsed.params.name;
			var toolArgs = (parsed.params && parsed.params.arguments) || {};
			if(confirmationHandled(parsed, toolName, toolArgs, id, send)) {
				break;
			}
			var result = handlers.handleToolCall(toolName, toolArgs);
			if(result === null) {
				send(jsonrpcError(id, -32602, "Unknown tool: " + toolName));
			} else {
				send(jsonrpcResponse(id, result, era));
			}
			break;
		}

		// Not MCP: the LSP process an editor started holds its own copy of this wiki
		// and names a file it saved, so the browser and tools here see the save too.
		case RELOAD_FILE_METHOD: {
			var savedPath = parsed.params && parsed.params.path;
			if(typeof savedPath !== "string" || !savedPath) {
				send(jsonrpcError(id, -32602, RELOAD_FILE_METHOD + " needs a path"));
				break;
			}
			send(reloadSavedFile(id, path.resolve(savedPath), era));
			break;
		}

		default:
			send(jsonrpcError(id, -32601, "Method not found: " + method));
			break;
	}
}

// A file still being written or already gone is answered as an error, so the
// server keeps serving; anything else is a bug and propagates.
function reloadSavedFile(id, filepath, era) {
	var watch = require("$:/core/modules/commands/inspect/lsp/lsp-watch.js"),
		titles;
	try {
		titles = watch.fileChanged(filepath);
	} catch(err) {
		if(!UNREADABLE_CODES.includes(err.code)) {
			throw err;
		}
		return jsonrpcError(id, -32603, "Could not read " + filepath + ": " + err.message);
	}
	if(titles && titles.length) {
		log("Reloaded " + titles.join(", ") + " saved in the editor");
	}
	return jsonrpcResponse(id, { titles: titles }, era);
}

// --- Stream handler for newline-delimited JSON-RPC ---

var MAX_BUFFER_SIZE = 100 * 1024 * 1024; // 100MB — generous limit for base64 uploads

function attachStreamHandler(input, send, onClose, customDispatch) {
	var dispatch = customDispatch || function(line, sendFn) { dispatchMessage(line, sendFn); };
	var buffer = "";
	input.setEncoding("utf8");
	input.on("data", function(chunk) {
		buffer += chunk;
		if(buffer.length > MAX_BUFFER_SIZE) {
			log("Buffer overflow — message exceeds " + (MAX_BUFFER_SIZE / 1024 / 1024) + "MB, dropping connection");
			buffer = "";
			input.destroy();
			return;
		}
		var lines = buffer.split("\n");
		buffer = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if(line) {
				dispatch(line, send);
			}
		}
	});
	input.on("end", function() {
		if(onClose) {
			onClose();
		}
	});
}

// --- Named pipe transport ---

// Resolve the canonical wiki path by following includeWikis to the root.
// e.g. tw5.com-server includes ../tw5.com → canonical path is tw5.com.
// The pipe name and discovery file are based on this so all editions converge.
function getCanonicalWikiPath() {
	var wikiPath = $tw.boot.wikiPath;
	if(!wikiPath) {
		return null;
	}
	try {
		var infoPath = path.resolve(wikiPath, "tiddlywiki.info");
		var info = JSON.parse(fs.readFileSync(infoPath, "utf8"));
		if(info.includeWikis && info.includeWikis.length > 0) {
			var first = info.includeWikis[0];
			var includePath = typeof first === "string" ? first : first.path;
			return path.resolve(wikiPath, includePath);
		}
	} catch(e) {
		// tiddlywiki.info doesn't exist or is unreadable
	}
	return wikiPath;
}

function getPipePath() {
	var canonical = getCanonicalWikiPath() || "default";
	if(process.platform === "win32") {
		// Windows named pipe — use wiki path hash for uniqueness
		var wikiId = canonical.replace(/[^a-zA-Z0-9]/g, "-");
		return "\\\\.\\pipe\\tiddlywiki-mcp-" + wikiId;
	} else {
		// Unix domain socket in the canonical wiki directory
		return path.resolve(canonical, ".mcp.sock");
	}
}

function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch(e) {
		return false;
	}
}

function cleanStaleDiscoveryFile() {
	var canonical = getCanonicalWikiPath();
	if(!canonical) {
		return;
	}
	var discoveryFile = path.resolve(canonical, ".tw-mcp", "connect");
	try {
		var raw = fs.readFileSync(discoveryFile, "utf8");
		var data = JSON.parse(raw);
		if(data.pid && !isProcessRunning(data.pid)) {
			log("Removing stale .tw-mcp/connect (PID " + data.pid + " is no longer running)");
			fs.unlinkSync(discoveryFile);
		}
	} catch(e) {
		// Ignore — file doesn't exist or is unreadable
	}
}

function tryReadDiscovery(wikiPath) {
	var discoveryFile = path.resolve(wikiPath, ".tw-mcp", "connect");
	try {
		var raw = fs.readFileSync(discoveryFile, "utf8");
		var data = JSON.parse(raw);
		if(data.pid && data.pipe && data.token && isProcessRunning(data.pid)) {
			return data;
		}
	} catch(e) {
		// File doesn't exist or is unreadable
	}
	return null;
}

function readDiscoveryFile() {
	if(!$tw.boot.wikiPath) {
		return null;
	}
	// includeWikis path takes precedence (shared editions converge here)
	var canonical = getCanonicalWikiPath();
	if(canonical !== $tw.boot.wikiPath) {
		var result = tryReadDiscovery(canonical);
		if(result) {
			return result;
		}
	}
	// Fall back to own wiki directory
	return tryReadDiscovery($tw.boot.wikiPath);
}

function probeAndCleanPipe(pipePath, callback) {
	// Clean up stale discovery files left by hard-killed processes
	cleanStaleDiscoveryFile();
	// Try connecting to the pipe to see if another server is alive.
	// callback(err) — err is null if the pipe is available, or an Error if another server owns it.
	var probe = net.createConnection(pipePath, function() {
		// Connection succeeded — another server is alive
		probe.destroy();
		callback(new Error("Another MCP server is already listening on " + pipePath));
	});
	probe.on("error", function(err) {
		// Connection failed — pipe is stale or doesn't exist
		if(process.platform !== "win32") {
			// On Unix, remove the stale socket file
			try {
				fs.unlinkSync(pipePath);
			} catch(e) {
				// Ignore — file doesn't exist
			}
		}
		callback(null);
	});
	// Short timeout so startup isn't delayed
	probe.setTimeout(1000, function() {
		probe.destroy();
		callback(null);
	});
}

function broadcastToClients(message) {
	var ids = Object.keys(pipeClients);
	for(var i = 0; i < ids.length; i++) {
		var client = pipeClients[ids[i]];
		client.send(message);
	}
}

function startPipeServer() {
	var pipePath = getPipePath();

	var pipeServer = net.createServer(function(socket) {
		var clientId = "pipe-" + Date.now();
		var clientSuffix = ""; // will be set to " @<label>[role]" after auth

		var send = function(msg) {
			if(!socket.destroyed) {
				socket.write(msg + "\n");
			}
		};

		// Statelessness removes the one initialize that used to carry the token,
		// so EVERY message must present it. The registry is keyed to the socket,
		// which is still a real connection even though the protocol above it is
		// not: identity is recorded from the first message that authenticates.
		var authenticated = false;
		var authenticatedDispatch = function(line, sendFn) {
			var parsed;
			try {
				parsed = JSON.parse(line);
			} catch(e) {
				sendFn(jsonrpcError(null, -32700, "Parse error"));
				return;
			}
			var meta = getMeta(parsed);
			var replyId = (parsed.id === undefined) ? null : parsed.id;
			var clientToken = meta[TW_AUTH];
			if(!clientToken || typeof clientToken !== "string") {
				sendFn(jsonrpcError(replyId, -32600, "Authentication failed: missing " + TW_AUTH + " in _meta"));
				socket.destroy();
				return;
			}
			// Constant-time comparison to prevent timing attacks
			var tokenBuf = Buffer.from(authToken, "utf8");
			var clientBuf = Buffer.from(clientToken, "utf8");
			if(tokenBuf.length !== clientBuf.length || !crypto.timingSafeEqual(tokenBuf, clientBuf)) {
				sendFn(jsonrpcError(replyId, -32600, "Authentication failed: invalid token"));
				log("Auth failed for client " + clientId + " — invalid token" + clientSuffix);
				socket.destroy();
				return;
			}
			if(!authenticated) {
				authenticated = true;
				// Append PID to clientId, keep label/role separate so they're always last
				var clientPid = meta[TW_PID];
				var clientLabel = meta[TW_LABEL];
				var clientRole = meta[TW_ROLE];
				if(clientPid) {
					clientId = clientId + " (PID " + clientPid + ")";
				}
				if(clientLabel) {
					clientSuffix = " @" + clientLabel;
				}
				if(clientRole) {
					clientSuffix = clientSuffix + " [" + clientRole + "]";
				}
				log("Client ready: " + clientId + clientSuffix + " (protocol " + PROTOCOL_VERSION + ", " + fmtMode() + ")");
				// Register in client registry for broadcast
				pipeClients[clientId] = { send: sendFn, socket: socket };
				// Suppress the redundant per-client discovery log — the line above already covers it
				suppressNextInitLog = true;
			}
			if(handlePipeNotification(clientId, parsed)) {
				// An LSP process sends no discovery, so nothing is left to suppress.
				suppressNextInitLog = false;
				return;
			}
			dispatchMessage(line, sendFn);
		};

		attachStreamHandler(socket, send, function() {
			delete pipeClients[clientId];
			forgetPipeClient(clientId);
			log("Client gone: " + clientId + clientSuffix);
		}, authenticatedDispatch);

		socket.on("error", function(err) {
			delete pipeClients[clientId];
			forgetPipeClient(clientId);
			log("Client error: " + clientId + clientSuffix + " — " + err.message);
		});
	});

	pipeServer.on("error", function(err) {
		if(err.code === "EADDRINUSE") {
			log("Pipe already in use: " + fmtPipe(pipePath) + " — another MCP server may be running for this wiki");
		} else {
			log("Pipe server error: " + err.message);
		}
	});

	// Cleanup: close pipe server and remove discovery file if we created it (PID check)
	var canonical = getCanonicalWikiPath();
	function cleanup() {
		pipeServer.close();
		if(canonical) {
			var cleanupFile = path.resolve(canonical, ".tw-mcp", "connect");
			try {
				var raw = fs.readFileSync(cleanupFile, "utf8");
				var data = JSON.parse(raw);
				if(data.pid === process.pid) {
					fs.unlinkSync(cleanupFile);
				}
			} catch(e) {
				// Ignore — file doesn't exist or is unreadable
			}
		}
		if(process.platform !== "win32") {
			try {
				fs.unlinkSync(pipePath);
			} catch(e) {
				// Ignore
			}
		}
	}
	process.on("exit", cleanup);
	process.on("SIGINT", function() { cleanup(); process.exit(0); });
	process.on("SIGTERM", function() { cleanup(); process.exit(0); });

	// Probe the pipe before listening — detect if another server already owns it
	probeAndCleanPipe(pipePath, function(probeErr) {
		if(probeErr) {
			log(probeErr.message);
			log("Pipe transport disabled — stdio transport is still active");
			return;
		}
		pipeServer.listen(pipePath, function() {
			log("Pipe server listening: " + fmtPipe(pipePath));
			// Restrict socket permissions on Unix to owner only
			if(process.platform !== "win32") {
				try {
					fs.chmodSync(pipePath, 0o600);
				} catch(e) {
					log("Warning: could not restrict socket permissions: " + e.message);
				}
			}
			// Write discovery file to the canonical wiki path so all editions converge
			var writePrimaryDiscovery = function() {
				writeDiscoveryFile({ pipe: pipePath, token: authToken, pid: process.pid, label: serverLabel || undefined, listen: !!$tw.httpServer, port: listeningPort() });
			};
			writePrimaryDiscovery();
			// The editor's LSP process links to the browser through this port, which exists only once HTTP listens.
			if($tw.httpServer && !listeningPort()) {
				$tw.httpServer.nodeServer.once("listening", writePrimaryDiscovery);
			}
		});
	});

	return pipeServer;
}

// An editor's LSP process says who it is, so get_wiki_info can list it; true when the message was that hello.
function handlePipeNotification(clientId, parsed) {
	if(parsed.method !== LSP_HELLO_METHOD) {
		return false;
	}
	var info = Object.assign({}, parsed.params);
	delete info._meta;
	if(!lspClients[clientId]) {
		log("LSP client: " + describeLspClient(info));
	}
	lspClients[clientId] = info;
	return true;
}

function forgetPipeClient(clientId) {
	if(lspClients[clientId]) {
		log("LSP client gone: " + describeLspClient(lspClients[clientId]));
		delete lspClients[clientId];
	}
}

function describeLspClient(info) {
	return (info.client || "an editor") + " (PID " + info.pid + ", " + (info.transport || "pipe") + ")" + (info.label ? " @" + info.label : "") + (info.wiki ? " on " + info.wiki : "");
}

function listLspClients() {
	return Object.keys(lspClients).map(function(clientId) {
		return lspClients[clientId];
	});
}

function listeningPort() {
	var address = $tw.httpServer && $tw.httpServer.nodeServer && $tw.httpServer.nodeServer.address();
	return address && address.port ? address.port : undefined;
}

// --- Takeover: primary steps down, new primary takes over ---

function writeDiscoveryFile(data) {
	var canonical = getCanonicalWikiPath();
	if(!canonical) {
		return;
	}
	var mcpDir = path.resolve(canonical, ".tw-mcp");
	var discoveryFile = path.resolve(mcpDir, "connect");
	try {
		$tw.utils.createDirectory(mcpDir);
		fs.writeFileSync(discoveryFile, JSON.stringify(data), { encoding: "utf8", mode: 0o600 });
	} catch(e) {
		log("Warning: could not write .tw-mcp/connect discovery file: " + e.message);
	}
}

function handleTakeoverRequest(params) {
	if(takeoverInProgress) {
		log("Takeover already in progress, ignoring request from PID " + params.pid);
		return;
	}
	if(!params || !params.pid) {
		log("Invalid takeover-request: missing params");
		return;
	}
	takeoverInProgress = true;
	log("Takeover requested by PID " + params.pid + (params.label ? " @" + params.label : ""));

	// Broadcast takeover notification to all pipe clients so they know to reconnect
	var notification = JSON.stringify({
		jsonrpc: "2.0",
		method: "notifications/takeover",
		params: { pid: params.pid, label: params.label }
	});
	broadcastToClients(notification);

	// Remove discovery file so the new primary can write its own
	var canonical = getCanonicalWikiPath();
	if(canonical) {
		try {
			fs.unlinkSync(path.resolve(canonical, ".tw-mcp", "connect"));
		} catch(e) {
			// Ignore
		}
	}

	// Close our pipe server after a short delay to flush broadcasts.
	// The new primary will start its pipe server on the now-free path.
	// Then we'll read its discovery file and connect as proxy.
	setTimeout(function() {
		// Destroy all client sockets so proxies detect the disconnect
		var ids = Object.keys(pipeClients);
		for(var i = 0; i < ids.length; i++) {
			var client = pipeClients[ids[i]];
			if(client.socket && !client.socket.destroyed) {
				client.socket.destroy();
			}
		}
		pipeClients = {};
		if(currentPipeServer) {
			currentPipeServer.close();
			currentPipeServer = null;
		}

		// Wait for new primary to write its discovery file, then connect as proxy
		waitForNewPrimary(params.pid);
	}, 100);
}

function waitForNewPrimary(expectedPid) {
	var attempts = 0;
	var maxAttempts = 30; // 3 seconds max
	function check() {
		attempts++;
		var discovery = readDiscoveryFile();
		if(discovery && discovery.pid === expectedPid) {
			log("New primary discovered (PID " + discovery.pid + "), connecting as proxy");
			transitionToProxy(discovery);
			return;
		}
		if(attempts < maxAttempts) {
			setTimeout(check, 100);
		} else {
			log("Timed out waiting for new primary (PID " + expectedPid + "), staying as primary");
			takeoverInProgress = false;
			// Re-start pipe server since we closed ours
			currentPipeServer = startPipeServer();
			$tw.mcp.role = "primary";
		}
	}
	check();
}

// stdinRelay: swappable function ref for stdin dispatch — set by startAsPrimary,
// swapped by transitionToProxy to relay mode
var stdinRelay = null;

function transitionToProxy(newPrimary) {
	log("Stepping down to PROXY → new primary (PID " + newPrimary.pid + ") at " + fmtPipe(newPrimary.pipe) + (newPrimary.label ? " @" + newPrimary.label : ""));
	$tw.mcp.role = "proxy";
	takeoverInProgress = false;

	// Connect to new primary's pipe
	var proxySocket = net.createConnection(newPrimary.pipe, function() {
		log("Transition: connected to new primary");
		// There is no handshake to authenticate with, so the message that
		// registers us with the new primary is an ordinary server/discover
		// carrying auth. The former-primary role marks us as the one stepping
		// down rather than a freshly started proxy.
		var initMsg = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			id: "transition-init",
			method: "server/discover",
			params: buildRequestMeta()
		}), newPrimary.token, serverLabel, "former-primary");
		proxySocket.write(initMsg + "\n");
		// Flush any pending stdin lines
		for(var i = 0; i < pendingRelay.length; i++) {
			proxySocket.write(pendingRelay[i] + "\n");
		}
		pendingRelay = [];
		proxyConnected = true;
	});

	proxySocket.setEncoding("utf8");
	var proxyConnected = false;
	var pendingRelay = [];
	var proxyBuffer = "";

	// Relay: new primary pipe → stdout
	proxySocket.on("data", function(chunk) {
		proxyBuffer += chunk;
		var lines = proxyBuffer.split("\n");
		proxyBuffer = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if(line) {
				// Suppress the initialize response we sent for auth
				try {
					var msg = JSON.parse(line);
					if(msg.id === "transition-init") {
						continue;
					}
				} catch(e) {
					// pass through
				}
				process.stdout.write(line + "\n");
			}
		}
	});

	proxySocket.on("error", function(err) {
		log("Transition proxy: pipe error — " + err.message);
	});

	proxySocket.on("end", function() {
		log("Transition proxy: new primary disconnected, exiting");
		process.exit(1);
	});

	// Swap stdin dispatch to relay mode
	stdinRelay = function(line) {
		var modified = injectAuth(line, newPrimary.token, serverLabel);
		if(proxyConnected && proxySocket && !proxySocket.destroyed) {
			proxySocket.write(modified + "\n");
		} else {
			pendingRelay.push(modified);
		}
	};
}

// --- Proxy mode helpers ---

// Stamps the token on EVERY relayed message rather than only the first, because
// the primary now re-checks it per request. A message without it is rejected.
function injectAuth(line, token, label, role) {
	var msg = parseJsonRpc(line);
	if(!msg) {
		return line; // not valid JSON, let the primary reject it
	}
	msg.params = msg.params || {};
	msg.params._meta = msg.params._meta || {};
	msg.params._meta[TW_AUTH] = token;
	msg.params._meta[TW_PID] = process.pid;
	if(label) {
		msg.params._meta[TW_LABEL] = label;
	}
	if(role) {
		msg.params._meta[TW_ROLE] = role;
	}
	return JSON.stringify(msg);
}

function startProxyMode(discovery) {
	var pipePath = discovery.pipe;
	var token = discovery.token;
	var pipeSocket = null;
	var connected = false;
	var pendingStdio = [];
	var discoverId = null;
	var initializeId = null; // handshake-era counterpart of discoverId
	var toolsListIds = {}; // track tools/list request ids for readonly filtering
	// Build write tool name set for readonly enforcement (discovered from
	// the handler definitions' write flag)
	var writeToolNames = handlers.getWriteToolNames();

	var takingOver = false; // true when we received a takeover notification (other proxies)
	var initiatedTakeover = false; // true when WE requested the takeover
	var takeoverStartedAt = 0; // ms timestamp for elapsed-time reporting
	var currentPrimaryPid = discovery.pid;

	$tw.mcp.role = "proxy";
	log("Server started as PROXY (PID " + process.pid + ", " + fmtMode() + ") → primary (PID " + discovery.pid + ") at " + fmtPipe(pipePath) + (serverLabel ? " @" + serverLabel : ""));

	// A relayed answer comes from the primary, not from us — say so, so the
	// client's logs name the process that actually holds the wiki.
	function annotateProxyOrigin(info) {
		info.proxy = true;
		info.primaryPid = discovery.pid;
		info.primaryLabel = discovery.label || null;
	}

	// --- Pipe connection to primary ---
	var proxyAuthenticated = false; // true after our self-init is ack'd
	var selfInitId = "proxy-init-" + Date.now();

	pipeSocket = net.createConnection(pipePath, function() {
		connected = true;
		log("Proxy: connected to primary");
		// Our own server/discover both authenticates us with the primary's pipe
		// and confirms it is alive, which is what the self-init used to do.
		var selfInit = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			id: selfInitId,
			method: "server/discover",
			params: buildRequestMeta()
		}), token, serverLabel);
		pipeSocket.write(selfInit + "\n");
		// Flush buffered client messages (the client's own discover is a second one — harmless)
		for(var i = 0; i < pendingStdio.length; i++) {
			pipeSocket.write(pendingStdio[i] + "\n");
		}
		pendingStdio = [];
	});

	pipeSocket.setEncoding("utf8");

	// Relay: pipe -> stdout
	var pipeBuffer = "";
	pipeSocket.on("data", function(chunk) {
		pipeBuffer += chunk;
		var lines = pipeBuffer.split("\n");
		pipeBuffer = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if(line) {
				// Intercept takeover notification
				try {
					var notification = JSON.parse(line);
					if(notification.method === "notifications/takeover" && notification.params) {
						if(notification.params.pid === process.pid) {
							// We initiated this takeover — ignore our own notification
							continue;
						}
						takingOver = true;
						log("Proxy: takeover notification — new primary is PID " + notification.params.pid + (notification.params.label ? " @" + notification.params.label : ""));
						// Don't reconnect yet — wait for pipe disconnect + new discovery file
						continue; // don't forward to client
					}
				} catch(e) {
					// Not valid JSON — pass through
				}
				// Suppress our self-init response and trigger takeover if applicable
				if(!proxyAuthenticated) {
					try {
						var selfResp = JSON.parse(line);
						if(selfResp.id === selfInitId) {
							proxyAuthenticated = true;
							log("Proxy: authenticated with primary");
							if($tw.httpServer && !takingOver) {
								setTimeout(initiateTakeover, 0);
							}
							continue; // don't forward self-init response to client
						}
					} catch(e) {}
				}
				// Intercept responses that need proxy-side modification
				if(discoverId !== null || initializeId !== null || (readonlyMode && Object.keys(toolsListIds).length > 0)) {
					try {
						var resp = JSON.parse(line);
						if(resp.id !== undefined) {
							// Annotate the discover response with proxy info. Under
							// 2026-07-28 serverInfo lives in _meta, because there is no
							// handshake result to carry it.
							if(resp.id === discoverId && resp.result && resp.result._meta && resp.result._meta[META_SERVER_INFO]) {
								annotateProxyOrigin(resp.result._meta[META_SERVER_INFO]);
								discoverId = null;
								line = JSON.stringify(resp);
							}
							// Same annotation for the handshake era, where the client
							// learns who answered from the initialize result instead.
							if(resp.id === initializeId && resp.result && resp.result.serverInfo) {
								annotateProxyOrigin(resp.result.serverInfo);
								initializeId = null;
								line = JSON.stringify(resp);
							}
							// Filter write tools from tools/list response when proxy is readonly
							if(readonlyMode && toolsListIds[resp.id] && resp.result && resp.result.tools) {
								resp.result.tools = resp.result.tools.filter(function(t) {
									return !writeToolNames[t.name];
								});
								delete toolsListIds[resp.id];
								line = JSON.stringify(resp);
							}
						}
					} catch(e) {
						// Not valid JSON — pass through
					}
				}
				process.stdout.write(line + "\n");
			}
		}
	});

	pipeSocket.on("error", function(err) {
		log("Proxy: pipe error — " + err.message);
		handlePrimaryDisconnect();
	});

	pipeSocket.on("end", function() {
		log("Proxy: primary disconnected" + (initiatedTakeover ? " (stepping up)" : ""));
		handlePrimaryDisconnect();
	});

	function handlePrimaryDisconnect() {
		connected = false;
		pipeSocket = null;
		if(initiatedTakeover) {
			becomePrimary();
			return;
		}
		if(takingOver) {
			// We received a takeover notification — wait for new discovery file
			waitForNewDiscovery();
			return;
		}
		// Check if a new primary appeared (e.g. takeover we missed)
		var newDiscovery = readDiscoveryFile();
		if(newDiscovery && newDiscovery.pid !== currentPrimaryPid) {
			log("Proxy: primary changed, reconnecting to new primary (PID " + newDiscovery.pid + ")");
			reconnectToNewPrimary(newDiscovery);
			return;
		}
		log("Proxy: primary is gone, exiting");
		process.exit(1);
	}

	function reconnectToNewPrimary(params) {
		// Disconnect from old primary
		if(pipeSocket && !pipeSocket.destroyed) {
			pipeSocket.destroy();
		}
		pipePath = params.pipe;
		token = params.token;
		currentPrimaryPid = params.pid;
		connected = false;
		takingOver = false;

		// Connect to new primary
		pipeSocket = net.createConnection(params.pipe, function() {
			connected = true;
			log("Proxy: reconnected to new primary (PID " + params.pid + ")");
			// Flush any pending messages. They were stamped with the previous
			// primary's token, which this one would reject, so re-stamp them.
			for(var i = 0; i < pendingStdio.length; i++) {
				pipeSocket.write(injectAuth(pendingStdio[i], params.token, serverLabel) + "\n");
			}
			pendingStdio = [];
		});

		pipeSocket.setEncoding("utf8");

		// Re-wire pipe data relay (reuse existing pipeBuffer)
		pipeBuffer = "";
		pipeSocket.on("data", function(chunk) {
			pipeBuffer += chunk;
			var lines = pipeBuffer.split("\n");
			pipeBuffer = lines.pop();
			for(var i = 0; i < lines.length; i++) {
				var line = lines[i].trim();
				if(line) {
					// Check for further takeover
					try {
						var notification = JSON.parse(line);
						if(notification.method === "notifications/takeover" && notification.params) {
							takingOver = true;
							log("Proxy: takeover notification — reconnecting to new primary (PID " + notification.params.pid + ")");
							reconnectToNewPrimary(notification.params);
							return;
						}
					} catch(e) {}
					process.stdout.write(line + "\n");
				}
			}
		});

		pipeSocket.on("error", function(err) {
			log("Proxy: pipe error — " + err.message);
			handlePrimaryDisconnect();
		});

		pipeSocket.on("end", function() {
			log("Proxy: primary disconnected");
			handlePrimaryDisconnect();
		});

		// Re-authenticate with the new primary the same way: a plain
		// server/discover carrying the new primary's token.
		var initMsg = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			id: "reconnect-init-" + Date.now(),
			method: "server/discover",
			params: buildRequestMeta()
		}), params.token, serverLabel);

		if(connected) {
			pipeSocket.write(initMsg + "\n");
		} else {
			pendingStdio.push(initMsg);
		}
	}

	// --- Takeover initiation (when this proxy also runs --listen) ---

	function waitForNewDiscovery() {
		var attempts = 0;
		var maxAttempts = 30;
		function check() {
			attempts++;
			var newDiscovery = readDiscoveryFile();
			if(newDiscovery && newDiscovery.pid !== currentPrimaryPid) {
				log("Proxy: new primary found (PID " + newDiscovery.pid + "), reconnecting");
				reconnectToNewPrimary(newDiscovery);
				return;
			}
			if(attempts < maxAttempts) {
				setTimeout(check, 100);
			} else {
				log("Proxy: timed out waiting for new primary, exiting");
				process.exit(1);
			}
		}
		check();
	}

	function initiateTakeover() {
		initiatedTakeover = true;
		takeoverStartedAt = Date.now();
		log("── Takeover initiated ──");
		log("   reason: --listen (HTTP server) detected in this process");
		log("   old primary: PID " + currentPrimaryPid);
		log("   new primary: PID " + process.pid + (serverLabel ? " @" + serverLabel : ""));

		// Send takeover request to current primary. It needs the token like any
		// other message now — an unauthenticated one gets the socket destroyed.
		var request = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			method: "notifications/takeover-request",
			params: {
				pid: process.pid,
				label: serverLabel
			}
		}), token, serverLabel);
		if(connected && pipeSocket && !pipeSocket.destroyed) {
			pipeSocket.write(request + "\n");
		}
	}

	// Called when pipe disconnects during takeover — old primary has stepped down
	function becomePrimary() {
		log("Old primary stepped down, becoming PRIMARY");
		// Generate auth token and init handlers
		authToken = crypto.randomBytes(32).toString("hex");
		if(!allowedPaths && $tw.boot.wikiPath) {
			var canonical = getCanonicalWikiPath() || $tw.boot.wikiPath;
			allowedPaths = [
				$tw.boot.wikiTiddlersPath || path.resolve(canonical, "tiddlers"),
				path.resolve(canonical, "files"),
				path.resolve(canonical, "output"),
				path.resolve($tw.boot.wikiPath, "tiddlers"),
				path.resolve($tw.boot.wikiPath, "files"),
				path.resolve($tw.boot.wikiPath, "output")
			];
		}
		handlers.init({
			readonlyMode: readonlyMode,
			checkPathAllowed: checkPathAllowed
		});

		// Start pipe server on the now-free path
		currentPipeServer = startPipeServer();

		// Swap stdin from relay to dispatch mode
		proxyStdinHandler = function(line) {
			dispatchMessage(line, stdioSend);
		};
		$tw.mcp.role = "primary";
		log("Server started as PRIMARY (PID " + process.pid + ")" + (serverLabel ? " @" + serverLabel : ""));
		var elapsed = Date.now() - takeoverStartedAt;
		log("── Takeover complete (" + elapsed + "ms) ──");
	}

	// --- Relay: stdin -> pipe (swappable via proxyStdinHandler for takeover) ---
	var proxyStdinHandler = relayToPrimary;
	var stdioSend = function(msg) {
		process.stdout.write(msg + "\n");
	};
	var stdioBuffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", function(chunk) {
		stdioBuffer += chunk;
		var lines = stdioBuffer.split("\n");
		stdioBuffer = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if(line) {
				proxyStdinHandler(line);
			}
		}
	});
	process.stdin.on("end", function() {
		log("stdin closed, shutting down");
		if(pipeSocket && !pipeSocket.destroyed) {
			pipeSocket.destroy();
		}
		process.exit(0);
	});

	function relayToPrimary(line) {
		var modified = injectAuth(line, token, serverLabel);
		// Inspect requests that need proxy-side handling. This runs OUTSIDE any
		// catch on purpose: the readonly block below decides whether a write
		// call reaches the primary, and the early return is the only thing that
		// stops it. Swallowing a throw from here would forward the very call we
		// just refused.
		var msg = parseJsonRpc(line);
		if(msg && msg.id !== undefined) {
			if(msg.method === "server/discover") {
				discoverId = msg.id;
			}
			if(msg.method === "initialize") {
				initializeId = msg.id;
			}
			// Track tools/list requests for readonly filtering of responses
			if(readonlyMode && msg.method === "tools/list") {
				toolsListIds[msg.id] = true;
			}
			// Block write tool calls locally when proxy is readonly
			if(readonlyMode && msg.method === "tools/call") {
				var toolName = msg.params && msg.params.name;
				if(toolName && writeToolNames[toolName]) {
					// The refusal is ours, not the primary's, so it must be shaped
					// for whichever era the client is speaking.
					var errResp = jsonrpcResponse(msg.id, {
						isError: true,
						content: [{ type: "text", text: "Tool '" + toolName + "' is disabled in readonly mode" }]
					}, eraOfMessage(msg));
					process.stdout.write(errResp + "\n");
					return; // don't forward to primary
				}
			}
		}
		if(connected && pipeSocket && !pipeSocket.destroyed) {
			pipeSocket.write(modified + "\n");
		} else {
			pendingStdio.push(modified);
		}
	}
}

// --- MCP Server entry point ---

function startAsPrimary(options) {
	// Generate auth token for pipe transport (256-bit random hex)
	authToken = crypto.randomBytes(32).toString("hex");
	// Default allowed paths: wiki's tiddlers/, files/, and output/ subdirectories
	if(options.allowedPaths) {
		allowedPaths = options.allowedPaths;
	} else if($tw.boot.wikiPath) {
		var canonical = getCanonicalWikiPath() || $tw.boot.wikiPath;
		var pathSet = {};
		var paths = [
			$tw.boot.wikiTiddlersPath || path.resolve(canonical, "tiddlers"),
			path.resolve(canonical, "files"),
			path.resolve(canonical, "output"),
			path.resolve($tw.boot.wikiPath, "tiddlers"),
			path.resolve($tw.boot.wikiPath, "files"),
			path.resolve($tw.boot.wikiPath, "output")
		];
		allowedPaths = [];
		for(var pi = 0; pi < paths.length; pi++) {
			var resolved = path.resolve(paths[pi]);
			if(!pathSet[resolved]) {
				pathSet[resolved] = true;
				allowedPaths.push(resolved);
			}
		}
	} else {
		allowedPaths = null;
	}

	// Initialize handlers with shared state
	handlers.init({
		readonlyMode: readonlyMode,
		checkPathAllowed: checkPathAllowed
	});

	// stdio transport — uses stdinRelay indirection so transitionToProxy can swap to relay mode
	var stdioSend = function(msg) {
		process.stdout.write(msg + "\n");
	};
	stdinRelay = null; // reset; when null, dispatch normally
	attachStreamHandler(process.stdin, stdioSend, function() {
		log("stdin closed, shutting down");
		process.exit(0);
	}, function(line, sendFn) {
		if(stdinRelay) {
			stdinRelay(line);
		} else {
			dispatchMessage(line, sendFn);
		}
	});

	// Named pipe transport
	currentPipeServer = startPipeServer();

	$tw.mcp.role = "primary";
	log("Server started as PRIMARY (v" + getServerVersion() + ", PID " + process.pid + ", protocol " + PROTOCOL_VERSION + " +legacy, " + fmtMode() + ", filesystem: " + !!$tw.syncadaptor + ")" + (serverLabel ? " @" + serverLabel : ""));
	if(allowedPaths) {
		log("Allowed paths:\n  - " + allowedPaths.join("\n  - "));
	}
}

// Detect IDE-spawned process and derive a workspace tag so instances launched
// from different VSCode windows are distinguishable in logs and heartbeats.
function deriveIDEWorkspaceTag() {
	var env = process.env;
	var fromIDE = !!(env.VSCODE_PID || env.VSCODE_IPC_HOOK || env.TERM_PROGRAM === "vscode" || env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT);
	if(!fromIDE) {
		return null;
	}
	var tag = path.basename(process.cwd());
	var wikiPath = $tw && $tw.boot && $tw.boot.wikiPath;
	if(wikiPath) {
		var wikiBase = path.basename(path.resolve(wikiPath));
		if(wikiBase && wikiBase !== tag) {
			tag = tag + "/" + wikiBase;
		}
	}
	return tag || null;
}

function startMCPServer(options) {
	options = options || {};
	readonlyMode = !!options.readonly;
	serverLabel = options.label || null;
	var ideTag = deriveIDEWorkspaceTag();
	if(ideTag) {
		serverLabel = serverLabel ? (serverLabel + ":" + ideTag) : ideTag;
	}

	// Expose MCP state on $tw so other commands (e.g. --listen) can discover it
	$tw.mcp = {
		pid: process.pid,
		label: serverLabel,
		role: null,
		readonly: readonlyMode,
		version: getServerVersion(),
		started: Date.now(),
		lspClients: listLspClients,
		heartbeat: function() {
			return {
				pid: process.pid,
				role: $tw.mcp.role,
				label: $tw.mcp.label,
				version: getServerVersion(),
				uptime: Date.now() - $tw.mcp.started,
				readonly: $tw.mcp.readonly
			};
		}
	};

	// Check for an existing primary server via the discovery file
	var discovery = readDiscoveryFile();
	if(discovery) {
		// Verify the primary is actually reachable via pipe
		var probe = net.createConnection(discovery.pipe, function() {
			probe.destroy();
			startProxyMode(discovery);
		});
		probe.on("error", function() {
			log("Discovery file exists but pipe is unreachable — becoming primary");
			cleanStaleDiscoveryFile();
			startAsPrimary(options);
		});
		probe.setTimeout(1000, function() {
			probe.destroy();
			log("Pipe probe timed out — becoming primary");
			cleanStaleDiscoveryFile();
			startAsPrimary(options);
		});
		return;
	}

	startAsPrimary(options);
}

exports.startMCPServer = startMCPServer;
exports.readDiscoveryFile = readDiscoveryFile;
exports.getCanonicalWikiPath = getCanonicalWikiPath;
// Test seam. The protocol contract (discovery, version gate, result shape) is
// worth pinning without standing up a transport to reach it.
exports.dispatchMessage = dispatchMessage;
exports.RELOAD_FILE_METHOD = RELOAD_FILE_METHOD;
exports.LSP_HELLO_METHOD = LSP_HELLO_METHOD;
exports.handlePipeNotification = handlePipeNotification;
exports.forgetPipeClient = forgetPipeClient;
exports.listLspClients = listLspClients;
exports.TW_AUTH = TW_AUTH;
exports.TW_PID = TW_PID;
exports.TW_LABEL = TW_LABEL;
