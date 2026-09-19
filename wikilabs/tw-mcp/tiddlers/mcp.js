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
  tiddlywiki ./wiki --mcp pear=<accountDir>   (serve a RUNNING Facets app)

Pear mode serves a running Facets (Pear) app instead of this process's wiki:
<accountDir> is a Facets account directory whose mcp.json discovery file
names the app's agent pipe. All other flags are ignored in pear mode; the
read/write mode follows the app's own mcp.flag. See mcp-pear.js.

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

var Command = function(params, commander, callback) {
	this.params = params;
	this.commander = commander;
	this.callback = callback;
};

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
	// Pear mode: the stdio front dials a running Facets app's pipe — no local
	// handlers, no HTTP, no primary/proxy machinery. Everything below is the
	// local-wiki path and does not apply.
	if(options.pearDir) {
		require("$:/core/modules/commands/inspect/mcp/mcp-pear.js").startPearMode(options);
		return null;
	}
	// Start HTTP server if listen mode is enabled
	if(listenMode) {
		var mcpLib = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js");
		var discovery = mcpLib.readDiscoveryFile();
		if(discovery && discovery.listen) {
			console.error("Primary already serves HTTP — skipping local HTTP server");
		} else {
			if(!$tw.boot.wikiTiddlersPath) {
				$tw.utils.warning("Warning: Wiki folder '" + $tw.boot.wikiPath + "' does not exist or is missing a tiddlywiki.info file");
			}
			// Only a plugin listed at boot yields a sync adaptor; loading one now would be too late.
			if(!$tw.syncadaptor) {
				$tw.utils.warning("Warning: browser edits stay in memory only, since no sync adaptor is loaded. Add tiddlywiki/filesystem to the plugins in tiddlywiki.info to save them to disk.");
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
