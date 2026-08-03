/*\
title: $:/core/modules/commands/inspect/handlers/crud/put_tiddler.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: put_tiddler — create new tiddler or full-rewrite an
existing one. Without overwrite, an existing title triggers uniquify.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"put_tiddler": function(args) {
		var denied = shared.checkWritable("put_tiddler");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "put_tiddler");
		if(titleErr) return titleErr;
		var title = args.title,
			existingTiddler = $tw.wiki.getTiddler(title),
			creationFields = $tw.wiki.getCreationFields(),
			modificationFields = $tw.wiki.getModificationFields(),
			tiddler;
		if(existingTiddler && args.overwrite) {
			tiddler = new $tw.Tiddler(existingTiddler.fields, args.fields, modificationFields, {title: title});
		} else if(existingTiddler) {
			title = $tw.wiki.generateNewTitle(title);
			tiddler = new $tw.Tiddler(creationFields, args.fields, modificationFields, {title: title});
		} else {
			tiddler = new $tw.Tiddler(creationFields, args.fields, modificationFields, {title: title});
		}
		return shared.persistTiddler(tiddler, title, "saved");
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["put_tiddler"].definition = {
	"description": "Create or update tiddler, persists to disk. overwrite=true replaces existing. WITHOUT overwrite: existing-title silently creates duplicate with uniquified title (e.g. 'MyTiddler 1') — does NOT error. Check response title; use overwrite=true or edit_tiddler when updating.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"maxLength": 1024,
				"description": "Tiddler title (max 1024 chars)"
			},
			"fields": {
				"type": "object",
				"description": "Tiddler fields (text, tags, type, etc.)",
				"additionalProperties": true
			},
			"overwrite": {
				"type": "boolean",
				"default": false
			}
		},
		"required": [
			"title",
			"fields"
		]
	},
	"write": true
};
