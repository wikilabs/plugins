/*\
title: $:/core/modules/commands/inspect/mcp-handlers.js
type: application/javascript
module-type: library

MCP tool handler implementations for TiddlyWiki MCP server.
Delegates to domain-specific handler modules in ./handlers/.

Late-binding: the tool map is rebuilt on every handleToolCall so that
reload_mcp_modules can swap handler modules without invalidating any
captured reference in mcp-lib.js.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

var handlerModulePaths = [
	"$:/core/modules/commands/inspect/handlers/crud.js",
	"$:/core/modules/commands/inspect/handlers/query.js",
	"$:/core/modules/commands/inspect/handlers/render.js",
	"$:/core/modules/commands/inspect/handlers/inspect.js",
	"$:/core/modules/commands/inspect/handlers/filesystem.js",
	"$:/core/modules/commands/inspect/handlers/html-import.js",
	"$:/core/modules/commands/inspect/handlers/admin.js"
];

function buildToolMap() {
	var map = {};
	for(var i = 0; i < handlerModulePaths.length; i++) {
		var mod = require(handlerModulePaths[i]);
		var keys = Object.keys(mod);
		for(var k = 0; k < keys.length; k++) {
			map[keys[k]] = mod[keys[k]];
		}
	}
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
exports.handlerModulePaths = handlerModulePaths;
