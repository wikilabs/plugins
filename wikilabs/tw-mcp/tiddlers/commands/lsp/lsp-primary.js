/*\
title: $:/core/modules/commands/inspect/lsp/lsp-primary.js
type: application/javascript
module-type: library

Links the LSP process an editor started to the MCP server of its wiki: the link
says who the LSP process is, notices the server come and go, and forwards files
saved in the editor, since each process holds its own copy of the wiki.

\*/

"use strict";

var net = $tw.node ? require("net") : null;

var mcpLib = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js");

var POLL_MS = 2000;
var TIMEOUT_MS = 3000;
// A pipe that is gone or refuses belongs to a server that stopped; the next poll looks again.
var GONE_CODES = ["ENOENT", "ECONNREFUSED", "ECONNRESET", "EPIPE"];

// options: hello (sent on connect), log, onChange(server or null), pollMs, timeoutMs, readDiscovery (test seam).
function createLink(options) {
	options = options || {};
	var log = options.log || function() {},
		onChange = options.onChange || function() {},
		readDiscovery = options.readDiscovery || mcpLib.readDiscoveryFile,
		timeoutMs = options.timeoutMs || TIMEOUT_MS,
		hello = Object.assign({}, options.hello),
		socket = null,
		server = null,
		connected = false,
		buffer = "",
		nextId = 1,
		pending = Object.create(null);

	function write(message) {
		message.params._meta = {};
		message.params._meta[mcpLib.TW_AUTH] = server.token;
		message.params._meta[mcpLib.TW_PID] = process.pid;
		message.params._meta[mcpLib.TW_LABEL] = hello.label || "lsp";
		socket.write(JSON.stringify(message) + "\n");
	}

	function sendHello() {
		write({ jsonrpc: "2.0", method: mcpLib.LSP_HELLO_METHOD, params: Object.assign({}, hello) });
	}

	function poll() {
		if(socket) {
			return;
		}
		var found = readDiscovery();
		if(!found || found.pid === process.pid) {
			return;
		}
		server = found;
		socket = net.connect(found.pipe);
		// The editor's pipe decides when this process ends, not this link.
		socket.unref();
		socket.on("connect", function() {
			connected = true;
			log("MCP server found: PID " + found.pid + (found.label ? " @" + found.label : "") + (found.listen && found.port ? ", browser on port " + found.port : ", no browser"));
			sendHello();
			onChange(describe(found));
		});
		socket.on("data", receive);
		socket.on("error", function(err) {
			if(!GONE_CODES.includes(err.code)) {
				log("MCP server connection failed: " + err.message);
			}
		});
		socket.on("close", function() {
			var wasConnected = connected;
			if(wasConnected) {
				log("MCP server gone: PID " + found.pid + (found.label ? " @" + found.label : ""));
			}
			socket = null;
			server = null;
			connected = false;
			buffer = "";
			failPending(new Error("the MCP server went away"));
			if(wasConnected) {
				onChange(null);
			}
		});
	}

	function receive(chunk) {
		buffer += chunk.toString("utf8");
		var lines = buffer.split("\n");
		buffer = lines.pop();
		lines.forEach(function(line) {
			var reply = line.trim() ? JSON.parse(line) : null,
				entry = reply && pending[reply.id];
			// Broadcasts reach every pipe client; only answers to this link's requests count.
			if(!entry) {
				return;
			}
			delete pending[reply.id];
			clearTimeout(entry.timer);
			if(reply.error) {
				entry.callback(new Error(reply.error.message));
			} else {
				entry.callback(null, reply.result.titles);
			}
		});
	}

	function failPending(err) {
		Object.keys(pending).forEach(function(id) {
			var entry = pending[id];
			delete pending[id];
			clearTimeout(entry.timer);
			entry.callback(err);
		});
	}

	// callback(err, titles): titles is undefined when no MCP server is linked, and
	// null when the server does not own the file.
	function reloadFile(filepath, callback) {
		if(!connected) {
			callback(null, undefined);
			return;
		}
		var id = nextId++;
		pending[id] = {
			callback: callback,
			timer: setTimeout(function() {
				delete pending[id];
				callback(new Error("the MCP server did not answer within " + timeoutMs + " ms"));
			}, timeoutMs)
		};
		write({ jsonrpc: "2.0", id: id, method: mcpLib.RELOAD_FILE_METHOD, params: { path: filepath } });
	}

	// Details learned later, such as the editor's name, are told again.
	function update(fields) {
		Object.assign(hello, fields);
		if(connected) {
			sendHello();
		}
	}

	// What an editor shows about the server: no token or pipe.
	function describe(found) {
		return { pid: found.pid, label: found.label || null, browserPort: found.listen && found.port ? found.port : null };
	}

	var timer = setInterval(poll, options.pollMs || POLL_MS);
	timer.unref();
	poll();

	return {
		reloadFile: reloadFile,
		update: update,
		isConnected: function() { return connected; },
		server: function() { return connected ? describe(server) : null; },
		close: function() {
			clearInterval(timer);
			if(socket) {
				socket.destroy();
			}
		}
	};
}

exports.createLink = createLink;
