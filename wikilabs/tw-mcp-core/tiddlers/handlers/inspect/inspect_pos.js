/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_pos.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: inspect_pos — render text with source-position
attributes (p=, v=, ctx=, c=) on every DOM element. Hot-path tool.
The widget patches that feed it come from devtools' sourcepos.js.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

var DEVTOOLS_UTILS = "$:/plugins/wikilabs/devtools/utils.js";

// devtools is a declared dependent, but a wiki can still be assembled without
// it. Requiring it at load time would abort the whole tool map, taking every
// other tool down with inspect_pos, because $tw.modules.execute() sends a
// missing module to $tw.utils.error(), which exits the process on node. So
// look it up when it is needed and check it is there first.
function devtoolsUtils() {
	return $tw.modules.titles[DEVTOOLS_UTILS] ? require(DEVTOOLS_UTILS) : null;
}

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

// --- inspect_pos helpers (hoisted to module scope) -----------------------
//
// The handler stays orchestration: posGetSourceInfo and posBuildCallerChain are
// stateless, createPosTracker() bundles the hook with the posBuildInfo that
// formats a position the MCP way, and the source geometry comes from devtools'
// utils.js.

function posGetSourceInfo(widget) {
	var w = widget;
	while(w) {
		if(w.sourceContext !== undefined) {
			return {
				title: w.sourceContext,
				offset: w.sourceContextOffset || 0,
				via: w.sourceContextVariable
			};
		}
		w = w.parentWidget;
	}
	return null;
}

// Walk parent widgets and collect the chain of distinct sourceContexts
// above the immediate one. Closest enclosing caller first, outermost last.
function posBuildCallerChain(widget) {
	var chain = [], lastCtx = null, w = widget;
	while(w) {
		if(w.sourceContext !== undefined && w.sourceContext !== lastCtx) {
			if(lastCtx !== null) chain.push(w.sourceContext);
			lastCtx = w.sourceContext;
		}
		w = w.parentWidget;
	}
	return chain;
}

function createPosTracker(sourcePosUtils) {
	function posBuildInfo(widget) {
		var ptn = widget.parseTreeNode;
		if(!ptn || ptn.start === undefined) return null;
		var info = posGetSourceInfo(widget);
		if(!info) return null;
		var offsets = sourcePosUtils.getLineOffsets(info.title);
		var absStart = ptn.start + info.offset;
		var absEnd = (ptn.end || ptn.start) + info.offset;
		var startLine = sourcePosUtils.charToLine(offsets, absStart);
		var endLine = sourcePosUtils.charToLine(offsets, absEnd);
		var headerOffset = sourcePosUtils.getTidHeaderLines(info.title);
		return shared.formatSourcePos(startLine + headerOffset, endLine + headerOffset, info.title);
	}
	function posHook(domNode, widget) {
		if(!$tw.wiki.trackSourcePositions) return domNode;
		var info = posBuildInfo(widget);
		if(info) domNode.setAttribute("data-pos", info);
		var srcInfo = posGetSourceInfo(widget);
		if(srcInfo && srcInfo.via) {
			domNode.setAttribute("data-via", srcInfo.via);
		}
		// currentTiddler context — only when it differs from the
		// source-context tiddler (e.g. inside a list iterating over items,
		// where each repetition has the same source position).
		var ct = widget.getVariable("currentTiddler");
		if(ct && srcInfo && ct !== srcInfo.title) {
			domNode.setAttribute("data-ctx", ct);
		}
		var callers = posBuildCallerChain(widget);
		if(callers.length > 0) {
			domNode.setAttribute("data-caller", callers.join("|"));
		}
		return domNode;
	}
	return { posHook: posHook };
}

// The widget patches that make source context flow through transclusion, emit
// the link and codeblock hooks, and tag variables with their defining tiddler
// all live in devtools' sourcepos.js, installed once at boot and dormant until
// trackSourcePositions is on. Carrying a second copy here double-fired every
// hook when both plugins were loaded (bead tw-mcp-server-bay), so tw-mcp-core
// declares devtools a dependent and uses those.

module.exports = {
	"inspect_pos": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		var sourcePosUtils = devtoolsUtils();
		if(!sourcePosUtils) {
			return shared.errorResult( "inspect_pos needs the wikilabs/devtools plugin, which supplies the source-position tracking. Add it to this wiki's plugin list and restart." );
		}
		try {
			var built = shared.buildWrappedTree(args.text, inputType, args.context);
			if(!built) {
				return shared.errorResult( "No parser for type: " + inputType );
			}
			// Restored, not forced off: with devtools loaded a user may have
			// turned tracking on, and a tool call must not switch it off.
			var trackingWas = $tw.wiki.trackSourcePositions;
			$tw.wiki.trackSourcePositions = true;
			var tracker = createPosTracker(sourcePosUtils);
			// Added after devtools' own hooks, so our data-pos wins where both write it.
			$tw.hooks.addHook("th-dom-rendering-element", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-link", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-codeblock", tracker.posHook);
			try {
				var posWidget = $tw.wiki.makeWidget(built.wrappedTree, built.widgetOptions);
				posWidget.sourceContext = args.context || "(inline)";
				var posContainer = $tw.fakeDocument.createElement("div");
				posWidget.render(posContainer, null);
				return shared.textResult( compactPositions(posContainer) );
			} finally {
				$tw.wiki.trackSourcePositions = trackingWas;
				$tw.hooks.removeHook("th-dom-rendering-element", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-link", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-codeblock", tracker.posHook);
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
