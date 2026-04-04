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

When "listen" is specified, an HTTP server is started in the same process
before the MCP server, so browser edits and MCP tool calls share one $tw.wiki.
All --listen parameters (port, host, credentials, tls-*, etc.) are accepted.

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
	var listenParams = {};
	for(var i = 0; i < this.params.length; i++) {
		var param = this.params[i];
		if(param === "readonly") {
			options.readonly = true;
		} else if(param === "rw" || param === "readwrite") {
			options.readonly = false;
		} else if(param === "listen") {
			listenMode = true;
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
	return null;
};

exports.Command = Command;
