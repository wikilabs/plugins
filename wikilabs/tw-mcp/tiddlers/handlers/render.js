/*\
title: $:/core/modules/commands/inspect/handlers/render.js
type: application/javascript
module-type: library

MCP tool handlers for rendering operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"render_tiddler": function(args) {
		var outputType = args.type || "text/plain";
		var mode = args.mode || "raw";
		try {
			var container, widgetNode;
			if(mode === "viewtemplate") {
				var cascadeFilter = "[all[shadows+tiddlers]tag[$:/tags/ViewTemplateBodyFilter]!is[draft]get[text]]";
				var templateTitle = $tw.wiki.filterTiddlers(
					"[[" + args.title.replace(/[\[\]]/g, "") + "]] :cascade" + cascadeFilter
				)[0] || "$:/core/ui/ViewTemplate/body/default";
				var wikitext = "\\whitespace trim\n<$tiddler tiddler=\"\"\"" + args.title + "\"\"\">\n<$transclude $tiddler=\"\"\"" + templateTitle + "\"\"\"/>\n</$tiddler>";
				var rendered = shared.parseAndRender(wikitext, "text/vnd.tiddlywiki", args.title);
				if(!rendered) {
					return shared.errorResult( "Render error: failed to render viewtemplate" );
				}
				container = rendered.container;
			} else {
				widgetNode = $tw.wiki.makeTranscludeWidget(args.title, {
					document: $tw.fakeDocument,
					importPageMacros: true
				});
				container = $tw.fakeDocument.createElement("div");
				widgetNode.render(container, null);
			}
			var text;
			if(outputType === "text/html") {
				text = container.innerHTML;
			} else if(outputType === "text/plain-formatted") {
				text = container.formattedTextContent;
			} else {
				text = container.textContent;
			}
			return shared.textResult( text );
		} catch(e) {
			return shared.errorResult( "Render error: " + e.message );
		}
	},

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
			var text;
			if(outputType === "text/html") {
				text = rendered.container.innerHTML;
			} else if(outputType === "text/plain-formatted") {
				text = rendered.container.formattedTextContent;
			} else {
				text = rendered.container.textContent;
			}
			return shared.textResult( text );
		} catch(e) {
			return shared.errorResult( "render_field error: " + e.message );
		}
	},

	"render_text": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		var outputType = args.output || "text/plain";
		try {
			if(outputType === "parsetree") {
				var parser = $tw.wiki.parseText(inputType, args.text, { parseAsInline: false });
				if(!parser) {
					return shared.errorResult( "No parser for type: " + inputType );
				}
				var excludeSet = {};
				if(args.exclude) {
					for(var ei = 0; ei < args.exclude.length; ei++) {
						excludeSet[args.exclude[ei]] = true;
					}
				}
				var includeSet = {};
				if(args.include) {
					for(var ii = 0; ii < args.include.length; ii++) {
						includeSet[args.include[ii]] = true;
					}
				}
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
				if(excludeSet.start || excludeSet.end) {
					var removed = [];
					if(excludeSet.start) removed.push("start");
					if(excludeSet.end) removed.push("end");
					header = "(excluded: " + removed.join(", ") + ")\n";
				}
				return shared.textResult( header + JSON.stringify(compactTree, null, $tw.config.preferences.jsonSpaces) );
			}
			var rendered = shared.parseAndRender(args.text, inputType, args.context);
			if(!rendered) {
				return shared.errorResult( "No parser for type: " + inputType );
			}
			var text;
			if(outputType === "text/html") {
				text = rendered.container.innerHTML;
			} else if(outputType === "text/plain-formatted") {
				text = rendered.container.formattedTextContent;
			} else {
				text = rendered.container.textContent;
			}
			return shared.textResult( text );
		} catch(e) {
			return shared.errorResult( "Render error: " + e.message );
		}
	}
};
