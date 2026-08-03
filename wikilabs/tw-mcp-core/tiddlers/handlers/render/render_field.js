/*\
title: $:/core/modules/commands/inspect/handlers/render/render_field.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: render_field — render a single field (or index entry)
as wikitext.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"render_field": function(args) {
		var outputType = args.output || "text/html";
		try {
			var value;
			if(args.index) {
				value = $tw.wiki.extractTiddlerDataItem(args.title, args.index, undefined);
				if(value === undefined) {
					return shared.errorResult( "Index '" + args.index + "' not found in tiddler '" + args.title + "'" );
				}
			} else {
				var tiddler = $tw.wiki.getTiddler(args.title);
				if(!tiddler) {
					return shared.errorResult( "Tiddler not found: " + args.title );
				}
				var fieldName = args.field || "text";
				value = tiddler.getFieldString(fieldName);
				if(value === undefined || value === "") {
					return shared.errorResult( "Field '" + fieldName + "' is empty or missing in '" + args.title + "'" );
				}
			}
			var rendered = shared.parseAndRender(value, "text/vnd.tiddlywiki", args.title);
			if(!rendered) {
				return shared.errorResult( "Render error: no parser" );
			}
			return shared.textResult( shared.containerToText(rendered.container, outputType) );
		} catch(e) {
			return shared.errorResult( "render_field error: " + e.message );
		}
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["render_field"].definition = {
	"description": "Render tiddler field or data tiddler index as wikitext. Errors on missing/empty (not silent empty).",
	"inputSchema": {
		"type": "object",
		"properties": {
			"title": {
				"type": "string",
				"description": "Tiddler title"
			},
			"field": {
				"type": "string",
				"default": "text",
				"description": "Field name (default: text)"
			},
			"index": {
				"type": "string",
				"description": "Data tiddler index (alternative to field)"
			},
			"output": {
				"type": "string",
				"enum": [
					"text/plain",
					"text/plain-formatted",
					"text/html"
				],
				"default": "text/html",
				"description": "Output type"
			}
		},
		"required": [
			"title"
		]
	}
};
