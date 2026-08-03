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

// Tool advertisement, discovered like the tool map: each handler function
// carries its MCP definition as `fn.definition` ({description, inputSchema,
// write}); the name is the export key. Sorted by name for a deterministic
// tools/list. Handlers without a definition are callable but unadvertised.
function getToolDefinitions(isReadonly) {
	var defs = [];
	var toolMap = buildToolMap();
	var names = Object.keys(toolMap);
	for(var i = 0; i < names.length; i++) {
		var d = toolMap[names[i]] && toolMap[names[i]].definition;
		if(!d) continue;
		if(isReadonly && d.write) continue;
		defs.push({ name: names[i], description: d.description, inputSchema: d.inputSchema });
	}
	defs.sort(function(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
	return defs;
}

// {toolName: true} for every advertised write tool — mcp-lib's proxy path
// filters readonly tools/list responses with it.
function getWriteToolNames() {
	var names = {};
	var toolMap = buildToolMap();
	for(var name in toolMap) {
		var d = toolMap[name] && toolMap[name].definition;
		if(d && d.write) names[name] = true;
	}
	return names;
}

exports.init = init;
exports.handleToolCall = handleToolCall;
exports.getToolDefinitions = getToolDefinitions;
exports.getWriteToolNames = getWriteToolNames;
exports.buildTree = shared.buildTree;
