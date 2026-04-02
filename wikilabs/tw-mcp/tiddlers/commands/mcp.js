/*\
title: $:/core/modules/commands/inspect/mcp.js
type: application/javascript
module-type: library

Zero-dependency MCP (Model Context Protocol) server for TiddlyWiki.
Implements JSON-RPC 2.0 over stdio transport.

\*/

"use strict";

var fs = require("fs"),
	path = require("path"),
	net = require("net"),
	crypto = require("crypto");

var tools = require("$:/core/modules/commands/inspect/mcp-tools.js");
var handlers = require("$:/core/modules/commands/inspect/mcp-handlers.js");

var PROTOCOL_VERSION = "2025-03-26";
var SERVER_NAME = "tiddlywiki-mcp";
var SERVER_VERSION = "0.2.0";

var readonlyMode = false;
var allowedPaths = null; // null = no restriction, array of absolute paths = restrict output to these directories
var authToken = null; // generated at startup for pipe transport authentication
var serverLabel = null; // optional user-defined label to identify this instance
var pipeClients = {}; // clientId -> { send, socket } — authenticated pipe clients
var currentPipeServer = null; // reference to the active net.Server for the pipe
var takeoverInProgress = false; // guard against concurrent takeover requests

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
	process.stderr.write("[tw-mcp] checkPathAllowed: " + path.resolve(targetPath) + " | allowedPaths: " + JSON.stringify(allowedPaths) + " | result: " + (isPathAllowed(targetPath) ? "ALLOWED" : "BLOCKED") + "\n");
	if(!isPathAllowed(targetPath)) {
		return {
			isError: true,
			content: [{ type: "text", text: "Path not allowed: " + path.resolve(targetPath) + ". Allowed directories: " + allowedPaths.join(", ") }]
		};
	}
	return null;
}

// --- JSON-RPC helpers ---

function jsonrpcResponse(id, result) {
	return JSON.stringify({ jsonrpc: "2.0", id: id, result: result });
}

function jsonrpcError(id, code, message, data) {
	var err = { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
	if(data !== undefined) {
		err.error.data = data;
	}
	return JSON.stringify(err);
}

// --- MCP Server ---

// --- Shared message dispatcher (used by stdio and pipe transports) ---

function log(msg) {
	process.stderr.write("[tw-mcp] " + msg + "\n");
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
			log("Request cancelled: " + JSON.stringify(parsed.params));
		} else if(parsed.method === "notifications/takeover-request") {
			handleTakeoverRequest(parsed.params);
		}
		return;
	}

	var id = parsed.id;
	var method = parsed.method;

	switch(method) {
		case "initialize":
			send(jsonrpcResponse(id, {
				protocolVersion: PROTOCOL_VERSION,
				capabilities: {
					tools: {}
				},
				serverInfo: {
					name: SERVER_NAME,
					version: SERVER_VERSION
				},
				instructions: "TiddlyWiki MCP server." +
					(readonlyMode ? " READONLY mode — write tools are disabled." : "") +
					"\n\n## Safety (CRITICAL)\n" +
					"- NEVER modify, create, or delete tiddlers unless the user EXPLICITLY asks (create, edit, update, delete, rename, tag, untag). Words like 'list', 'show', 'find', 'search' are read-only — never write.\n" +
					"- Before bulk operations, list affected tiddlers and ask for confirmation.\n" +
					"- Always use get_tiddler to check existence before overwriting.\n" +
					"\n## System tiddlers\n" +
					"- Exclude system tiddlers ('$:/') by default. Add '!is[system]' as the FIRST filter operator unless the user explicitly requests system/shadow tiddlers.\n" +
					"- Never fetch '$:/core/modules/...' source tiddlers unless the user specifically names one.\n" +
					"- Shadow tiddler fallback: if 2-3 searches fail, widen with '[all[tiddlers+shadows)]'. Many important tiddlers are shadows.\n" +
					"\n## Token efficiency\n" +
					"- Tool results are pre-formatted. Present them DIRECTLY — do not reformat or restructure.\n" +
					"- Prefer MCP tools for rendering/filters/wiki info. Prefer file access (Read/Grep/Glob) for code search.\n" +
					"\n## Filters\n" +
					"- Narrowing first: '[!is[system]search[x]]'. Shadows: '[all[shadows+tiddlers)prefix[$:/config/]]'."
			}));
			log("Initialized (protocol " + PROTOCOL_VERSION + ", readonly: " + readonlyMode + ")");
			break;

		case "ping":
			send(jsonrpcResponse(id, {}));
			break;

		case "tools/list":
			send(jsonrpcResponse(id, {
				tools: tools.getToolDefinitions(readonlyMode)
			}));
			break;

		case "tools/call": {
			var toolName = parsed.params && parsed.params.name;
			var toolArgs = (parsed.params && parsed.params.arguments) || {};
			var result = handlers.handleToolCall(toolName, toolArgs);
			if(result === null) {
				send(jsonrpcError(id, -32602, "Unknown tool: " + toolName));
			} else {
				send(jsonrpcResponse(id, result));
			}
			break;
		}

		default:
			send(jsonrpcError(id, -32601, "Method not found: " + method));
			break;
	}
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
		var clientSuffix = ""; // will be set to " @<label>" after auth
		log("Pipe client connected: " + clientId);

		var send = function(msg) {
			if(!socket.destroyed) {
				socket.write(msg + "\n");
			}
		};

		// Pipe clients must authenticate via token in the initialize request.
		// The dispatch wrapper intercepts messages until auth succeeds.
		var authenticated = false;
		var authenticatedDispatch = function(line, sendFn) {
			if(authenticated) {
				return dispatchMessage(line, sendFn);
			}
			// Not yet authenticated — parse and check
			var parsed;
			try {
				parsed = JSON.parse(line);
			} catch(e) {
				sendFn(jsonrpcError(null, -32700, "Parse error"));
				return;
			}
			// First message must be initialize with a valid _auth_token
			if(parsed.method !== "initialize" || parsed.id === undefined || parsed.id === null) {
				sendFn(jsonrpcError(parsed.id || null, -32600, "Authentication required: first message must be initialize with _auth_token"));
				socket.destroy();
				return;
			}
			var clientToken = parsed.params && parsed.params._auth_token;
			if(!clientToken || typeof clientToken !== "string") {
				sendFn(jsonrpcError(parsed.id, -32600, "Authentication failed: missing _auth_token"));
				socket.destroy();
				return;
			}
			// Constant-time comparison to prevent timing attacks
			var tokenBuf = Buffer.from(authToken, "utf8");
			var clientBuf = Buffer.from(clientToken, "utf8");
			if(tokenBuf.length !== clientBuf.length || !crypto.timingSafeEqual(tokenBuf, clientBuf)) {
				sendFn(jsonrpcError(parsed.id, -32600, "Authentication failed: invalid token"));
				log("Auth failed for client " + clientId + " — invalid token" + clientSuffix);
				socket.destroy();
				return;
			}
			authenticated = true;
			// Append PID to clientId, keep label separate so it's always last
			var clientPid = parsed.params && parsed.params._pid;
			var clientLabel = parsed.params && parsed.params._label;
			if(clientPid) {
				clientId = clientId + " (PID " + clientPid + ")";
			}
			if(clientLabel) {
				clientSuffix = " @" + clientLabel;
			}
			log("Client " + clientId + " authenticated" + clientSuffix);
			// Register in client registry for broadcast
			pipeClients[clientId] = { send: sendFn, socket: socket };
			// Forward the initialize message to the normal dispatcher
			dispatchMessage(line, sendFn);
		};

		attachStreamHandler(socket, send, function() {
			delete pipeClients[clientId];
			log("Pipe client disconnected: " + clientId + clientSuffix);
		}, authenticatedDispatch);

		socket.on("error", function(err) {
			delete pipeClients[clientId];
			log("Pipe client error (" + clientId + "): " + err.message + clientSuffix);
		});
	});

	pipeServer.on("error", function(err) {
		if(err.code === "EADDRINUSE") {
			log("Pipe already in use: " + pipePath + " — another MCP server may be running for this wiki");
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
			log("Pipe server listening: " + pipePath);
			// Restrict socket permissions on Unix to owner only
			if(process.platform !== "win32") {
				try {
					fs.chmodSync(pipePath, 0o600);
				} catch(e) {
					log("Warning: could not restrict socket permissions: " + e.message);
				}
			}
			// Write discovery file to the canonical wiki path so all editions converge
			writeDiscoveryFile({ pipe: pipePath, token: authToken, pid: process.pid, label: serverLabel || undefined });
		});
	});

	return pipeServer;
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
	log("Stepping down to PROXY → new primary (PID " + newPrimary.pid + ") at " + newPrimary.pipe + (newPrimary.label ? " @" + newPrimary.label : ""));
	$tw.mcp.role = "proxy";
	takeoverInProgress = false;

	// Connect to new primary's pipe
	var proxySocket = net.createConnection(newPrimary.pipe, function() {
		log("Transition: connected to new primary");
		// Send initialize with auth token to authenticate
		var initMsg = JSON.stringify({
			jsonrpc: "2.0",
			id: "transition-init",
			method: "initialize",
			params: {
				protocolVersion: PROTOCOL_VERSION,
				_auth_token: newPrimary.token,
				_pid: process.pid,
				_label: serverLabel
			}
		});
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

function injectAuth(line, token, label) {
	try {
		var msg = JSON.parse(line);
		if(msg.method === "initialize") {
			msg.params = msg.params || {};
			msg.params._auth_token = token;
			msg.params._pid = process.pid;
			if(label) {
				msg.params._label = label;
			}
			return JSON.stringify(msg);
		}
	} catch(e) {
		// Not valid JSON — pass through
	}
	return line;
}

function startProxyMode(discovery) {
	var pipePath = discovery.pipe;
	var token = discovery.token;
	var pipeSocket = null;
	var connected = false;
	var pendingStdio = [];
	var initializeId = null;
	var toolsListIds = {}; // track tools/list request ids for readonly filtering
	// Build write tool name set for readonly enforcement
	var writeToolNames = {};
	tools.writeTools.forEach(function(t) { writeToolNames[t.name] = true; });

	var takingOver = false; // true when we received a takeover notification (other proxies)
	var initiatedTakeover = false; // true when WE requested the takeover
	var currentPrimaryPid = discovery.pid;

	$tw.mcp.role = "proxy";
	log("Server started as PROXY (PID " + process.pid + ", readonly: " + readonlyMode + ") → primary (PID " + discovery.pid + ") at " + pipePath + (serverLabel ? " @" + serverLabel : ""));

	// --- Pipe connection to primary ---
	var proxyAuthenticated = false; // true after our self-init is ack'd
	var selfInitId = "proxy-init-" + Date.now();

	pipeSocket = net.createConnection(pipePath, function() {
		connected = true;
		log("Proxy: connected to primary");
		// Send our own initialize to authenticate with the primary's pipe
		var selfInit = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			id: selfInitId,
			method: "initialize",
			params: { protocolVersion: PROTOCOL_VERSION }
		}), token, serverLabel);
		pipeSocket.write(selfInit + "\n");
		// Flush buffered client messages (client's initialize will be a second init — harmless)
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
				if(initializeId !== null || (readonlyMode && Object.keys(toolsListIds).length > 0)) {
					try {
						var resp = JSON.parse(line);
						if(resp.id !== undefined) {
							// Annotate initialize response with proxy info
							if(resp.id === initializeId && resp.result && resp.result.serverInfo) {
								resp.result.serverInfo.proxy = true;
								resp.result.serverInfo.primaryPid = discovery.pid;
								resp.result.serverInfo.primaryLabel = discovery.label || null;
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
		log("Proxy: primary disconnected");
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
			// Flush any pending messages
			for(var i = 0; i < pendingStdio.length; i++) {
				pipeSocket.write(pendingStdio[i] + "\n");
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

		// Send initialize with auth to authenticate with new primary
		var initMsg = injectAuth(JSON.stringify({
			jsonrpc: "2.0",
			id: "reconnect-init-" + Date.now(),
			method: "initialize",
			params: { protocolVersion: PROTOCOL_VERSION }
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
		log("Proxy: HTTP server detected, initiating takeover");

		// Send takeover request to current primary
		var request = JSON.stringify({
			jsonrpc: "2.0",
			method: "notifications/takeover-request",
			params: {
				pid: process.pid,
				label: serverLabel
			}
		});
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
		// Intercept requests that need proxy-side handling
		try {
			var msg = JSON.parse(line);
			if(msg.id !== undefined) {
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
						var errResp = jsonrpcResponse(msg.id, {
							isError: true,
							content: [{ type: "text", text: "Tool '" + toolName + "' is disabled in readonly mode" }]
						});
						process.stdout.write(errResp + "\n");
						return; // don't forward to primary
					}
				}
			}
		} catch(e) {
			// Ignore parse errors
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
		allowedPaths = [
			$tw.boot.wikiTiddlersPath || path.resolve(canonical, "tiddlers"),
			path.resolve(canonical, "files"),
			path.resolve(canonical, "output"),
			path.resolve($tw.boot.wikiPath, "tiddlers"),
			path.resolve($tw.boot.wikiPath, "files"),
			path.resolve($tw.boot.wikiPath, "output")
		];
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
	log("Server started as PRIMARY (PID " + process.pid + ", protocol " + PROTOCOL_VERSION + ", readonly: " + readonlyMode + ", filesystem: " + !!$tw.syncadaptor + ")" + (serverLabel ? " @" + serverLabel : ""));
	if(allowedPaths) {
		log("Allowed paths:\n  - " + allowedPaths.join("\n  - "));
	}
}

function startMCPServer(options) {
	options = options || {};
	readonlyMode = !!options.readonly;
	serverLabel = options.label || null;

	// Expose MCP state on $tw so other commands (e.g. --listen) can discover it
	$tw.mcp = {
		pid: process.pid,
		label: serverLabel,
		role: null,
		readonly: readonlyMode,
		started: Date.now(),
		heartbeat: function() {
			return {
				pid: process.pid,
				role: $tw.mcp.role,
				label: $tw.mcp.label,
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
