/*\
title: $:/core/modules/commands/inspect/handlers/render/render_tiddler.js
type: application/javascript
module-type: library

MCP tool handler: render_tiddler — render a tiddler's body (raw mode) or
its ViewTemplate cascade body (viewtemplate mode).

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
					"[[" + shared.sanitiseFilterOperand(args.title) + "]] :cascade" + cascadeFilter
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
			return shared.textResult( shared.containerToText(container, outputType) );
		} catch(e) {
			return shared.errorResult( "Render error: " + e.message );
		}
	}
};
