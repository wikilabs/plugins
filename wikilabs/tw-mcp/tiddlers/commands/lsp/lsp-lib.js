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

var net = $tw.node ? require("net") : null,
	path = $tw.node ? require("path") : null;

var features = require("$:/core/modules/commands/inspect/lsp/lsp-features.js"),
	discovery = require("$:/core/modules/commands/inspect/lsp/lsp-discovery.js"),
	watch = require("$:/core/modules/commands/inspect/lsp/lsp-watch.js");

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
var REQUEST_FAILED = -32803;

var MESSAGE_TYPE_INFO = 3;
var MCP_SERVER_NOTIFICATION = "tiddlywiki/mcpServer";

function getServerVersion() {
	var pluginTiddler = $tw.wiki.getTiddler(PLUGIN_TITLE);
	return (pluginTiddler && pluginTiddler.fields.version) || "0.0.0";
}

function log(msg) {
	process.stderr.write("[tw-lsp" + labelSuffix($tw.lsp && $tw.lsp.label) + "] " + msg + "\n");
}

function labelSuffix(label) {
	return label ? " @" + label : "";
}

// label= on the command line wins over the "lsp" section of tiddlywiki.info, else lsp-<wiki folder name>.
function resolveLabel(options) {
	var section = ($tw.boot.wikiInfo || {}).lsp || {};
	return options.label || section.label || ($tw.boot.wikiPath ? "lsp-" + path.basename(path.resolve($tw.boot.wikiPath)) : null);
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
		signatureHelpProvider: { triggerCharacters: [" ", ":", "="], retriggerCharacters: ["\""] },
		inlayHintProvider: true,
		// prepareRename says why a name cannot be renamed before a new one is typed.
		renameProvider: { prepareProvider: true },
		codeActionProvider: { codeActionKinds: ["quickfix"] }
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
		hierarchicalSymbols = false,
		changeAnnotations = false,
		// Once all tiddlers were checked, undefined names stay in the problem list.
		checkedAll = false;
	// Injectable so a test can run the timer synchronously rather than sleeping.
	var schedule = options.schedule || function(fn, ms) { return setTimeout(fn, ms); },
		cancel = options.cancel || clearTimeout,
		debounceMs = options.debounceMs === undefined ? DIAGNOSTIC_DEBOUNCE_MS : options.debounceMs;

	function publishDiagnostics(uri, version) {
		// A read-only view gets no squiggles: nothing in it can be fixed from there.
		var params = { uri: uri, diagnostics: features.isVirtualUri(uri) ? [] : features.diagnostics(uri, documents[uri] || "", checkedAll) };
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
				// The client's own log is where a reader looks for which wiki answers.
				send(notification("window/logMessage", { type: MESSAGE_TYPE_INFO, message: describeWiki() }));
				if(options.onReady) {
					options.onReady();
				}
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
				if(options.onSaved) {
					options.onSaved(params.textDocument.uri, reloaded);
				}
				break;
			}
			case "textDocument/didClose": {
				var closed = params.textDocument;
				clearPending(closed.uri);
				delete documents[closed.uri];
				// An empty list clears the squiggles of a closed file; after a check of all
				// tiddlers, a wiki file gets its check result back instead.
				send(notification("textDocument/publishDiagnostics", { uri: closed.uri, diagnostics: (checkedAll && features.checkFile(closed.uri)) || [] }));
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
				// A client that annotates changes can be made to preview a rename.
				var workspaceEdit = params.capabilities && params.capabilities.workspace && params.capabilities.workspace.workspaceEdit;
				changeAnnotations = !!(workspaceEdit && workspaceEdit.documentChanges && workspaceEdit.changeAnnotationSupport);
				log("Initialized by " + describeClient(params) + " (v" + getServerVersion() + ")");
				if(options.onInitialized) {
					options.onInitialized(describeClient(params));
				}
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

			case "textDocument/inlayHint": {
				var hintUri = params.textDocument.uri,
					hintText = documents[hintUri];
				send(response(id, hintText === undefined ? null : features.inlayHints(hintUri, hintText, params.range)));
				break;
			}

			case "textDocument/prepareRename": {
				var prepareUri = params.textDocument.uri,
					prepareText = documents[prepareUri],
					prepared = prepareText === undefined ? null : features.prepareRename(prepareUri, prepareText, params.position, documents);
				send(prepared && prepared.error ? errorResponse(id, REQUEST_FAILED, prepared.error) : response(id, prepared));
				break;
			}

			case "textDocument/rename": {
				var renameUri = params.textDocument.uri,
					renameText = documents[renameUri],
					renamed = renameText === undefined ? null : features.rename(renameUri, renameText, params.position, params.newName, { annotations: changeAnnotations }, documents);
				send(renamed && renamed.error ? errorResponse(id, REQUEST_FAILED, renamed.error) : response(id, renamed));
				break;
			}

			case "textDocument/codeAction": {
				var actionUri = params.textDocument.uri,
					actionText = documents[actionUri];
				send(response(id, actionText === undefined || features.isVirtualUri(actionUri) ? [] : features.codeActions(actionUri, actionText, params.range, params.context)));
				break;
			}

			case "workspace/symbol": {
				send(response(id, features.workspaceSymbols(params.query || "", documents)));
				break;
			}

			// Not in the protocol: the extension's "Check all tiddlers" command. Every
			// file's list is sent, an empty one clearing what an earlier check found.
			case "tiddlywiki/checkAll": {
				var checkStarted = Date.now(),
					checked = features.checkAll(documents),
					summary = features.summarizeCheck(checked);
				checkedAll = true;
				// Open files are listed too, from their live text.
				Object.keys(documents).forEach(function(openUri) {
					publishDiagnostics(openUri);
				});
				checked.forEach(function(entry) {
					send(notification("textDocument/publishDiagnostics", { uri: entry.uri, diagnostics: entry.diagnostics }));
				});
				log("Checked " + summary.files + " files in " + (Date.now() - checkStarted) + " ms: " + summary.undefinedNames + " undefined names");
				send(response(id, summary));
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

// Without a port= of its own, a second wiki finds 6009 taken and takes any free
// port instead; the discovery file tells the editor which.
function startSocketServer(options) {
	var explicit = options.port !== undefined,
		port = explicit ? options.port : (options.defaultPort || DEFAULT_PORT),
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
	server.on("listening", function() {
		var actual = server.address().port;
		if($tw.lsp) {
			$tw.lsp.port = actual;
		}
		log("Listening on " + host + ":" + actual + " (v" + getServerVersion() + ", PID " + process.pid + ")");
		if(options.discoveryDir) {
			publish(options.discoveryDir, { pid: process.pid, host: host, port: actual, version: getServerVersion(), wiki: wikiFolder(), label: ($tw.lsp && $tw.lsp.label) || undefined });
		}
	});
	server.on("error", function(err) {
		if(err.code === "EADDRINUSE" && !explicit && port !== 0) {
			log("Port " + port + " is in use, listening on a free port instead");
			port = 0;
			server.listen(port, host);
			return;
		}
		log("Server error: " + err.message);
	});
	server.listen(port, host);
	return server;
}

// A wiki folder the server may not write to still serves the configured port.
function publish(wikiDir, data) {
	try {
		discovery.writeDiscovery(wikiDir, data);
		log("Port recorded in " + discovery.discoveryFile(wikiDir));
	} catch(err) {
		if(err.code !== "EACCES" && err.code !== "EPERM" && err.code !== "EROFS") {
			throw err;
		}
		log("Could not record the port in " + discovery.discoveryFile(wikiDir) + ": " + err.message);
	}
}

// SIGHUP is how Windows reports a closed console window; proc is a test seam.
function forgetOnExit(wikiDir, proc) {
	proc = proc || process;
	function forget() {
		// Best-effort teardown: a file left behind names a dead PID, which readers skip.
		try {
			discovery.removeDiscovery(wikiDir, process.pid);
		} catch(err) {}
	}
	proc.on("exit", forget);
	["SIGINT", "SIGTERM", "SIGHUP"].forEach(function(signal) {
		proc.on(signal, function() { proc.exit(0); });
	});
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

// The editor created the pipe and owns this process, so the process ends with the session.
function startPipeClient(pipeName, options) {
	options = options || {};
	var exit = options.exit || process.exit,
		connected = false,
		ready = false,
		socket = net.connect(pipeName),
		send = framedWriter(socket),
		session = createSession(send, {
			onExit: function(cleanShutdown) { exit(cleanShutdown ? 0 : 1); },
			onReady: function() {
				ready = true;
				announceMcpServer();
			},
			onInitialized: function(client) {
				if($tw.lsp && $tw.lsp.mcpLink) {
					$tw.lsp.mcpLink.update({ client: client });
				}
			},
			onSaved: tellPrimary
		});
	socket.on("connect", function() {
		connected = true;
		log("Connected to the editor on " + pipeName + " (v" + getServerVersion() + ", PID " + process.pid + ")");
	});
	attachFramedHandler(socket, session, send, function() {
		session.dispose();
		log(connected ? "The editor closed the pipe, shutting down" : "Could not reach the editor on " + pipeName);
		exit(connected ? 0 : 1);
	});
	// Not in the protocol: the editor shows which MCP server, if any, this wiki is linked to.
	function announceMcpServer() {
		var link = $tw.lsp && $tw.lsp.mcpLink;
		if(ready) {
			send(notification(MCP_SERVER_NOTIFICATION, { server: link ? link.server() : null }));
		}
	}
	if($tw.lsp) {
		$tw.lsp.announceMcpServer = announceMcpServer;
	}
	return socket;
}

// A save of the wiki's own file reaches a running dev server too, which holds the other copy of the wiki.
function tellPrimary(uri, reloaded) {
	var link = $tw.lsp && $tw.lsp.mcpLink;
	if(reloaded === null || !link) {
		return;
	}
	var filepath = path.resolve(features.uriToPath(uri));
	link.reloadFile(filepath, function(err, titles) {
		if(err) {
			log("Could not tell the MCP server about " + filepath + ": " + err.message);
		} else if(titles !== undefined) {
			log("The MCP server reloaded " + (titles && titles.length ? titles.join(", ") : "nothing from " + filepath));
		}
	});
}

// A dev server may be writing the same folder, so an editor-owned process leaves the files to it.
function neverWrite() {
	var adaptor = $tw.syncer && $tw.syncer.syncadaptor;
	if(adaptor) {
		adaptor.saveTiddler = function(tiddler, callback) { callback(null); };
		adaptor.deleteTiddler = function(title, callback) { callback(null); };
	}
}

// $tw.boot.wikiPath is the folder as typed on the command line, often relative.
function wikiFolder() {
	return $tw.boot.wikiPath ? path.resolve($tw.boot.wikiPath) : null;
}

// Names the $tw.wiki that answers, so a reader can tell which wiki an editor reached.
function describeWiki() {
	var wikiPath = wikiFolder(),
		includes = wikiPath ? (($tw.boot.wikiInfo || {}).includeWikis || []).map(function(info) {
			return path.resolve(wikiPath, typeof info === "string" ? info : info.path);
		}) : [];
	return "Wiki " + (wikiPath || "(no wiki folder)") +
		(includes.length ? ", including " + includes.join(", ") : "") +
		"; tiddlers folder " + ($tw.boot.wikiTiddlersPath || "(none)") +
		"; " + $tw.wiki.allTitles().length + " tiddlers, " + $tw.wiki.allShadowTitles().length + " shadows";
}

function startLSPServer(options) {
	options = options || {};
	var transport = options.stdio ? "stdio" : (options.pipe ? "pipe" : "socket");
	$tw.lsp = {
		pid: process.pid,
		transport: transport,
		port: transport === "socket" ? (options.port || DEFAULT_PORT) : null,
		version: getServerVersion(),
		started: Date.now(),
		label: resolveLabel(options)
	};
	log(describeWiki());
	if(options.stdio) {
		startStdioServer();
		return;
	}
	if(options.pipe) {
		neverWrite();
		$tw.lsp.pipe = options.pipe;
		$tw.lsp.watcher = watch.startWatching({ log: log });
		log("Watching " + ($tw.lsp.watcher.roots.join(", ") || "no folders") + " for tiddler files changed on disk");
		$tw.lsp.mcpLink = require("$:/core/modules/commands/inspect/lsp/lsp-primary.js").createLink({
			log: log,
			onChange: function() {
				if($tw.lsp.announceMcpServer) {
					$tw.lsp.announceMcpServer();
				}
			},
			hello: {
				pid: process.pid,
				transport: "pipe",
				label: $tw.lsp.label || undefined,
				wiki: wikiFolder(),
				version: getServerVersion(),
				started: $tw.lsp.started
			}
		});
		$tw.lsp.connection = startPipeClient(options.pipe, { exit: options.exit });
		return;
	}
	// The folder .tw-mcp/connect uses, so every edition of one wiki converges there.
	var wikiDir = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js").getCanonicalWikiPath();
	if(wikiDir) {
		forgetOnExit(wikiDir);
	}
	$tw.lsp.server = startSocketServer(Object.assign({}, options, { discoveryDir: wikiDir }));
}

exports.startLSPServer = startLSPServer;
exports.startSocketServer = startSocketServer;
exports.startPipeClient = startPipeClient;
exports.describeWiki = describeWiki;
exports.resolveLabel = resolveLabel;
exports.forgetOnExit = forgetOnExit;
// Test seam. The lifecycle rules (initialize gate, capabilities, sync, shutdown)
// are the contract worth pinning, and none of it needs a socket to reach.
exports.createSession = createSession;
