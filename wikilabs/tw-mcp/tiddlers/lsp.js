/*\
title: $:/core/modules/commands/lsp.js
type: application/javascript
module-type: command

LSP (Language Server Protocol) server for TiddlyWiki.
Offers editors title completion and broken-link diagnostics over wikitext.

Usage:
  tiddlywiki ./wiki --lsp [port=<n>] [host=<h>] [label=<name>]
  tiddlywiki ./wiki --lsp stdio [label=<name>]
  tiddlywiki ./wiki --lsp pipe=<name> [label=<name>]

label= names this LSP server in both its own log and the MCP server's; without
it, "label" in the "lsp" section of tiddlywiki.info, else lsp-<wiki folder name>.

pipe= is how an editor starts a wiki of its own: the process connects to the
named pipe the editor created, serves that one session, never writes to disk,
and exits when the pipe closes.

It composes with --mcp on one command line, which is the point: both commands
run in the same process against the same $tw.wiki, so a tiddler renamed over
MCP is a title the editor stops offering. Two separate processes would each
boot their own wiki and drift.

  tiddlywiki ./wiki --mcp rw listen --lsp port=6009

Without port=, the server takes 6009, or any free port when 6009 is in use. The
port it got is written to .tw-mcp/lsp in the wiki folder, where the editor
extension looks for it.

Socket is the default because --mcp already owns stdio when both are given, and
the two protocols do not share a framing: MCP is newline-delimited JSON, LSP
counts bytes in a Content-Length header. "stdio" is therefore refused when an
MCP server is running in this process.

\*/

"use strict";

var startLSPServer = require("$:/core/modules/commands/inspect/lsp/lsp-lib.js").startLSPServer;

exports.info = {
	name: "lsp",
	synchronous: true
};

var Command = function(params, commander, callback) {
	this.params = params;
	this.commander = commander;
	this.callback = callback;
};

Command.prototype.execute = function() {
	var options = {};
	for(var i = 0; i < this.params.length; i++) {
		var param = this.params[i];
		if(param === "stdio") {
			options.stdio = true;
		} else if(param.startsWith("pipe=")) {
			options.pipe = param.slice("pipe=".length);
		} else if(param.startsWith("port=")) {
			options.port = parseInt(param.slice("port=".length), 10);
		} else if(param.startsWith("host=")) {
			options.host = param.slice("host=".length);
		} else if(param.startsWith("label=")) {
			options.label = param.slice("label=".length);
		}
	}
	if(options.stdio && options.pipe) {
		return "--lsp takes stdio or pipe=<name>, not both";
	}
	if(options.stdio && $tw.mcp) {
		return "--lsp stdio cannot run beside --mcp: both would read the same pipe, and their framings differ. Use --lsp port=<n> instead.";
	}
	if(options.port !== undefined && !(options.port >= 0 && options.port < 65536)) {
		return "--lsp port must be a number between 0 (any free port) and 65535";
	}
	startLSPServer(options);
	return null;
};

exports.Command = Command;
