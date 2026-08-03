/*\
title: $:/core/modules/commands/inspect/handlers/crud/edit_tiddler.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: edit_tiddler — apply hashline-anchored edits to an
existing tiddler's text, optionally also setting/deleting other fields.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"edit_tiddler": function(args) {
		var denied = shared.checkWritable("edit_tiddler");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "edit_tiddler");
		if(titleErr) return titleErr;
		var hashline = require("$:/core/modules/commands/inspect/hashline.js");
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + args.title);
		}
		// Apply text edits if provided
		var newText = tiddler.fields.text || "";
		if(args.edits && args.edits.length > 0) {
			var edits = [];
			for(var i = 0; i < args.edits.length; i++) {
				var e = args.edits[i];
				var edit = { op: e.op, lines: e.lines || [] };
				if(e.pos) edit.pos = hashline.parseTag(e.pos);
				if(e.end) edit.end = hashline.parseTag(e.end);
				edits.push(edit);
			}
			try {
				var result = hashline.applyEdits(newText, edits);
				newText = result.text;
			} catch(e) {
				if(e.name === "HashlineMismatchError") {
					return shared.errorResult(e.message);
				}
				return shared.errorResult("Edit failed: " + e.message);
			}
		}
		// Build updated fields
		var updates = { text: newText };
		if(args.set_fields) {
			for(var key in args.set_fields) {
				if(key !== "text" && key !== "title") {
					updates[key] = args.set_fields[key];
				}
			}
		}
		var title = args.title;
		var modificationFields = $tw.wiki.getModificationFields();
		var newTiddler = new $tw.Tiddler(tiddler.fields, updates, modificationFields, { title: title });
		// Delete fields if requested
		if(args.delete_fields && args.delete_fields.length > 0) {
			var fieldsToKeep = {};
			for(var f in newTiddler.fields) {
				if(args.delete_fields.indexOf(f) === -1) {
					fieldsToKeep[f] = newTiddler.fields[f];
				}
			}
			newTiddler = new $tw.Tiddler(fieldsToKeep);
		}
		return shared.persistTiddler(newTiddler, title, "edited");
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["edit_tiddler"].definition = {
	"description": "Edit tiddler text and/or fields. Text edits via LINE#HASH anchors (e.g. '5#AB'); anchors come from get_tiddler. Stale anchors → HashlineMismatchError lists fresh anchors for retry. Fields via set_fields/delete_fields. One call covers both.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"maxLength": 1024,
				"description": "Tiddler title (max 1024 chars)"
			},
			"edits": {
				"type": "array",
				"description": "Text line edits using hashline anchors (optional if only changing fields)",
				"items": {
					"type": "object",
					"properties": {
						"op": {
							"type": "string",
							"enum": [
								"replace_line",
								"replace_range",
								"append_at",
								"prepend_at"
							]
						},
						"pos": {
							"type": "string",
							"description": "LINE#HASH anchor (e.g. '5#AB')"
						},
						"end": {
							"type": "string",
							"description": "End anchor for replace_range"
						},
						"lines": {
							"type": "array",
							"items": {
								"type": "string"
							},
							"description": "New lines to insert/replace"
						}
					},
					"required": [
						"op",
						"lines"
					]
				}
			},
			"set_fields": {
				"type": "object",
				"description": "Fields to add or update (key: value). Does not affect text field — use edits for text.",
				"additionalProperties": true
			},
			"delete_fields": {
				"type": "array",
				"items": {
					"type": "string"
				},
				"description": "Field names to remove"
			}
		},
		"required": [
			"title"
		]
	},
	"write": true
};
