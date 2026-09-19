/*\
title: $:/plugins/wikilabs/devtools/sourcepos.js
type: application/javascript
module-type: startup

Source position tracking in the browser: adds data-pos attributes to rendered
HTML elements, links and code blocks, tracing each back to its source tiddler
and line range. The widget patches and line geometry come from the module this
plugin shares with tw-mcp-core, $:/plugins/wikilabs/shared/sourcepos.js.

\*/

"use strict";

var sourcePosUtils = require("$:/plugins/wikilabs/devtools/utils.js");
var sourcePos = require("$:/plugins/wikilabs/shared/sourcepos.js");

exports.name = "sourcepos";
exports.after = ["startup"];
exports.before = ["render"];
exports.synchronous = true;

// Build the data-pos value with line numbers: L{start}-L{end} @ tiddlerTitle
function buildPosInfo(widget) {
	var range = sourcePos.lineRange(widget);
	return range ? sourcePosUtils.format(range.start, range.end, range.title) : null;
}

exports.startup = function() {
	// Held for the life of the page; the patches stay dormant until tracking is switched on.
	sourcePos.acquire();
	// Set initial state from config
	updateTracking();
	// Watch for config changes
	$tw.wiki.addEventListener("change", function(changes) {
		if(changes["$:/config/wikilabs/SourcePositionTracking"]) {
			updateTracking();
		}
	});
	// Shared hook logic for elements, links and code blocks
	var addSourcePos = function(domNode, widget) {
		if($tw.wiki.trackSourcePositions) {
			var posInfo = buildPosInfo(widget);
			if(posInfo) {
				domNode.setAttribute("data-pos", posInfo);
				// Store raw char range for precise editor selection
				// Offset adjusts for macro body position within the tiddler text
				var ptn = widget.parseTreeNode;
				var srcInfo = sourcePos.getSourceInfo(widget);
				var charOffset = srcInfo ? srcInfo.offset : 0;
				if(ptn && ptn.start !== undefined) {
					domNode.setAttribute("data-range", (ptn.start + charOffset) + "," + ((ptn.end || ptn.start) + charOffset));
				}
				// Add currentTiddler context so repeated list items can be distinguished
				var ct = widget.getVariable("currentTiddler");
				if(ct && srcInfo && ct !== srcInfo.title) {
					domNode.setAttribute("data-ctx", ct);
				}
				var callers = sourcePos.buildCallerChain(widget);
				if(callers.length > 0) {
					domNode.setAttribute("data-caller", callers.map(function(c) { return "← " + c; }).join("\n"));
				}
			}
			// Store widget back-reference for variable inspection
			domNode._twWidget = widget;
		}
		return domNode;
	};
	$tw.hooks.addHook("th-dom-rendering-element", addSourcePos);
	$tw.hooks.addHook("th-dom-rendering-link", addSourcePos);
	$tw.hooks.addHook("th-dom-rendering-codeblock", addSourcePos);
};

function updateTracking() {
	$tw.wiki.trackSourcePositions = $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking", "no").trim() === "yes";
}
