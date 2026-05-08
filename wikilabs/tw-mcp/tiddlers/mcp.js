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

Single-file wiki workflow (runtime tools):
  Start a normal --mcp rw listen server against an empty wiki folder, then
  call import_html_wiki(path) to stage an HTML wiki for review and
  extract_html_wiki() to commit it to disk.

When "listen" is specified, an HTTP server is started in the same process
before the MCP server, so browser edits and MCP tool calls share one $tw.wiki.
All --listen parameters (port, host, credentials, tls-*, etc.) are accepted.

When "sse" is specified, "listen" is implied AND the Server-Sent Events
endpoint at GET /events is enabled. Browsers that load this plugin will
receive per-tiddler change notifications instead of polling for the full
tiddler list every 60s — see $:/plugins/wikilabs/tw-mcp/sse/ for the
client-side adaptor and bootstrap.
If both "sse" and "listen" are given, sse wins (no error).

\*/

"use strict";

var startMCPServer = require("$:/core/modules/commands/inspect/mcp-lib.js").startMCPServer;
var Server = require("$:/core/modules/server/server.js").Server;

exports.info = {
	name: "mcp",
	synchronous: true
};

var Command = function(params, commander, callback) {
	this.params = params;
	this.commander = commander;
	this.callback = callback;
};

Command.prototype.execute = function() {
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
		} else if(param.indexOf("allowed-paths=") === 0) {
			options.allowedPaths = param.slice("allowed-paths=".length).split(",");
		} else if(param.indexOf("label=") === 0) {
			options.label = param.slice("label=".length);
		} else if(param.indexOf("=") !== -1) {
			// Named parameter — forward to listen server if in listen mode
			var eq = param.indexOf("=");
			listenParams[param.slice(0, eq)] = param.slice(eq + 1);
		}
	}
	// Load the filesystem plugin if not already present (needed for disk persistence)
	if(!options.readonly && !$tw.wiki.getTiddler("$:/plugins/tiddlywiki/filesystem")) {
		$tw.loadPlugins(["tiddlywiki/filesystem"], $tw.config.pluginsPath, $tw.config.pluginsEnvVar);
		$tw.wiki.registerPluginTiddlers("plugin");
		$tw.wiki.unpackPluginTiddlers();
	}
	// Start HTTP server if listen mode is enabled
	if(listenMode) {
		var mcpLib = require("$:/core/modules/commands/inspect/mcp-lib.js");
		var discovery = mcpLib.readDiscoveryFile();
		if(discovery && discovery.listen) {
			console.error("Primary already serves HTTP — skipping local HTTP server");
		} else {
			if(!$tw.boot.wikiTiddlersPath) {
				$tw.utils.warning("Warning: Wiki folder '" + $tw.boot.wikiPath + "' does not exist or is missing a tiddlywiki.info file");
			}
			var server = new Server({
				wiki: this.commander.wiki,
				variables: listenParams
			});
			var nodeServer = server.listen();
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
		}
	}
	startMCPServer(options);
	// SSE init must run after startMCPServer because that resets $tw.mcp.
	// Only enable when this process owns the HTTP server (i.e. listenMode succeeded
	// and we did not fall through to "Primary already serves HTTP" — guarded by $tw.httpServer).
	if(sseMode && $tw.httpServer) {
		var sseLib = require("$:/core/modules/server/sse-broadcaster.js");
		sseLib.initialize(this.commander.wiki);
		// Signal browser-side bootstrap that --mcp sse is active so it can
		// take over the syncadaptor; without this, the SSE adaptor stays
		// dormant and tiddlyweb's polling adaptor is used.
		// Marker lives under $:/status/ so the default SyncFilter excludes it
		// from disk persistence (otherwise a subsequent start without --mcp sse
		// would still see the stale "yes" loaded from .tid)
		this.commander.wiki.addTiddler({
			title: "$:/status/wikilabs/tw-mcp/sse-server-active",
			text: "yes"
		});
		console.error("SSE enabled at GET /events");
	}
	return null;
};

exports.Command = Command;
