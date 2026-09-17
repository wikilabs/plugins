/*\
title: $:/core/modules/commands/inspect/mcp/mcp-pear.js
type: application/javascript
module-type: library

Pear-mode backend: `--mcp pear=<accountDir>` serves a RUNNING Facets (Pear)
app instead of this process's wiki. The account dir's discovery file
(mcp.json, written by the app while its mcp.flag is set) names a same-user
OS pipe; every tool call is forwarded over it as an NDJSON bridge frame
({v:1,id,cmd,args} -> {id,ok,result|error}). This process's own wiki is only
the plugin host — no local handlers, no HTTP, no primary/proxy machinery.

Every tool runs the REAL tw-mcp handler inside the app's headless TW engine
over the member's composed bag+staging view — full feature parity with the
node server (ruled 2026-07-17). Write tools are admitted only at rw scope;
their persistence leaves the engine through the persist seam (shared.init
persist/remove hooks) and routes through the app's bag/staging path, so
staging gates them like member saves.
\*/

"use strict";

var fs = $tw.node ? require("fs") : null;
var path = $tw.node ? require("path") : null;
var net = $tw.node ? require("net") : null;
var os = $tw.node ? require("os") : null;
var ncrypto = $tw.node ? require("crypto") : null;

var PROTOCOL_VERSION = "2026-07-28";
var MODERN_VERSIONS = [PROTOCOL_VERSION];

// Handshake-era revisions, still served for the same reason as in mcp-lib.js:
// a dual-era client falls back to initialize when server/discover does not
// answer inside its probe window, and refusing that fallback turns a slow
// start into a hard connection failure.
var LEGACY_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"];
var LEGACY_DEFAULT_VERSION = LEGACY_VERSIONS[0];

var SUPPORTED_VERSIONS = MODERN_VERSIONS.concat(LEGACY_VERSIONS);
var SERVER_NAME = "tiddlywiki-mcp";
var CALL_TIMEOUT_MS = 20000;

// Spec-defined _meta keys. The revision has no handshake, so a request carries
// its own version and a result carries the server's identity.
var META_VERSION = "io.modelcontextprotocol/protocolVersion";
var META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";
var META_SUBSCRIPTION_ID = "io.modelcontextprotocol/subscriptionId";

// Freshness hint for tools/list. Short, because the advertised set depends on
// whether the app is reachable and on the scope the handshake settled on.
var LIST_TTL_MS = 30000;

// Every tool forwards VERBATIM (feature parity, ruled 2026-07-17): the app
// runs the real tw-mcp handler in its headless engine over the composed
// bag+staging view and the pre-formatted text passes through. Write tools
// are admitted only at rw scope; their persistence routes through the app's
// bag/staging path (the persist seam).
var PEAR_READ_TOOLS = ["get_wiki_info", "list_tiddlers", "get_tiddler", "run_filter", "render_tiddler", "render_text",
	"search_lines", "get_tiddlers", "render_field", "inspect_tree", "inspect_pos", "inspect_tw", "inspect_scope"];
var PEAR_WRITE_TOOLS = ["put_tiddler", "delete_tiddler", "edit_tiddler", "rename_tiddler", "replace_in_tiddlers"];

// This client's own ed25519 identity for `agent` mode (concept 12
// §Authorization). Persisted per-user so an approval sticks across restarts.
// node's ed25519 is RFC 8032 and verifies under the app's libsodium (measured).
function loadOrCreateAgentKey() {
	var dir = path.join(os.homedir(), ".tw-mcp");
	var file = path.join(dir, "agent-key.json");
	try {
		var jwk = JSON.parse(fs.readFileSync(file, "utf8"));
		return {
			priv: ncrypto.createPrivateKey({ key: jwk, format: "jwk" }),
			pubHex: Buffer.from(jwk.x, "base64url").toString("hex")
		};
	} catch(e) {}
	var pair = ncrypto.generateKeyPairSync("ed25519");
	var privJwk = pair.privateKey.export({ format: "jwk" });
	try {
		fs.mkdirSync(dir, { recursive: true });
		fs.writeFileSync(file, JSON.stringify(privJwk), { mode: 0o600 });
	} catch(e) {}
	return {
		priv: pair.privateKey,
		pubHex: Buffer.from(pair.publicKey.export({ format: "jwk" }).x, "base64url").toString("hex")
	};
}
function signChallenge(priv, challengeHex) {
	return ncrypto.sign(null, Buffer.from(challengeHex, "hex"), priv).toString("hex");
}

function getServerVersion() {
	var plugin = $tw.wiki.getTiddler("$:/plugins/wikilabs/tw-mcp");
	return (plugin && plugin.fields.version) || "unknown";
}

// Under 2026-07-28 every result must carry resultType and should identify the
// server, so both are stamped here rather than at each call site. A
// handshake-era result carries neither: it got the identity at initialize.
function jsonrpcResponse(id, result, era) {
	var payload = result || {};
	if(era !== "legacy") {
		if(payload.resultType === undefined) {
			payload.resultType = "complete";
		}
		payload._meta = payload._meta || {};
		payload._meta[META_SERVER_INFO] = { name: SERVER_NAME, version: getServerVersion() };
	}
	return JSON.stringify({ jsonrpc: "2.0", id: id, result: payload });
}

// Which revision a message belongs to: "modern", "legacy", or null when it
// names a version we do not speak. Pure function of the message, so no
// per-connection state is needed. See eraOfMessage in mcp-lib.js.
function eraOfMessage(parsed) {
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
	if(MODERN_VERSIONS.indexOf(declared) >= 0) {
		return "modern";
	}
	if(LEGACY_VERSIONS.indexOf(declared) >= 0) {
		return "legacy";
	}
	return null;
}

function jsonrpcError(id, code, message, data) {
	var err = { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
	if(data !== undefined) {
		err.error.data = data;
	}
	return JSON.stringify(err);
}

function textResult(msg) {
	return { content: [{ type: "text", text: msg }] };
}

function errorResult(msg) {
	return { isError: true, content: [{ type: "text", text: msg }] };
}

function log(msg) {
	console.error("[tw-mcp pear] " + msg);
}

// The app side of pear mode: the pipe, the frames and the scope the handshake
// settled on. Split from the dispatcher (bead tw-mcp-server-i1k) because
// reaching it means dialling a running app, which a test cannot do; everything
// the protocol contract turns on lives in createPearSession instead.
// onHandshake fires whenever a handshake settles, so the session can tell a
// subscribed client that the tool list changed under it.
function createPearBridge(pearDir, options) {
	options = options || {};
	var onHandshake = options.onHandshake || function() {};

	// --- the pipe client (lazy connect, reconnect per call, per-call timeout) ---
	var sock = null;
	var sockBuf = "";
	var nextFrameId = 1;
	var inflight = {}; // frame id -> { cb, timer }
	var authState = "none"; // none | full-trust | authenticated | pending | denied
	var authScope = "ro";
	var agentKey = null; // { priv, pubHex } — lazy, agent mode only
	var connState = "idle"; // idle | connecting | open — single-flight connect
	var connWaiters = [];
	var readyWaiters = []; // single-flight handshake
	var handshakeInFlight = false;
	function effectiveRw() {
		return (authScope === "rw") && (authState === "full-trust" || authState === "authenticated");
	}

	function readDiscovery() {
		try {
			return JSON.parse(fs.readFileSync(path.join(pearDir, "mcp.json"), "utf8"));
		} catch(e) {
			return null;
		}
	}
	function failInflight(err) {
		for(var id in inflight) {
			var entry = inflight[id];
			delete inflight[id];
			clearTimeout(entry.timer);
			entry.cb(err);
		}
	}
	function flushConn(err) {
		var w = connWaiters; connWaiters = [];
		if(err) connState = "idle";
		for(var i = 0; i < w.length; i++) w[i](err);
	}
	// single-flight: concurrent callers share ONE socket (a naive guard would
	// open a socket per pipelined request and race the handshake)
	function connect(cb) {
		if(connState === "open" && sock) return cb(null);
		connWaiters.push(cb);
		if(connState === "connecting") return;
		connState = "connecting";
		var disco = readDiscovery();
		if(!disco || !disco.pipe) {
			return flushConn(new Error("Facets app not reachable — no discovery file at " + path.join(pearDir, "mcp.json") + ". Is the app running with mcp.flag set?"));
		}
		var s = net.connect(disco.pipe);
		var settled = false;
		s.on("connect", function() {
			settled = true;
			sock = s;
			sockBuf = "";
			connState = "open";
			flushConn(null);
		});
		s.on("data", function(chunk) {
			sockBuf += chunk.toString();
			var nl;
			while((nl = sockBuf.indexOf("\n")) >= 0) {
				var line = sockBuf.slice(0, nl);
				sockBuf = sockBuf.slice(nl + 1);
				if(!line.trim()) continue;
				var msg;
				try { msg = JSON.parse(line); } catch(e) { continue; }
				var entry = inflight[msg.id];
				if(entry) {
					delete inflight[msg.id];
					clearTimeout(entry.timer);
					entry.cb(null, msg);
				}
			}
		});
		s.on("error", function(e) {
			if(!settled) {
				settled = true;
				sock = null;
				flushConn(new Error("Facets pipe connect failed (" + e.message + ") — the app may have exited; restart it and retry"));
			} else {
				sock = null;
				failInflight(new Error("Facets pipe error: " + e.message));
			}
		});
		s.on("close", function() {
			sock = null;
			connState = "idle";
			authState = "none"; // re-enroll on the next connection
			failInflight(new Error("Facets pipe closed — the app exited or restarted; retry"));
		});
	}
	// raw frame over an already-open socket (no auth gate — used by the
	// handshake itself and, post-auth, by tool calls)
	function frame(cmd, args, cb) {
		var id = "mcp-" + (nextFrameId++);
		inflight[id] = {
			cb: cb,
			timer: setTimeout(function() {
				if(inflight[id]) {
					delete inflight[id];
					cb(new Error("Facets pipe timeout (" + CALL_TIMEOUT_MS + "ms) on " + cmd));
				}
			}, CALL_TIMEOUT_MS)
		};
		try {
			sock.write(JSON.stringify({ v: 1, id: id, cmd: cmd, args: args || {} }) + "\n");
		} catch(e) {
			delete inflight[id];
			cb(new Error("Facets pipe write failed: " + e.message));
		}
	}
	// connect + (in agent mode) run the enrollment handshake per socket;
	// single-flight so pipelined callers don't launch parallel handshakes that
	// clobber the server's per-connection nonce. A "pending" enrollment
	// re-runs the handshake — the approval may have landed since (the server
	// answers authenticated once the member approved in the Agents panel).
	function ready(cb) {
		connect(function(err) {
			if(err) return cb(err);
			if(authState !== "none" && authState !== "pending") return cb(null);
			readyWaiters.push(cb);
			if(handshakeInFlight) return;
			handshakeInFlight = true;
			function done(e) {
				handshakeInFlight = false;
				var w = readyWaiters; readyWaiters = [];
				for(var i = 0; i < w.length; i++) w[i](e);
				onHandshake();
			}
			var disco = readDiscovery();
			if(!disco || disco.mode !== "agent") {
				authState = "full-trust";
				authScope = (disco && disco.mode === "rw") ? "rw" : "ro";
				return done(null);
			}
			if(!agentKey) agentKey = loadOrCreateAgentKey();
			frame("agent-hello", { pub: agentKey.pubHex, name: options.label || "claude-code" }, function(e, hello) {
				if(e) return done(e);
				if(!hello.ok) return done(new Error("agent-hello: " + hello.error));
				if(hello.result.mode === "full-trust") { authState = "full-trust"; authScope = hello.result.scope || "ro"; return done(null); }
				frame("agent-auth", { sig: signChallenge(agentKey.priv, hello.result.challenge) }, function(e2, auth) {
					if(e2) return done(e2);
					if(!auth.ok) return done(new Error("agent-auth: " + auth.error));
					if(auth.result.authenticated) { authState = "authenticated"; authScope = auth.result.scope || "ro"; }
					else { authState = "pending"; }
					done(null);
				});
			});
		});
	}
	// the tool-facing call: ensure ready, surface an un-approved enrollment as a
	// readable error, otherwise forward the frame
	function call(cmd, args, cb) {
		ready(function(err) {
			if(err) return cb(err);
			if(authState === "pending") return cb(new Error("Agent enrollment PENDING — approve this agent in the Facets app (pub " + agentKey.pubHex.slice(0, 8) + "…) via the dashboard Agents panel, then retry."));
			if(authState === "denied") return cb(new Error("Agent enrollment was denied for pub " + agentKey.pubHex.slice(0, 8) + "…"));
			frame(cmd, args, cb);
		});
	}

	// Self-healing: while unreachable or enrollment-pending, another handshake
	// may settle where the last one did not, so onHandshake can tell the client.
	function retryIfUnsettled() {
		if(authState !== "none" && authState !== "pending") return;
		ready(function() {});
	}

	return {
		ready: ready,
		call: call,
		effectiveRw: effectiveRw,
		readDiscovery: readDiscovery,
		retryIfUnsettled: retryIfUnsettled
	};
}

// The protocol contract of pear mode, with the app handed in. `send` takes one
// serialised line and `makeBridge(onHandshake)` supplies the app; the defaults
// are stdout and a real pipe client, so a test can replace both.
function createPearSession(options) {
	var pearDir = options.pearDir;
	var handlers = require("$:/core/modules/commands/inspect/mcp-handlers.js");
	var send = options.send || function(line) { process.stdout.write(line + "\n"); };
	var makeBridge = options.makeBridge || function(onHandshake) {
		return createPearBridge(pearDir, { onHandshake: onHandshake, label: options.label });
	};
	var bridge = makeBridge(function() { maybeNotifyListChanged(); });

	// tools/list_changed: remember what the last tools/list advertised; when a
	// later handshake lands in a different effective scope (the app came up,
	// the enrollment was approved, the agent was revoked) notify the client so
	// it re-fetches — the write set appears exactly when it becomes callable.
	// Delivery rides an open subscriptions/listen. This revision forbids an
	// unsolicited notification, and every one must name the subscription that
	// asked for it, so nothing is sent until a client opts in.
	var lastAdvertisedRw = null;
	var toolsListSubscribers = {}; // String(listen request id) -> the id itself
	function notifyOnSubscription(subscriptionId, method, params) {
		var body = params || {};
		body._meta = body._meta || {};
		body._meta[META_SUBSCRIPTION_ID] = subscriptionId;
		send(JSON.stringify({ jsonrpc: "2.0", method: method, params: body }));
	}
	function maybeNotifyListChanged() {
		if(lastAdvertisedRw === null || bridge.effectiveRw() === lastAdvertisedRw) return;
		lastAdvertisedRw = bridge.effectiveRw();
		for(var key in toolsListSubscribers) {
			notifyOnSubscription(toolsListSubscribers[key], "notifications/tools/list_changed");
		}
	}
	// Graceful closure: answer each open subscriptions/listen so the client can
	// tell a clean shutdown from a dropped transport.
	function closeSubscriptions() {
		for(var key in toolsListSubscribers) {
			var payload = { _meta: {} };
			payload._meta[META_SUBSCRIPTION_ID] = toolsListSubscribers[key];
			send(jsonrpcResponse(toolsListSubscribers[key], payload));
		}
		toolsListSubscribers = {};
	}

	function handlePearTool(name, args, done) {
		// every tool forwards VERBATIM: the app runs the real tw-mcp handler
		// in its headless engine (feature parity, ruled 2026-07-17) and the
		// handler's pre-formatted text passes through
		if(PEAR_READ_TOOLS.indexOf(name) < 0 && PEAR_WRITE_TOOLS.indexOf(name) < 0) {
			return done(null); // unknown tool
		}
		return bridge.call(name, args, function(err, r) {
			if(err) return done(errorResult(err.message));
			if(!r.ok) return done(errorResult("Facets: " + r.error));
			done(textResult((r.result && r.result.text) || ""));
		});
	}

	function pearToolDefinitions() {
		// write tools show only at an effective rw scope: full-trust rw, or an
		// agent authenticated at rw. In agent mode before/without approval the
		// read set still lists (calls return a readable pending error).
		var rw = bridge.effectiveRw();
		var names = rw ? PEAR_READ_TOOLS.concat(PEAR_WRITE_TOOLS) : PEAR_READ_TOOLS;
		return handlers.getToolDefinitions(!rw).filter(function(t) {
			return names.indexOf(t.name) >= 0;
		});
	}

	// Handed over on server/discover and on initialize alike, so it lives in one
	// place. Read fresh each time: what the app is doing can change between calls.
	function pearInstructions() {
		var disco = bridge.readDiscovery();
		return "TiddlyWiki MCP server — PEAR MODE: tools answer from a RUNNING Facets app" +
			(disco ? " (group '" + (disco.name || disco.group) + "', " + disco.mode + ")" : " (NOT currently reachable)") +
			", not from this process's wiki.\n" +
			"- run_filter / render_* execute in the app's headless engine over the member's composed view (bag + staged edits).\n" +
			"- get_tiddler / list_tiddlers reflect the shared bag; staged-only edits appear in the engine view.\n" +
			((disco && disco.mode === "rw")
				? "- Writes land like member saves: with staging armed they stay PRIVATE until the member commits them.\n"
				: (disco && disco.mode === "agent")
					? "- AGENT MODE: this client enrolls with its own device identity; the member must approve it in the app's Agents panel before any tool works. A 'PENDING' error means approval is still needed.\n"
					: "- READONLY: the app's mcp.flag does not say rw — write tools are not offered.\n") +
			"- 'Facets app not reachable' errors mean the app is not running (or mcp.flag is absent); ask the user to start it.";
	}

	function dispatch(line) {
		var parsed;
		try {
			parsed = JSON.parse(line);
		} catch(e) {
			return send(jsonrpcError(null, -32700, "Parse error"));
		}
		if(parsed.id === undefined || parsed.id === null) {
			// On stdio there is no stream to close, so a client ends a
			// subscription by cancelling the request that opened it.
			if(parsed.method === "notifications/cancelled" && parsed.params) {
				delete toolsListSubscribers[String(parsed.params.requestId)];
			}
			return; // notifications need no reply
		}
		var id = parsed.id;

		// A message naming a version we do not speak is refused in both eras. An
		// ABSENT version is not that case — it is how a handshake-era client
		// looks — so eraOfMessage reports legacy for it rather than null.
		var era = eraOfMessage(parsed);
		if(era === null) {
			return send(jsonrpcError(id, -32022, "Unsupported protocol version",
				{ supported: SUPPORTED_VERSIONS, requested: (parsed.params && parsed.params._meta && parsed.params._meta[META_VERSION]) || null }));
		}

		switch(parsed.method) {
			case "initialize": {
				// Echo the requested version when we speak it, otherwise name one we
				// do and let the client decide. A client that gets here has already
				// given up on server/discover, so refusing it strands the connection.
				var requested = (parsed.params && parsed.params.protocolVersion) || null;
				var negotiated = LEGACY_VERSIONS.indexOf(requested) >= 0 ? requested : LEGACY_DEFAULT_VERSION;
				return send(jsonrpcResponse(id, {
					protocolVersion: negotiated,
					// NOT listChanged: the tool-list notification rides an open
					// subscriptions/listen, which is a 2026-07-28 mechanism. Claiming
					// it here would promise a handshake-era client a notification
					// this dispatcher never sends.
					capabilities: { tools: {} },
					serverInfo: { name: SERVER_NAME, version: getServerVersion() },
					instructions: pearInstructions()
				}, era));
			}
			case "server/discover": {
				return send(jsonrpcResponse(id, {
					supportedVersions: SUPPORTED_VERSIONS,
					capabilities: { tools: { listChanged: true } },
					instructions: pearInstructions()
				}, era));
			}
			case "ping":
				// Removed in 2026-07-28 but present in every handshake-era revision,
				// where a client may use it as a liveness check.
				if(era === "legacy") {
					return send(jsonrpcResponse(id, {}, era));
				}
				return send(jsonrpcError(id, -32601, "Method not found: " + parsed.method));
			case "subscriptions/listen": {
				// The request stays OPEN: the acknowledgement is a notification,
				// and the JSON-RPC response is sent only when the subscription
				// ends. The acknowledged filter reports what we actually honour,
				// so unsupported types are omitted rather than silently implied.
				var wanted = (parsed.params && parsed.params.notifications) || {};
				var honoured = {};
				if(wanted.toolsListChanged) {
					toolsListSubscribers[String(id)] = id;
					honoured.toolsListChanged = true;
				}
				return notifyOnSubscription(id, "notifications/subscriptions/acknowledged", { notifications: honoured });
			}
			case "tools/list":
				// resolve the connection (and enrollment) first so the write
				// tools appear exactly when they are actually callable
				return bridge.ready(function() {
					lastAdvertisedRw = bridge.effectiveRw();
					// The cache hints are 2026-07-28 fields; the handshake era has
					// no such thing, so they are sent only to modern clients.
					var listResult = { tools: pearToolDefinitions() };
					if(era === "modern") {
						listResult.ttlMs = LIST_TTL_MS;
						listResult.cacheScope = "private";
					}
					send(jsonrpcResponse(id, listResult, era));
				});
			case "tools/call": {
				var toolName = parsed.params && parsed.params.name;
				var toolArgs = (parsed.params && parsed.params.arguments) || {};
				return handlePearTool(toolName, toolArgs, function(result) {
					if(result === null) return send(jsonrpcError(id, -32602, "Unknown tool: " + toolName));
					send(jsonrpcResponse(id, result, era));
				});
			}
			default:
				return send(jsonrpcError(id, -32601, "Method not found: " + parsed.method));
		}
	}

	return {
		dispatch: dispatch,
		closeSubscriptions: closeSubscriptions,
		bridge: bridge
	};
}

function startPearMode(options) {
	var session = createPearSession(options);

	// --- the stdio JSON-RPC loop (async dispatch — replies ride the pipe) ---
	var stdinBuf = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", function(chunk) {
		stdinBuf += chunk;
		var lines = stdinBuf.split("\n");
		stdinBuf = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			if(lines[i].trim()) session.dispatch(lines[i].trim());
		}
	});
	process.stdin.on("end", function() {
		session.closeSubscriptions();
		process.exit(0);
	});
	var disco = session.bridge.readDiscovery();
	log("pear mode: " + options.pearDir + (disco ? " -> " + disco.pipe + " (" + disco.mode + ")" : " (app not running yet — will dial on first call)"));
	// self-healing: while unreachable or enrollment-pending, retry the
	// handshake every 30 s — when the app comes up or the approval lands,
	// the client is told to re-fetch the tool list.
	setInterval(function() {
		session.bridge.retryIfUnsettled();
	}, 30000);
}

exports.startPearMode = startPearMode;
// Test seam: the protocol contract is worth pinning without a running app to
// dial (bead tw-mcp-server-i1k).
exports.createPearSession = createPearSession;
