/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_pos.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: inspect_pos — render text with source-position
attributes (p=, v=, ctx=, c=) on every DOM element. Hot-path tool.
The tracking itself comes from $:/plugins/wikilabs/shared/sourcepos.js, shared with devtools.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var sourcePos = require("$:/plugins/wikilabs/shared/sourcepos.js");

// Post-process inspect_pos DOM: replace verbose data-pos attributes
// with compact p="idx:lines" format. Returns title index header + innerHTML.
// Browser devtools keeps the full format; this compaction is MCP-only.
var SVG_TAGS = {"svg":1,"path":1,"g":1,"circle":1,"rect":1,"line":1,"polygon":1,
	"polyline":1,"ellipse":1,"use":1,"defs":1,"marker":1,"clipPath":1,"text":1,"tspan":1};

function compactPositions(container) {
	var titleMap = [];
	var titleIndex = {};
	var walk = function(node, inSvg) {
		if(!node.children) return;
		for(var i = 0; i < node.children.length; i++) {
			var child = node.children[i];
			if(!child.tag) continue;
			var isSvg = inSvg || SVG_TAGS[child.tag];
			// Strip the raw character range — line numbers in p= are sufficient
			child.removeAttribute("data-range");
			var pos = child.getAttribute && child.getAttribute("data-pos");
			if(pos) {
				if(isSvg) {
					child.removeAttribute("data-pos");
				} else {
					var sepIdx = pos.indexOf(shared.SOURCE_POS_SEPARATOR);
					if(sepIdx !== -1) {
						var range = pos.slice(0, sepIdx);
						var title = pos.slice(sepIdx + shared.SOURCE_POS_SEPARATOR.length);
						var idx;
						if(titleIndex[title] !== undefined) {
							idx = titleIndex[title];
						} else {
							idx = titleMap.length;
							titleIndex[title] = idx;
							titleMap.push(title);
						}
						range = range.replace(/L/g, "");
						child.removeAttribute("data-pos");
						child.setAttribute("p", idx + ":" + range);
					} else {
						child.removeAttribute("data-pos");
					}
				}
			}
			var via = child.getAttribute && child.getAttribute("data-via");
			if(via) {
				child.removeAttribute("data-via");
				if(!isSvg) child.setAttribute("v", via);
			}
			var ctx = child.getAttribute && child.getAttribute("data-ctx");
			if(ctx) {
				child.removeAttribute("data-ctx");
				if(!isSvg) child.setAttribute("ctx", ctx);
			}
			var caller = child.getAttribute && child.getAttribute("data-caller");
			if(caller) {
				child.removeAttribute("data-caller");
				if(!isSvg) child.setAttribute("c", caller);
			}
			walk(child, isSvg);
		}
	};
	walk(container, false);
	var header = "";
	if(titleMap.length > 0) {
		var parts = [];
		for(var i = 0; i < titleMap.length; i++) {
			parts.push(i + "=" + titleMap[i]);
		}
		header = "[" + parts.join(" ") + "]\n";
	}
	return header + container.innerHTML;
}

// Writes the attributes compactPositions() turns into p=, v=, ctx= and c=.
function posHook(domNode, widget) {
	if(!$tw.wiki.trackSourcePositions) return domNode;
	var range = sourcePos.lineRange(widget);
	if(range) domNode.setAttribute("data-pos", shared.formatSourcePos(range.start, range.end, range.title));
	var srcInfo = sourcePos.getSourceInfo(widget);
	if(srcInfo && srcInfo.via) {
		domNode.setAttribute("data-via", srcInfo.via);
	}
	// currentTiddler only where it differs from the source tiddler, which tells repeated list items apart.
	var ct = widget.getVariable("currentTiddler");
	if(ct && srcInfo && ct !== srcInfo.title) {
		domNode.setAttribute("data-ctx", ct);
	}
	var callers = sourcePos.buildCallerChain(widget);
	if(callers.length > 0) {
		domNode.setAttribute("data-caller", callers.join("|"));
	}
	return domNode;
}

module.exports = {
	"inspect_pos": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		try {
			var built = shared.buildWrappedTree(args.text, inputType, args.context);
			if(!built) {
				return shared.errorResult( "No parser for type: " + inputType );
			}
			// Restored, not forced off: with devtools loaded a user may have
			// turned tracking on, and a tool call must not switch it off.
			var trackingWas = $tw.wiki.trackSourcePositions;
			$tw.wiki.trackSourcePositions = true;
			// Added after devtools' own hooks, so our data-pos wins where both write it.
			$tw.hooks.addHook("th-dom-rendering-element", posHook);
			$tw.hooks.addHook("th-dom-rendering-link", posHook);
			$tw.hooks.addHook("th-dom-rendering-codeblock", posHook);
			// Installs the widget patches unless devtools already holds them.
			var releasePatches = sourcePos.acquire();
			try {
				var posWidget = $tw.wiki.makeWidget(built.wrappedTree, built.widgetOptions);
				posWidget.sourceContext = args.context || "(inline)";
				var posContainer = $tw.fakeDocument.createElement("div");
				posWidget.render(posContainer, null);
				return shared.textResult( compactPositions(posContainer) );
			} finally {
				$tw.wiki.trackSourcePositions = trackingWas;
				$tw.hooks.removeHook("th-dom-rendering-element", posHook);
				$tw.hooks.removeHook("th-dom-rendering-link", posHook);
				$tw.hooks.removeHook("th-dom-rendering-codeblock", posHook);
				releasePatches();
			}
		} catch(e) {
			return shared.errorResult( "inspect_pos error: " + e.message );
		}
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["inspect_pos"].definition = {
	"description": "Render wikitext to HTML with source-position attrs + title index header. Header: [0=Title 1=Title ...]. Each node may carry p=\"idx:line\" or p=\"idx:start-end\" (idx→header, lines in defining tiddler), v=\"name\" (transcluded procedure/macro/variable that produced this node), c=\"A|B|C\" (caller chain — closest enclosing transclude first, outermost last), and ctx=\"Title\" (currentTiddler when it differs from the source-context tiddler — distinguishes repeated list items). Pair with inspect_scope.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"text": {
				"type": "string",
				"description": "Wikitext to render"
			},
			"type": {
				"type": "string",
				"default": "text/vnd.tiddlywiki"
			},
			"context": {
				"type": "string",
				"description": "Context tiddler"
			}
		},
		"required": [
			"text"
		]
	}
};
