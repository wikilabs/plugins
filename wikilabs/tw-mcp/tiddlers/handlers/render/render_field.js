/*\
title: $:/core/modules/commands/inspect/handlers/render/render_field.js
type: application/javascript
module-type: library

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
