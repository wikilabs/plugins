/*\
title: $:/core/modules/commands/inspect/mcp-pear.js
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

var PROTOCOL_VERSION = "2025-03-26";
var SERVER_NAME = "tiddlywiki-mcp";
var CALL_TIMEOUT_MS = 20000;

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

function jsonrpcResponse(id, result) {
	return JSON.stringify({ jsonrpc: "2.0", id: id, result: result });
}

function jsonrpcError(id, code, message) {
	return JSON.stringify({ jsonrpc: "2.0", id: id, error: { code: code, message: message } });
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

function startPearMode(options) {
	var pearDir = options.pearDir;
	var handlers = require("$:/core/modules/commands/inspect/mcp-handlers.js");

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
	// tools/list_changed: remember what the last tools/list advertised; when a
	// later handshake lands in a different effective scope (the app came up,
	// the enrollment was approved, the agent was revoked) notify the client so
	// it re-fetches — the write set appears exactly when it becomes callable.
	var lastAdvertisedRw = null;
	function effectiveRw() {
		return (authScope === "rw") && (authState === "full-trust" || authState === "authenticated");
	}
	function maybeNotifyListChanged() {
		if(lastAdvertisedRw === null || effectiveRw() === lastAdvertisedRw) return;
		lastAdvertisedRw = effectiveRw();
		send(JSON.stringify({ jsonrpc: "2.0", method: "notifications/tools/list_changed" }));
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
				maybeNotifyListChanged();
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

	function handlePearTool(name, args, done) {
		// every tool forwards VERBATIM: the app runs the real tw-mcp handler
		// in its headless engine (feature parity, ruled 2026-07-17) and the
		// handler's pre-formatted text passes through
		if(PEAR_READ_TOOLS.indexOf(name) < 0 && PEAR_WRITE_TOOLS.indexOf(name) < 0) {
			return done(null); // unknown tool
		}
		return call(name, args, function(err, r) {
			if(err) return done(errorResult(err.message));
			if(!r.ok) return done(errorResult("Facets: " + r.error));
			done(textResult((r.result && r.result.text) || ""));
		});
	}

	function pearToolDefinitions() {
		// write tools show only at an effective rw scope: full-trust rw, or an
		// agent authenticated at rw. In agent mode before/without approval the
		// read set still lists (calls return a readable pending error).
		var rw = effectiveRw();
		var names = rw ? PEAR_READ_TOOLS.concat(PEAR_WRITE_TOOLS) : PEAR_READ_TOOLS;
		return handlers.getToolDefinitions(!rw).filter(function(t) {
			return names.indexOf(t.name) >= 0;
		});
	}

	// --- the stdio JSON-RPC loop (async dispatch — replies ride the pipe) ---
	function send(line) {
		process.stdout.write(line + "\n");
	}
	function dispatch(line) {
		var parsed;
		try {
			parsed = JSON.parse(line);
		} catch(e) {
			return send(jsonrpcError(null, -32700, "Parse error"));
		}
		if(parsed.id === undefined || parsed.id === null) {
			return; // notifications need no reply
		}
		var id = parsed.id;
		switch(parsed.method) {
			case "initialize": {
				var disco = readDiscovery();
				return send(jsonrpcResponse(id, {
					protocolVersion: PROTOCOL_VERSION,
					capabilities: { tools: { listChanged: true } },
					serverInfo: { name: SERVER_NAME, version: getServerVersion() },
					instructions: "TiddlyWiki MCP server — PEAR MODE: tools answer from a RUNNING Facets app" +
						(disco ? " (group '" + (disco.name || disco.group) + "', " + disco.mode + ")" : " (NOT currently reachable)") +
						", not from this process's wiki.\n" +
						"- run_filter / render_* execute in the app's headless engine over the member's composed view (bag + staged edits).\n" +
						"- get_tiddler / list_tiddlers reflect the shared bag; staged-only edits appear in the engine view.\n" +
						((disco && disco.mode === "rw")
							? "- Writes land like member saves: with staging armed they stay PRIVATE until the member commits them.\n"
							: (disco && disco.mode === "agent")
								? "- AGENT MODE: this client enrolls with its own device identity; the member must approve it in the app's Agents panel before any tool works. A 'PENDING' error means approval is still needed.\n"
								: "- READONLY: the app's mcp.flag does not say rw — write tools are not offered.\n") +
						"- 'Facets app not reachable' errors mean the app is not running (or mcp.flag is absent); ask the user to start it."
				}));
			}
			case "ping":
				return send(jsonrpcResponse(id, {}));
			case "tools/list":
				// resolve the connection (and enrollment) first so the write
				// tools appear exactly when they are actually callable
				return ready(function() {
					lastAdvertisedRw = effectiveRw();
					send(jsonrpcResponse(id, { tools: pearToolDefinitions() }));
				});
			case "tools/call": {
				var toolName = parsed.params && parsed.params.name;
				var toolArgs = (parsed.params && parsed.params.arguments) || {};
				return handlePearTool(toolName, toolArgs, function(result) {
					if(result === null) return send(jsonrpcError(id, -32602, "Unknown tool: " + toolName));
					send(jsonrpcResponse(id, result));
				});
			}
			default:
				return send(jsonrpcError(id, -32601, "Method not found: " + parsed.method));
		}
	}

	var stdinBuf = "";
	process.stdin.setEncoding("utf8");
	process.stdin.on("data", function(chunk) {
		stdinBuf += chunk;
		var lines = stdinBuf.split("\n");
		stdinBuf = lines.pop();
		for(var i = 0; i < lines.length; i++) {
			if(lines[i].trim()) dispatch(lines[i].trim());
		}
	});
	process.stdin.on("end", function() {
		process.exit(0);
	});
	var disco = readDiscovery();
	log("pear mode: " + pearDir + (disco ? " -> " + disco.pipe + " (" + disco.mode + ")" : " (app not running yet — will dial on first call)"));
	// self-healing: while unreachable or enrollment-pending, retry the
	// handshake every 30 s — when the app comes up or the approval lands,
	// maybeNotifyListChanged() tells the client to re-fetch the tool list.
	setInterval(function() {
		if(authState !== "none" && authState !== "pending") return;
		ready(function() {});
	}, 30000);
}

exports.startPearMode = startPearMode;
