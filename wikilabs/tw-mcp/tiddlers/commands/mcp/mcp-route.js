/*\
title: $:/core/modules/commands/inspect/mcp/mcp-route.js
type: application/javascript
module-type: library

Route mode: `--mcp route=<dir>` serves every tw-mcp primary running in a
subfolder of <dir>, found by its `.tw-mcp/connect` discovery file. Each tool
gains a `wiki` argument; without it a call goes to the wiki on the default
port. Calls are forwarded over the primary's pipe like a proxy's.
\*/

"use strict";

var fs = $tw.node ? require("fs") : null;
var path = $tw.node ? require("path") : null;
var net = $tw.node ? require("net") : null;

var PROTOCOL_VERSION = "2026-07-28";
var MODERN_VERSIONS = [PROTOCOL_VERSION];
var LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var LEGACY_DEFAULT_VERSION = LEGACY_VERSIONS[0];
var SUPPORTED_VERSIONS = MODERN_VERSIONS.concat(LEGACY_VERSIONS);
var SERVER_NAME = "tiddlywiki-mcp";
var CALL_TIMEOUT_MS = 120000;
var LIST_TTL_MS = 60000;
var DEFAULT_PORT = 8080;

var META_VERSION = "io.modelcontextprotocol/protocolVersion";
var META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
var META_SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId";

var LIST_WIKIS_TOOL = {
	name: "list_wikis",
	description: "Lists the TiddlyWiki servers this router can reach right now: their names, labels and HTTP ports. Pass a name, label or port as the `wiki` argument of any other tool to choose one.",
	inputSchema: { type: "object", properties: {} },
	annotations: { readOnlyHint: true }
};

/**
 * Returns the tw-mcp plugin version.
 * @returns {string} Version, or "unknown"
 */
function getServerVersion() {
	var plugin = $tw.wiki.getTiddler("$:/plugins/wikilabs/tw-mcp");
	return (plugin && plugin.fields.version) || "unknown";
}

/**
 * Tells whether a process id is alive.
 * @param {number} pid - process id
 * @returns {boolean} True if the process exists
 */
function isProcessRunning(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch(e) {
		// ESRCH: no such process; EPERM: alive but not ours, still running
		if(e.code === "EPERM") {
			return true;
		}
		if(e.code === "ESRCH") {
			return false;
		}
		throw e;
	}
}

/**
 * Lists the live primaries whose discovery file sits one folder below dir.
 * @param {string} dir - folder to scan, eg: an editions folder
 * @returns {Array<{name: string, label: (string|null), port: (number|null), listen: boolean, pid: number, pipe: string, token: string}>} Live wikis, sorted by name
 */
function scanWikis(dir) {
	var wikis = [];
	if(!fs.existsSync(dir)) {
		return wikis;
	}
	fs.readdirSync(dir, { withFileTypes: true }).forEach(function(entry) {
		if(!entry.isDirectory()) {
			return;
		}
		var file = path.join(dir, entry.name, ".tw-mcp", "connect");
		if(!fs.existsSync(file)) {
			return;
		}
		var data;
		try {
			data = JSON.parse(fs.readFileSync(file, "utf8"));
		} catch(e) {
			// A primary may be rewriting the file; skip it until the next scan
			if(e instanceof SyntaxError) {
				return;
			}
			throw e;
		}
		if(!data || !data.pid || !data.pipe || !data.token || !isProcessRunning(data.pid)) {
			return;
		}
		wikis.push({
			name: entry.name,
			label: data.label || null,
			port: data.port || null,
			listen: !!data.listen,
			pid: data.pid,
			pipe: data.pipe,
			token: data.token
		});
	});
	return wikis.sort(function(a, b) {
		return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0);
	});
}

/**
 * Picks the wiki a call goes to.
 * @param {Array<object>} wikis - live wikis from scanWikis
 * @param {string} [wanted] - name, label or port the caller asked for
 * @param {number} defaultPort - port used when nothing is asked for
 * @returns {{wiki: (object|null), error: (string|null)}} The wiki, or why none fits
 */
function pickWiki(wikis, wanted, defaultPort) {
	if(wikis.length === 0) {
		return { wiki: null, error: "No TiddlyWiki server is running. Start one with `npm start` in its edition folder, then retry." };
	}
	var names = wikis.map(describeWiki).join("\n");
	if(wanted !== undefined && wanted !== null && wanted !== "") {
		var key = String(wanted);
		var match = wikis.find(function(w) {
			return w.name === key || w.name === key.replace(/-server$/, "") || w.label === key || String(w.port) === key;
		});
		return match ? { wiki: match, error: null } : { wiki: null, error: "No running wiki matches '" + key + "'. Running:\n" + names };
	}
	var byPort = wikis.find(function(w) {
		return w.listen && w.port === defaultPort;
	});
	if(byPort) {
		return { wiki: byPort, error: null };
	}
	if(wikis.length === 1) {
		return { wiki: wikis[0], error: null };
	}
	return { wiki: null, error: "Several wikis are running and none is on port " + defaultPort + ". Name one with the `wiki` argument:\n" + names };
}

/**
 * Formats one wiki for list_wikis and error texts.
 * @param {object} wiki - live wiki from scanWikis
 * @returns {string} One line
 */
function describeWiki(wiki) {
	return "- " + wiki.name + (wiki.label ? " (label " + wiki.label + ")" : "") +
		(wiki.listen && wiki.port ? " http://localhost:" + wiki.port : " no HTTP") +
		", pid " + wiki.pid;
}

/**
 * Opens and reuses one pipe connection per primary, matching answers to calls.
 * @param {object} lib - mcp-lib exports, for the auth meta keys
 * @param {string} [label] - this router's label, sent to the primary
 * @returns {{call: function(object, object, function): void}} Pipe client
 */
function createPipeLinks(lib, label) {
	var links = {}; // pipe path -> { socket, buffer, inflight }
	var nextId = 1;

	function failAll(link, message) {
		Object.keys(link.inflight).forEach(function(id) {
			var entry = link.inflight[id];
			clearTimeout(entry.timer);
			entry.cb(new Error(message));
		});
		link.inflight = {};
	}

	function open(wiki) {
		var link = { socket: net.connect(wiki.pipe), buffer: "", inflight: {} };
		link.socket.setEncoding("utf8");
		link.socket.on("data", function(chunk) {
			link.buffer += chunk;
			var lines = link.buffer.split("\n");
			link.buffer = lines.pop();
			lines.forEach(function(line) {
				if(!line.trim()) {
					return;
				}
				var msg;
				try {
					msg = JSON.parse(line);
				} catch(e) {
					if(e instanceof SyntaxError) {
						return;
					}
					throw e;
				}
				// Broadcasts such as notifications/takeover carry no id of ours
				var entry = msg && link.inflight[msg.id];
				if(entry) {
					delete link.inflight[msg.id];
					clearTimeout(entry.timer);
					entry.cb(null, msg);
				}
			});
		});
		link.socket.on("error", function(e) {
			delete links[wiki.pipe];
			failAll(link, "Pipe to " + wiki.name + " failed: " + e.message);
		});
		link.socket.on("close", function() {
			delete links[wiki.pipe];
			failAll(link, "Pipe to " + wiki.name + " closed. The server stopped or restarted; retry.");
		});
		links[wiki.pipe] = link;
		return link;
	}

	function call(wiki, msg, cb) {
		var link = links[wiki.pipe] || open(wiki);
		var id = "route-" + (nextId++);
		var out = JSON.parse(JSON.stringify(msg));
		out.id = id;
		out.params = out.params || {};
		out.params._meta = out.params._meta || {};
		out.params._meta[lib.TW_AUTH] = wiki.token;
		out.params._meta[lib.TW_PID] = process.pid;
		if(label) {
			out.params._meta[lib.TW_LABEL] = label;
		}
		link.inflight[id] = {
			cb: cb,
			timer: setTimeout(function() {
				if(link.inflight[id]) {
					delete link.inflight[id];
					cb(new Error("No answer from " + wiki.name + " within " + CALL_TIMEOUT_MS + "ms"));
				}
			}, CALL_TIMEOUT_MS)
		};
		link.socket.write(JSON.stringify(out) + "\n");
	}

	return { call: call };
}

/**
 * Builds the route-mode dispatcher; send, scan and link are seams for tests.
 * @param {object} options - routeDir, readonly, label, defaultPort, send, scan, links
 * @returns {{dispatch: function(string): void}} Session
 */
function createRouteSession(options) {
	var handlers = require("$:/core/modules/commands/inspect/mcp-handlers.js");
	var lib = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js");
	var defaultPort = options.defaultPort || DEFAULT_PORT;
	var readonly = options.readonly !== false;
	var send = options.send || function(line) { process.stdout.write(line + "\n"); };
	var scan = options.scan || function() { return scanWikis(options.routeDir); };
	var links = options.links || createPipeLinks(lib, options.label);
	var writeToolNames = handlers.getWriteToolNames();

	function respond(id, result, era) {
		if(era !== "legacy") {
			if(result.resultType === undefined) {
				result.resultType = "complete";
			}
			result._meta = result._meta || {};
			result._meta[META_SERVER_INFO] = { name: SERVER_NAME, version: getServerVersion() };
		}
		send(JSON.stringify({ jsonrpc: "2.0", id: id, result: result }));
	}

	function fail(id, code, message, data) {
		var err = { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
		if(data !== undefined) {
			err.error.data = data;
		}
		send(JSON.stringify(err));
	}

	function textResult(text, isError) {
		var result = { content: [{ type: "text", text: text }] };
		if(isError) {
			result.isError = true;
		}
		return result;
	}

	function eraOf(parsed) {
		if(parsed.method === "server/discover") {
			return "modern";
		}
		if(parsed.method === "initialize") {
			return "legacy";
		}
		var declared = parsed.params && parsed.params._meta && parsed.params._meta[META_VERSION];
		if(declared === undefined || declared === null) {
			return "legacy";
		}
		if(MODERN_VERSIONS.includes(declared)) {
			return "modern";
		}
		return LEGACY_VERSIONS.includes(declared) ? "legacy" : null;
	}

	function toolDefinitions() {
		var wikiArg = {
			type: "string",
			description: "Which running wiki: its folder name, label or HTTP port. Default: the wiki on port " + defaultPort + ". See list_wikis."
		};
		return [LIST_WIKIS_TOOL].concat(handlers.getToolDefinitions(readonly).map(function(def) {
			var copy = JSON.parse(JSON.stringify(def));
			copy.inputSchema = copy.inputSchema || { type: "object", properties: {} };
			copy.inputSchema.properties = copy.inputSchema.properties || {};
			copy.inputSchema.properties.wiki = wikiArg;
			return copy;
		}));
	}

	function instructions() {
		var wikis = scan();
		return "TiddlyWiki MCP server — ROUTE MODE: one entry for every tw-mcp server running under " + options.routeDir + ".\n" +
			"- Every tool takes an optional `wiki` argument: a folder name, label or HTTP port. Without it, the call goes to the wiki on port " + defaultPort + ".\n" +
			"- Servers come and go; call list_wikis to see which are running now.\n" +
			(readonly ? "- READONLY mode — writes disabled.\n" : "") +
			"Running at start:\n" + (wikis.length ? wikis.map(describeWiki).join("\n") : "- none");
	}

	function callTool(parsed, id, era) {
		var name = parsed.params && parsed.params.name;
		var args = Object.assign({}, (parsed.params && parsed.params.arguments) || {});
		if(name === LIST_WIKIS_TOOL.name) {
			var wikis = scan();
			return respond(id, textResult(wikis.length ? wikis.map(describeWiki).join("\n") : "No TiddlyWiki server is running."), era);
		}
		if(!toolDefinitions().some(function(def) { return def.name === name; })) {
			if(readonly && writeToolNames[name]) {
				return respond(id, textResult("Tool '" + name + "' is disabled in readonly mode", true), era);
			}
			return fail(id, -32602, "Unknown tool: " + name);
		}
		var pick = pickWiki(scan(), args.wiki, defaultPort);
		if(!pick.wiki) {
			return respond(id, textResult(pick.error, true), era);
		}
		delete args.wiki;
		var forwarded = JSON.parse(JSON.stringify(parsed));
		forwarded.params.arguments = args;
		links.call(pick.wiki, forwarded, function(err, answer) {
			if(err) {
				return respond(id, textResult(err.message, true), era);
			}
			var reply = { jsonrpc: "2.0", id: id };
			if(answer.error) {
				reply.error = answer.error;
			} else {
				reply.result = answer.result;
			}
			send(JSON.stringify(reply));
		});
	}

	function dispatch(line) {
		var parsed;
		try {
			parsed = JSON.parse(line);
		} catch(e) {
			if(e instanceof SyntaxError) {
				return fail(null, -32700, "Parse error");
			}
			throw e;
		}
		if(parsed.id === undefined || parsed.id === null) {
			return; // notifications need no reply
		}
		var id = parsed.id;
		var era = eraOf(parsed);
		if(era === null) {
			return fail(id, -32022, "Unsupported protocol version",
				{ supported: SUPPORTED_VERSIONS, requested: parsed.params._meta[META_VERSION] });
		}
		switch(parsed.method) {
			case "initialize": {
				var requested = (parsed.params && parsed.params.protocolVersion) || null;
				return respond(id, {
					protocolVersion: LEGACY_VERSIONS.includes(requested) ? requested : LEGACY_DEFAULT_VERSION,
					capabilities: { tools: {} },
					serverInfo: { name: SERVER_NAME, version: getServerVersion() },
					instructions: instructions()
				}, era);
			}
			case "server/discover":
				return respond(id, {
					supportedVersions: SUPPORTED_VERSIONS,
					capabilities: { tools: {} },
					instructions: instructions()
				}, era);
			case "ping":
				if(era === "legacy") {
					return respond(id, {}, era);
				}
				return fail(id, -32601, "Method not found: " + parsed.method);
			case "subscriptions/listen": {
				// The tool list never changes, so no notification type is honoured
				var ack = { notifications: {}, _meta: {} };
				ack._meta[META_SUBSCRIPTION_ID] = id;
				return send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/subscriptions/acknowledged", params: ack }));
			}
			case "tools/list": {
				var listResult = { tools: toolDefinitions() };
				if(era === "modern") {
					listResult.ttlMs = LIST_TTL_MS;
					listResult.cacheScope = "private";
				}
				return respond(id, listResult, era);
			}
			case "tools/call":
				return callTool(parsed, id, era);
			default:
				return fail(id, -32601, "Method not found: " + parsed.method);
		}
	}

	return { dispatch: dispatch };
}

/**
 * Starts route mode on stdio.
 * @param {object} options - routeDir, readonly, label, defaultPort
 * @returns {void}
 */
function startRouteMode(options) {
	var session = createRouteSession(options);
	var buffer = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", function(chunk) {
		buffer += chunk;
		var lines = buffer.split("\n");
		buffer = lines.pop();
		lines.forEach(function(line) {
			if(line.trim()) {
				session.dispatch(line.trim());
			}
		});
	});
	process.stdin.on("end", function() {
		process.exit(0);
	});
	var wikis = scanWikis(options.routeDir);
	console.error("[tw-mcp route] " + options.routeDir + " (" + (options.readonly !== false ? "READONLY" : "readwrite") + "), " + wikis.length + " wiki(s) running" +
		(wikis.length ? ": " + wikis.map(function(w) { return w.name; }).join(", ") : ""));
}

exports.startRouteMode = startRouteMode;
// Test seams: the dispatcher and target choice without a running primary.
exports.createRouteSession = createRouteSession;
exports.pickWiki = pickWiki;
exports.scanWikis = scanWikis;
