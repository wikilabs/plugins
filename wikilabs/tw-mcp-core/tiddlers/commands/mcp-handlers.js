/*\
title: $:/core/modules/commands/inspect/mcp-handlers.js
type: application/javascript
module-type: library

MCP tool dispatcher. Tool handlers are DISCOVERED: every module of
module-type `mcp-handler` contributes its exports to the tool map, keyed
by export name. Any plugin can add tools by shipping such a module — the
tw-mcp server plugin adds its node-only tools (filesystem, html-import,
admin, resave_tiddler) on top of this core set the same way.

Late-binding: the tool map is rebuilt on every handleToolCall so that
reload_mcp_modules can swap handler modules without invalidating any
captured reference in mcp-lib.js.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

function buildToolMap() {
	var map = {};
	$tw.modules.forEachModuleOfType("mcp-handler", function(title, mod) {
		var keys = Object.keys(mod);
		for(var k = 0; k < keys.length; k++) {
			map[keys[k]] = mod[keys[k]];
		}
	});
	return map;
}

function init(context) {
	shared.init(context);
}

function handleToolCall(name, args) {
	var toolMap = buildToolMap();
	var handler = toolMap[name];
	return handler ? handler(args) : null;
}

exports.init = init;
exports.handleToolCall = handleToolCall;
exports.buildTree = shared.buildTree;
