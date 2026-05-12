/*\
title: $:/core/modules/commands/inspect/handlers/render/render_text.js
type: application/javascript
module-type: library

MCP tool handler: render_text — parse/render arbitrary wikitext or other
parser input. output='parsetree' returns the compacted parse tree as JSON.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"render_text": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		var outputType = args.output || "text/plain";
		// TW core's getParser silently falls back to text/vnd.tiddlywiki for
		// any unrecognised type. Without this surfacing, a caller passing
		// `type: "application/json"` (or any other unhandled MIME) would get
		// wikitext output with no signal that their type arg was ignored.
		var fallbackNote = shared.parserFallbackWarning(args.type);
		try {
			if(outputType === "parsetree") {
				var parser = $tw.wiki.parseText(inputType, args.text, { parseAsInline: false });
				var excludeSet = shared.toSet(args.exclude);
				var includeSet = shared.toSet(args.include);
				var compactValue = function(val) {
					if(val === null || val === undefined || typeof val !== "object") return val;
					if(Array.isArray(val)) return val.map(compactValue);
					var out = {};
					for(var k in val) {
						if(excludeSet[k]) continue;
						if(k === "text" && typeof val[k] === "string" && !includeSet.text) {
							out.text = "s:" + val[k].length;
						} else if(k === "orderedAttributes" && Array.isArray(val[k]) && !includeSet.orderedAttributes) {
							out.orderedAttributes = "{" + val[k].length + " attrs}";
						} else if(typeof val[k] === "object" && val[k] !== null) {
							out[k] = compactValue(val[k]);
						} else {
							out[k] = val[k];
						}
					}
					return out;
				};
				var compactTree = parser.tree.map(compactValue);
				var header = "";
				if(fallbackNote) header += fallbackNote + "\n";
				if(excludeSet.start || excludeSet.end) {
					var removed = [];
					if(excludeSet.start) removed.push("start");
					if(excludeSet.end) removed.push("end");
					header += "(excluded: " + removed.join(", ") + ")\n";
				}
				return shared.textResult( header + shared.jsonStringify(compactTree) );
			}
			var rendered = shared.parseAndRender(args.text, inputType, args.context);
			var output = shared.containerToText(rendered.container, outputType);
			if(fallbackNote) output = fallbackNote + "\n\n" + output;
			return shared.textResult( output );
		} catch(e) {
			return shared.errorResult( "Render error: " + e.message );
		}
	}
};
