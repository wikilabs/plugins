/*\
title: $:/core/modules/commands/inspect/lsp/lsp-lib.js
type: application/javascript
module-type: library

Zero-dependency LSP (Language Server Protocol) server for TiddlyWiki.
Implements JSON-RPC 2.0 over the LSP header framing, on a socket by default.

Unlike the MCP server this is STATEFUL by construction: the protocol hands the
open buffers to the server and expects it to mirror them, so each connection
carries its own document set and its own initialize lifecycle. That is the
reason it is a separate command rather than a mode of --mcp, which is stateless
and answers every message on its own.

\*/

"use strict";

var net = $tw.node ? require("net") : null;

var features = require("$:/core/modules/commands/inspect/lsp/lsp-features.js");

var SERVER_NAME = "tiddlywiki-lsp";
var PLUGIN_TITLE = "$:/plugins/wikilabs/tw-mcp";
var DEFAULT_PORT = 6009;
var DEFAULT_HOST = "127.0.0.1";

// Full sync. A wiki document is a tiddler-sized text, so replacing it costs
// less than the bookkeeping incremental sync would need.
var SYNC_FULL = 1;

// How long typing must pause before the squiggles are recomputed.
var DIAGNOSTIC_DEBOUNCE_MS = 300;

var PARSE_ERROR = -32700;
var INVALID_REQUEST = -32600;
var METHOD_NOT_FOUND = -32601;
var INVALID_PARAMS = -32602;
var INTERNAL_ERROR = -32603;
var SERVER_NOT_INITIALIZED = -32002;

function getServerVersion() {
	var pluginTiddler = $tw.wiki.getTiddler(PLUGIN_TITLE);
	return (pluginTiddler && pluginTiddler.fields.version) || "0.0.0";
}

function log(msg) {
	process.stderr.write("[tw-lsp] " + msg + "\n");
}

// --- JSON-RPC helpers ---

function response(id, result) {
	return { jsonrpc: "2.0", id: id, result: result === undefined ? null : result };
}

function errorResponse(id, code, message) {
	return { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
}

function notification(method, params) {
	return { jsonrpc: "2.0", method: method, params: params };
}

function serverCapabilities() {
	return {
		// Told of saves, not their text: the saved file is read from disk.
		textDocumentSync: { openClose: true, change: SYNC_FULL, save: { includeText: false } },
		// "[" and "{" fire on the second character of "[[" and "{{", where a title
		// starts; the rest where a call, widget, variable or argument name starts.
		completionProvider: { triggerCharacters: ["[", "{", "<", "$", "\"", "=", " "] },
		hoverProvider: true,
		definitionProvider: true,
		referencesProvider: true,
		documentSymbolProvider: true,
		workspaceSymbolProvider: true,
		documentHighlightProvider: true,
		foldingRangeProvider: true,
		// A space starts the next argument, ":" and "=" its value; a quote may close one.
		signatureHelpProvider: { triggerCharacters: [" ", ":", "="], retriggerCharacters: ["\""] }
	};
}

// --- Session ---

// One connection's state. send receives message OBJECTS; framing belongs to
// the transport, which keeps this whole path drivable from a test.
function createSession(send, options) {
	options = options || {};
	var documents = Object.create(null),
		pending = Object.create(null),
		initialized = false,
		shuttingDown = false,
		linkSupport = false,
		hierarchicalSymbols = false;
	// Injectable so a test can run the timer synchronously rather than sleeping.
	var schedule = options.schedule || function(fn, ms) { return setTimeout(fn, ms); },
		cancel = options.cancel || clearTimeout,
		debounceMs = options.debounceMs === undefined ? DIAGNOSTIC_DEBOUNCE_MS : options.debounceMs;

	function publishDiagnostics(uri, version) {
		// A read-only view gets no squiggles: nothing in it can be fixed from there.
		var params = { uri: uri, diagnostics: features.isVirtualUri(uri) ? [] : features.diagnostics(uri, documents[uri] || "") };
		if(version !== undefined && version !== null) {
			params.version = version;
		}
		send(notification("textDocument/publishDiagnostics", params));
	}

	// Every keystroke is a didChange, and each one would otherwise reparse the
	// document and repaint the squiggles. Waiting for a pause in typing also
	// spares the reader a warning on a link they are halfway through writing.
	function scheduleDiagnostics(uri, version) {
		clearPending(uri);
		pending[uri] = schedule(function() {
			delete pending[uri];
			publishDiagnostics(uri, version);
		}, debounceMs);
	}

	function clearPending(uri) {
		if(pending[uri] !== undefined) {
			cancel(pending[uri]);
			delete pending[uri];
		}
	}

	function handleNotification(method, params) {
		switch(method) {
			case "initialized":
				break;
			case "exit":
				// In socket mode the process serves other commands too, so exit
				// ends this connection only. Owning stdio is what makes exiting
				// the process the right answer.
				if(options.onExit) {
					options.onExit(shuttingDown);
				}
				break;
			case "textDocument/didOpen": {
				var opened = params.textDocument;
				documents[opened.uri] = opened.text;
				publishDiagnostics(opened.uri, opened.version);
				break;
			}
			case "textDocument/didChange": {
				var changed = params.textDocument,
					changes = params.contentChanges || [];
				// Full sync: the last change carries the whole document.
				if(changes.length) {
					documents[changed.uri] = changes[changes.length - 1].text;
				}
				scheduleDiagnostics(changed.uri, changed.version);
				break;
			}
			case "textDocument/didSave": {
				var reloaded = features.reloadSaved(params.textDocument.uri);
				if(reloaded && reloaded.length) {
					log("Reloaded " + reloaded.join(", "));
				}
				break;
			}
			case "textDocument/didClose": {
				var closed = params.textDocument;
				clearPending(closed.uri);
				delete documents[closed.uri];
				// An empty list is how the client is told to clear the squiggles
				// it is still showing for a file it just closed.
				send(notification("textDocument/publishDiagnostics", { uri: closed.uri, diagnostics: [] }));
				break;
			}
			default:
				// The spec requires unknown notifications to be ignored.
				break;
		}
	}

	function handleRequest(id, method, params) {
		switch(method) {
			case "initialize":
				initialized = true;
				// A client that reads LocationLinks gets the whole definition to peek at.
				linkSupport = !!(params.capabilities && params.capabilities.textDocument && params.capabilities.textDocument.definition && params.capabilities.textDocument.definition.linkSupport);
				// The protocol's rule: a client that does not say it nests symbols gets a flat list.
				hierarchicalSymbols = !!(params.capabilities && params.capabilities.textDocument && params.capabilities.textDocument.documentSymbol && params.capabilities.textDocument.documentSymbol.hierarchicalDocumentSymbolSupport);
				log("Initialized by " + describeClient(params) + " (v" + getServerVersion() + ")");
				send(response(id, {
					capabilities: serverCapabilities(),
					serverInfo: { name: SERVER_NAME, version: getServerVersion() }
				}));
				break;

			case "shutdown":
				shuttingDown = true;
				send(response(id, null));
				break;

			case "textDocument/completion": {
				var uri = params.textDocument.uri,
					text = documents[uri];
				if(text === undefined) {
					// Completing in a document the client never opened is a
					// client bug, but answering an empty list beats an error.
					send(response(id, { isIncomplete: false, items: [] }));
					break;
				}
				send(response(id, features.completions(uri, text, params.position)));
				break;
			}

			case "textDocument/hover": {
				var hoverUri = params.textDocument.uri,
					hoverText = documents[hoverUri];
				send(response(id, hoverText === undefined ? null : features.hover(hoverUri, hoverText, params.position, documents)));
				break;
			}

			case "textDocument/definition": {
				var defUri = params.textDocument.uri,
					defText = documents[defUri];
				send(response(id, defText === undefined ? null : features.definition(defUri, defText, params.position, { linkSupport: linkSupport }, documents)));
				break;
			}

			case "textDocument/references": {
				var refUri = params.textDocument.uri,
					refText = documents[refUri];
				send(response(id, refText === undefined ? null : features.references(refUri, refText, params.position, params.context, documents)));
				break;
			}

			case "textDocument/documentSymbol": {
				var symbolUri = params.textDocument.uri,
					symbolText = documents[symbolUri];
				send(response(id, symbolText === undefined ? null : features.documentSymbols(symbolUri, symbolText, { hierarchical: hierarchicalSymbols })));
				break;
			}

			case "textDocument/documentHighlight": {
				var highlightUri = params.textDocument.uri,
					highlightText = documents[highlightUri];
				send(response(id, highlightText === undefined ? null : features.documentHighlights(highlightUri, highlightText, params.position)));
				break;
			}

			case "textDocument/foldingRange": {
				var foldUri = params.textDocument.uri,
					foldText = documents[foldUri];
				send(response(id, foldText === undefined ? null : features.foldingRanges(foldUri, foldText)));
				break;
			}

			case "textDocument/signatureHelp": {
				var helpUri = params.textDocument.uri,
					helpText = documents[helpUri];
				send(response(id, helpText === undefined ? null : features.signatureHelp(helpUri, helpText, params.position)));
				break;
			}

			case "workspace/symbol": {
				send(response(id, features.workspaceSymbols(params.query || "", documents)));
				break;
			}

			// Not in the protocol: the extension's content provider asks for the text
			// of a tiddler that has no file of its own, to show it read-only.
			case "tiddlywiki/tiddler": {
				var viewText = features.virtualDocument(params.uri || "");
				send(viewText === null ? errorResponse(id, INVALID_PARAMS, "No tiddler for " + params.uri) : response(id, { text: viewText }));
				break;
			}

			default:
				send(errorResponse(id, METHOD_NOT_FOUND, "Method not found: " + method));
				break;
		}
	}

	function dispatch(message) {
		var isRequest = message.id !== undefined && message.id !== null,
			method = message.method,
			params = message.params || {};
		if(!method) {
			if(isRequest) {
				send(errorResponse(message.id, INVALID_REQUEST, "Missing method"));
			}
			return;
		}
		// Everything before initialize is refused, and every request after
		// shutdown is too. Both are the spec's rules, and both are the kind of
		// per-connection state that MCP deliberately does not have.
		if(!initialized && method !== "initialize") {
			if(isRequest) {
				send(errorResponse(message.id, SERVER_NOT_INITIALIZED, "Server not initialized"));
			}
			return;
		}
		if(shuttingDown && isRequest) {
			send(errorResponse(message.id, INVALID_REQUEST, "Server is shutting down"));
			return;
		}
		// A handler answers text the user is in the middle of typing, so it can
		// meet input no amount of validation anticipated. This process also
		// serves --mcp and the browser, so one bad request must not reach
		// process level and take those down with it: the failure is reported to
		// the client as the protocol's own internal error and logged in full.
		try {
			if(isRequest) {
				handleRequest(message.id, method, params);
			} else {
				handleNotification(method, params);
			}
		} catch(err) {
			log("Handler failed for " + method + ": " + (err && err.stack ? err.stack : err));
			if(isRequest) {
				send(errorResponse(message.id, INTERNAL_ERROR, "Handler failed for " + method + ": " + err));
			}
		}
	}

	// A dropped connection leaves its pending timers behind, and each one holds
	// a send() into a socket that is gone.
	function dispose() {
		for(var uri in pending) {
			cancel(pending[uri]);
		}
		pending = Object.create(null);
	}

	return { dispatch: dispatch, documents: documents, dispose: dispose };
}

function describeClient(params) {
	var info = params && params.clientInfo;
	if(!info) {
		return "an unnamed client";
	}
	return info.name + (info.version ? " " + info.version : "");
}

// --- Framing ---

// LSP frames each message with a Content-Length header counting BYTES, so the
// buffer is kept as a Buffer and only the body is decoded as UTF-8.
function attachFramedHandler(stream, session, send, onClose) {
	var buffer = Buffer.alloc(0),
		closed = false;
	stream.on("data", function(chunk) {
		buffer = Buffer.concat([buffer, chunk]);
		for(;;) {
			var headerEnd = buffer.indexOf("\r\n\r\n");
			if(headerEnd < 0) {
				return;
			}
			var header = buffer.slice(0, headerEnd).toString("ascii"),
				match = /content-length:\s*(\d+)/i.exec(header);
			if(!match) {
				log("Frame without Content-Length, dropping connection");
				stream.destroy();
				return;
			}
			var length = parseInt(match[1], 10),
				bodyStart = headerEnd + 4;
			if(buffer.length < bodyStart + length) {
				return;
			}
			var body = buffer.slice(bodyStart, bodyStart + length).toString("utf8");
			buffer = buffer.slice(bodyStart + length);
			var parsed = null;
			try {
				parsed = JSON.parse(body);
			} catch(e) {
				parsed = null;
			}
			if(parsed === null) {
				send(errorResponse(null, PARSE_ERROR, "Parse error"));
			} else {
				session.dispatch(parsed);
			}
		}
	});
	// A socket reports "close" and stdin reports "end"; whichever arrives, the
	// connection is over exactly once.
	function finish() {
		if(!closed) {
			closed = true;
			onClose();
		}
	}
	stream.on("close", finish);
	stream.on("end", finish);
	stream.on("error", function(err) {
		log("Connection error: " + err.message);
	});
}

function framedWriter(stream) {
	return function(message) {
		var body = JSON.stringify(message);
		stream.write("Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body);
	};
}

// --- Startup ---

function startSocketServer(options) {
	var port = options.port || DEFAULT_PORT,
		host = options.host || DEFAULT_HOST;
	var server = net.createServer(function(socket) {
		var send = framedWriter(socket);
		var session = createSession(send, {
			onExit: function() { socket.end(); }
		});
		attachFramedHandler(socket, session, send, function() {
			session.dispose();
			log("Client disconnected");
		});
		log("Client connected from " + socket.remoteAddress);
	});
	server.listen(port, host, function() {
		log("Listening on " + host + ":" + port + " (v" + getServerVersion() + ", PID " + process.pid + ")");
	});
	server.on("error", function(err) {
		log("Server error: " + err.message);
	});
	return server;
}

function startStdioServer() {
	var send = framedWriter(process.stdout);
	var session = createSession(send, {
		onExit: function(cleanShutdown) { process.exit(cleanShutdown ? 0 : 1); }
	});
	attachFramedHandler(process.stdin, session, send, function() {
		log("stdin closed, shutting down");
		process.exit(0);
	});
	log("Serving on stdio (v" + getServerVersion() + ", PID " + process.pid + ")");
}

function startLSPServer(options) {
	options = options || {};
	$tw.lsp = {
		pid: process.pid,
		transport: options.stdio ? "stdio" : "socket",
		port: options.stdio ? null : (options.port || DEFAULT_PORT),
		version: getServerVersion(),
		started: Date.now()
	};
	if(options.stdio) {
		startStdioServer();
		return;
	}
	$tw.lsp.server = startSocketServer(options);
}

exports.startLSPServer = startLSPServer;
// Test seam. The lifecycle rules (initialize gate, capabilities, sync, shutdown)
// are the contract worth pinning, and none of it needs a socket to reach.
exports.createSession = createSession;
