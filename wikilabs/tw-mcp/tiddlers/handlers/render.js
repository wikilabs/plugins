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
		try {
			var widgetNode = $tw.wiki.makeTranscludeWidget(args.title, {
				document: $tw.fakeDocument,
				importPageMacros: true
			});
			var container = $tw.fakeDocument.createElement("div");
			widgetNode.render(container, null);
			var text;
			if(outputType === "text/html") {
				text = container.innerHTML;
			} else if(outputType === "text/plain-formatted") {
				text = container.formattedTextContent;
			} else {
				text = container.textContent;
			}
			return { content: [{ type: "text", text: text }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Render error: " + e.message }] };
		}
	},

	"render_text": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return { isError: true, content: [{ type: "text", text: "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH }] };
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		var outputType = args.output || "text/plain";
		try {
			if(outputType === "parsetree") {
				var parser = $tw.wiki.parseText(inputType, args.text, { parseAsInline: false });
				if(!parser) {
					return { isError: true, content: [{ type: "text", text: "No parser for type: " + inputType }] };
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
				return { content: [{ type: "text", text: header + JSON.stringify(compactTree, null, $tw.config.preferences.jsonSpaces) }] };
			}
			var rendered = shared.parseAndRender(args.text, inputType, args.context);
			if(!rendered) {
				return { isError: true, content: [{ type: "text", text: "No parser for type: " + inputType }] };
			}
			var text;
			if(outputType === "text/html") {
				text = rendered.container.innerHTML;
			} else if(outputType === "text/plain-formatted") {
				text = rendered.container.formattedTextContent;
			} else {
				text = rendered.container.textContent;
			}
			return { content: [{ type: "text", text: text }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Render error: " + e.message }] };
		}
	}
};
