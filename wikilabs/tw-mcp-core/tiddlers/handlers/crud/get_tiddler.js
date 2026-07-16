/*\
title: $:/core/modules/commands/inspect/handlers/crud/get_tiddler.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: get_tiddler — single-tiddler read. Returns title-first
.tid/JSON/hashline forms; for plugin tiddlers shows the shadow-subtiddler
tree instead of the bundled text.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var crudShared = require("$:/core/modules/commands/inspect/handlers/crud/_shared.js");

module.exports = {
	"get_tiddler": function(args) {
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + args.title);
		}
		if(shared.isPluginTiddler(tiddler)) {
			var pluginInfo = $tw.wiki.getPluginInfo(args.title);
			var shadowTitles = pluginInfo && pluginInfo.tiddlers ? Object.keys(pluginInfo.tiddlers).sort() : [];
			var readmeTitle = args.title + "/readme";
			var readmeIdx = shadowTitles.indexOf(readmeTitle);
			if(readmeIdx > 0) {
				shadowTitles.splice(readmeIdx, 1);
				shadowTitles.unshift(readmeTitle);
			}
			var output = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]}) + "\n\n" + shared.formatTitleTree(shadowTitles, "shadow tiddlers");
			return shared.textResult(output);
		}
		var includeText = !!args.detailed || !!args.lines;
		var unsafe = crudShared.hasUnsafeFields(tiddler);
		if(args.format === "json") {
			return shared.textResult(shared.jsonStringify(crudShared.extractFieldsObject(tiddler, {includeText: includeText})));
		} else if(args.format === "tid") {
			var output = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]});
			if(includeText && tiddler.fields.text !== undefined) {
				output += "\n\n" + tiddler.fields.text;
			}
			return shared.textResult(output);
		} else {
			// Default (hashline): title-first tid headers for safe fields, JSON for unsafe, hashlined text
			var header;
			if(unsafe) {
				header = shared.jsonStringify(crudShared.extractFieldsObject(tiddler, {includeText: false}));
			} else {
				header = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]});
			}
			var output = header;
			if(includeText && tiddler.fields.text !== undefined) {
				var hashline = require("$:/core/modules/commands/inspect/hashline.js");
				output += "\n\n" + hashline.formatHashLines(tiddler.fields.text);
			}
			return shared.textResult(output);
		}
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["get_tiddler"].definition = {
	"description": "Get tiddler fields. Default: metadata only. detailed:true adds text field as hashlines ('LINE#HASH: text' per line; pass anchors to edit_tiddler). format='tid': plain text. Plugin tiddlers return fields + shadow-tiddler tree (format/detailed ignored).",
	"inputSchema": {
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"description": "The tiddler title"
			},
			"format": {
				"type": "string",
				"enum": [
					"tid",
					"json",
					"hashline"
				],
				"default": "hashline",
				"description": "hashline (default) — text with hash anchors for editing. tid — plain text. json — structured fields."
			},
			"detailed": {
				"type": "boolean",
				"default": false,
				"description": "Include the text field"
			}
		},
		"required": [
			"title"
		]
	}
};
