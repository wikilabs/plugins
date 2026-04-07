/*\
title: $:/core/modules/commands/inspect/mcp-handlers.js
type: application/javascript
module-type: library

MCP tool handler implementations for TiddlyWiki MCP server.
Delegates to domain-specific handler modules in ./handlers/.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// Build tool map by merging all domain handler modules
var toolMap = {};
var modules = [
	require("$:/core/modules/commands/inspect/handlers/crud.js"),
	require("$:/core/modules/commands/inspect/handlers/query.js"),
	require("$:/core/modules/commands/inspect/handlers/render.js"),
	require("$:/core/modules/commands/inspect/handlers/inspect.js"),
	require("$:/core/modules/commands/inspect/handlers/filesystem.js"),
	require("$:/core/modules/commands/inspect/handlers/html-import.js")
];
for(var i = 0; i < modules.length; i++) {
	var mod = modules[i];
	var keys = Object.keys(mod);
	for(var k = 0; k < keys.length; k++) {
		toolMap[keys[k]] = mod[keys[k]];
	}
}

function init(context) {
	shared.init(context);
}

function handleToolCall(name, args) {
	var handler = toolMap[name];
	return handler ? handler(args) : null;
}

exports.init = init;
exports.handleToolCall = handleToolCall;
exports.buildTree = shared.buildTree;
