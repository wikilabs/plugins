/*\
title: $:/core/modules/commands/mcp.js
type: application/javascript
module-type: command

MCP (Model Context Protocol) server for TiddlyWiki.
Exposes wiki tools to Claude CLI and other MCP clients via stdio.

Usage (readonly by default):
  tiddlywiki ./wiki --mcp [label=<name>] [allowed-paths=<paths>]
  tiddlywiki ./wiki --mcp rw [label=<name>] [allowed-paths=<paths>]
  tiddlywiki ./wiki --mcp rw listen [port=<n>] [host=<h>] [label=<name>] ...
  tiddlywiki ./wiki --mcp rw sse    [port=<n>] [host=<h>] [label=<name>] ...
  tiddlywiki ./wiki --mcp pear=<accountDir> [label=<name>] [agent-key=<file>]
  tiddlywiki ./wiki --mcp route=<dir> [rw] [default-port=<n>] [label=<name>]

Route mode serves every tw-mcp primary running in a subfolder of <dir>, found
by its .tw-mcp/connect file. Tools gain a `wiki` argument; without it a call
goes to the wiki on default-port (8080). See mcp-route.js.

Pear mode serves a running Facets (Pear) app instead of this process's wiki:
<accountDir> is a Facets account directory whose mcp.json discovery file
names the app's agent pipe. All other flags are ignored in pear mode; the
read/write scope follows the agent's approved scope in the app. agent-key=
points at this instance's identity file, so one machine can run more than one
client; it defaults to ~/.tw-mcp/agent-key.json. See mcp-pear.js.

Single-file wiki workflow (runtime tools):
  Start a normal --mcp rw listen server against an empty wiki folder, then
  call import_html_wiki(path) to stage an HTML wiki for review and
  extract_html_wiki() to commit it to disk.

When "listen" is specified, an HTTP server is started in the same process
before the MCP server, so browser edits and MCP tool calls share one $tw.wiki.
All --listen parameters (port, host, credentials, tls-*, etc.) are accepted.
Without port=, or with port=8080, the first free port from 8080 up is used;
any other port= must be free.

When "sse" is specified, "listen" is implied AND the Server-Sent Events
endpoint at GET /events is enabled. Browsers that load this plugin will
receive per-tiddler change notifications instead of polling for the full
tiddler list — see $:/plugins/wikilabs/tw-mcp/sse/ for the
client-side adaptor and bootstrap.
If both "sse" and "listen" are given, sse wins (no error).

\*/

"use strict";

var Server = require("$:/core/modules/server/server.js").Server;

// Boot executes every command module, so tw-mcp-core code is required inside execute, after this check.
var CORE_MODULE = "$:/core/modules/commands/inspect/mcp-handlers.js";

exports.info = {
	name: "mcp",
	synchronous: true
};

var DEFAULT_PORT = 8080;
var MAX_PORT_TRIES = 100;

var PROBE_TIMEOUT_MS = 500;

/**
 * Tells whether any server answers on a port, on either loopback or the given host.
 * @param {number} port - TCP port
 * @param {string} [host] - the host= parameter
 * @param {function(boolean): void} callback - receives true if the port is taken
 * @returns {void}
 */
function isPortTaken(port, host, callback) {
	// A server on [::1]:8080 does not block 127.0.0.1:8080, but a browser opening localhost reaches either.
	var hosts = ["127.0.0.1", "::1"];
	if(host && !["localhost", "0.0.0.0", "::"].includes(host) && !hosts.includes(host)) {
		hosts.push(host);
	}
	var pending = hosts.length;
	var taken = false;
	hosts.forEach(function(h) {
		var socket = require("net").connect({ port: port, host: h });
		var finish = function(answered) {
			socket.destroy();
			taken = taken || answered;
			pending--;
			if(pending === 0) {
				callback(taken);
			}
		};
		socket.setTimeout(PROBE_TIMEOUT_MS, function() { finish(false); });
		socket.once("connect", function() { finish(true); });
		socket.once("error", function() { finish(false); });
	});
}

/**
 * Picks the HTTP port: the default steps up past busy ports, any other requested port must be free.
 * @param {string} [requestedPort] - the port= parameter
 * @param {string} [host] - the host= parameter
 * @param {function((string|null), string=): void} callback - receives an error message, or null and the port
 * @param {number} [defaultPort] - where stepping starts, 8080
 * @returns {void}
 */
function choosePort(requestedPort, host, callback, defaultPort) {
	defaultPort = defaultPort || DEFAULT_PORT;
	var stepping = requestedPort === undefined || requestedPort === String(defaultPort);
	// Server.listen reads a non-numeric port as an environment variable name; that lookup stays with it
	if(!stepping && parseInt(requestedPort, 10).toString() !== requestedPort) {
		return callback(null, requestedPort);
	}
	var port = stepping ? defaultPort : parseInt(requestedPort, 10);
	(function attempt() {
		isPortTaken(port, host, function(taken) {
			if(!taken) {
				return callback(null, String(port));
			}
			if(!stepping) {
				return callback("Port " + port + " is already in use. Stop the process that uses it, or choose another port=.");
			}
			if(port >= defaultPort + MAX_PORT_TRIES - 1) {
				return callback("Ports " + defaultPort + " to " + port + " are all in use. Choose a free port with port=.");
			}
			console.error("Port " + port + " is in use, trying " + (port + 1));
			port++;
			attempt();
		});
	})();
}

/**
 * The --mcp command.
 * @param {string[]} params - command parameters
 * @param {object} commander - TiddlyWiki commander
 * @param {function} callback - completion callback
 * @returns {void}
 */
var Command = function(params, commander, callback) {
	this.params = params;
	this.commander = commander;
	this.callback = callback;
};

/**
 * Starts the MCP server in the mode the parameters select.
 * @returns {(string|null)} Error message, or null
 */
Command.prototype.execute = function() {
	if(!$tw.modules.titles[CORE_MODULE]) {
		return "--mcp needs the wikilabs/tw-mcp-core plugin: add it to the plugins list in tiddlywiki.info, next to wikilabs/tw-mcp.";
	}
	var startMCPServer = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js").startMCPServer;
	// --lsp has the same guard, so the collision is refused whichever command
	// the user listed first.
	if($tw.lsp && $tw.lsp.transport === "stdio") {
		return "--mcp cannot run beside --lsp stdio: both would read stdin, and their framings differ. Use --lsp port=<n> instead.";
	}
	var options = { readonly: true }; // readonly by default
	var listenMode = false;
	var sseMode = false;
	var listenParams = {};
	for(var i = 0; i < this.params.length; i++) {
		var param = this.params[i];
		if(param === "readonly") {
			options.readonly = true;
		} else if(param === "rw" || param === "readwrite") {
			options.readonly = false;
		} else if(param === "listen") {
			listenMode = true;
		} else if(param === "sse") {
			listenMode = true;
			sseMode = true;
		} else if(param.indexOf("pear=") === 0) {
			options.pearDir = param.slice("pear=".length);
		} else if(param.startsWith("route=")) {
			options.routeDir = param.slice("route=".length);
		} else if(param.startsWith("default-port=")) {
			options.defaultPort = parseInt(param.slice("default-port=".length), 10);
		} else if(param.indexOf("allowed-paths=") === 0) {
			options.allowedPaths = param.slice("allowed-paths=".length).split(",");
		} else if(param.indexOf("label=") === 0) {
			options.label = param.slice("label=".length);
		} else if(param.indexOf("agent-key=") === 0) {
			options.agentKeyFile = param.slice("agent-key=".length);
		} else if(param.indexOf("=") !== -1) {
			// Named parameter — forward to listen server if in listen mode
			var eq = param.indexOf("=");
			listenParams[param.slice(0, eq)] = param.slice(eq + 1);
		}
	}
	// Pear mode: the stdio front dials a running Facets app's pipe — no local
	// handlers, no HTTP, no primary/proxy machinery. Everything below is the
	// local-wiki path and does not apply.
	if(options.pearDir) {
		require("$:/core/modules/commands/inspect/mcp/mcp-pear.js").startPearMode(options);
		return null;
	}
	// Route mode forwards to other primaries, so this process serves no wiki of its own.
	if(options.routeDir) {
		require("$:/core/modules/commands/inspect/mcp/mcp-route.js").startRouteMode(options);
		return null;
	}
	var wiki = this.commander.wiki;
	function startMCP() {
		startMCPServer(options);
		// SSE needs this process's own HTTP server, and must start after startMCPServer resets $tw.mcp.
		if(sseMode && $tw.httpServer) {
			require("$:/core/modules/server/sse-broadcaster.js").initialize(wiki);
			// Tells the browser bootstrap to use the SSE adaptor; $:/status/ keeps the marker off disk.
			wiki.addTiddler({
				title: "$:/status/wikilabs/tw-mcp/sse-server-active",
				text: "yes"
			});
			console.error("SSE enabled at GET /events");
		}
	}
	var discovery = listenMode && require("$:/core/modules/commands/inspect/mcp/mcp-lib.js").readDiscoveryFile();
	if(!listenMode || (discovery && discovery.listen)) {
		if(listenMode) {
			console.error("Primary already serves HTTP — skipping local HTTP server");
		}
		startMCP();
		return null;
	}
	if(!$tw.boot.wikiTiddlersPath) {
		$tw.utils.warning("Warning: Wiki folder '" + $tw.boot.wikiPath + "' does not exist or is missing a tiddlywiki.info file");
	}
	// Only a plugin listed at boot yields a sync adaptor; loading one now would be too late.
	if(!$tw.syncadaptor) {
		$tw.utils.warning("Warning: browser edits stay in memory only, since no sync adaptor is loaded. Add tiddlywiki/filesystem to the plugins in tiddlywiki.info to save them to disk.");
	}
	// The port is probed first, so MCP starts once HTTP has its port; stdin input waits in its buffer meanwhile.
	choosePort(listenParams.port, listenParams.host, function(err, port) {
		if(err) {
			console.error(err);
			process.exit(1);
		}
		var server = new Server({
			wiki: wiki,
			variables: listenParams
		});
		var nodeServer = server.listen(port);
		nodeServer.on("error", function(e) {
			if(e.code === "EADDRINUSE") {
				console.error("Port " + e.port + " was taken while starting. Start the server again.");
				process.exit(1);
			}
			throw e;
		});
		$tw.httpServer = {
			server: server,
			nodeServer: nodeServer,
			heartbeat: function() {
				return {
					listening: nodeServer.listening,
					address: nodeServer.address()
				};
			}
		};
		$tw.hooks.invokeHook("th-server-command-post-start", server, nodeServer, "tiddlywiki");
		startMCP();
	});
	return null;
};

exports.Command = Command;
// Test seams: port choice without starting a server.
exports.choosePort = choosePort;
exports.isPortTaken = isPortTaken;
