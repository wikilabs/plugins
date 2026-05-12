/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_pos.js
type: application/javascript
module-type: library

MCP tool handler: inspect_pos — render text with source-position
attributes (p=, v=, ctx=, c=) on every DOM element. Hot-path tool;
includes all pos tracking + widget-prototype patching machinery.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var inspectShared = require("$:/core/modules/commands/inspect/handlers/inspect/_shared.js");

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
// All inspect_pos machinery lives here so the handler stays orchestration.
// Pure helpers (charToLine, posGetSourceInfo, posBuildCallerChain) are
// stateless. createPosTracker() bundles the line/header/body-offset caches
// plus the hook + posBuildInfo function that share them. patchPosWidgets()
// wires up the widget-prototype monkey-patches and returns a restore()
// callback for the handler's finally block.

function charToLine(offsets, charPos) {
	var lo = 0, hi = offsets.length - 1;
	while(lo < hi) {
		var mid = (lo + hi + 1) >> 1;
		if(offsets[mid] <= charPos) lo = mid; else hi = mid - 1;
	}
	return lo + 1;
}

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

function createPosTracker() {
	var lineCache = {};
	var headerCache = {};
	var bodyOffsetCache = {};
	function getLineOffsets(title) {
		if(lineCache[title]) return lineCache[title];
		var text = $tw.wiki.getTiddlerText(title, "");
		var offsets = [0];
		for(var ci = 0; ci < text.length; ci++) {
			if(text.charAt(ci) === "\n") offsets.push(ci + 1);
		}
		lineCache[title] = offsets;
		return offsets;
	}
	function getTidHeaderLines(title) {
		if(headerCache[title] !== undefined) return headerCache[title];
		var tiddler = $tw.wiki.getTiddler(title);
		if(!tiddler) { headerCache[title] = 0; return 0; }
		var exclude = {"text": true, "bag": true, "revision": true};
		var fieldCount = 0;
		for(var f in tiddler.fields) {
			if(!exclude[f]) fieldCount++;
		}
		headerCache[title] = fieldCount + 1;
		return headerCache[title];
	}
	function findBodyOffset(title, bodyText) {
		var key = title + "\0" + bodyText.length;
		if(bodyOffsetCache[key] !== undefined) return bodyOffsetCache[key];
		var fullText = $tw.wiki.getTiddlerText(title, "");
		var idx = fullText.indexOf(bodyText);
		bodyOffsetCache[key] = idx >= 0 ? idx : 0;
		return bodyOffsetCache[key];
	}
	function posBuildInfo(widget) {
		var ptn = widget.parseTreeNode;
		if(!ptn || ptn.start === undefined) return null;
		var info = posGetSourceInfo(widget);
		if(!info) return null;
		var offsets = getLineOffsets(info.title);
		var absStart = ptn.start + info.offset;
		var absEnd = (ptn.end || ptn.start) + info.offset;
		var startLine = charToLine(offsets, absStart);
		var endLine = charToLine(offsets, absEnd);
		var headerOffset = getTidHeaderLines(info.title);
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
	return { posHook: posHook, findBodyOffset: findBodyOffset };
}

// Monkey-patch widget prototypes so source-context flows through transclusion
// boundaries. Returns a restore() callback the caller MUST invoke in finally.
// tracker is the createPosTracker() result; only its findBodyOffset is read.
// The variable-source-tracking half (Widget.setVariable + ImportVariablesWidget)
// is in inspect/_shared.js so inspect_scope can apply it standalone.
function patchPosWidgets(tracker) {
	var LinkWidget = require("$:/core/modules/widgets/link.js").link;
	var CodeBlockWidget = require("$:/core/modules/widgets/codeblock.js").codeblock;
	var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;
	var restoreSourceTitle = inspectShared.patchSourceTitleTracking();
	// TW core only emits th-dom-rendering-element natively; the link and
	// codeblock equivalents come from devtools' renderLink/render patches.
	// Patch them ourselves so inspect_pos works regardless of whether the
	// devtools plugin is loaded.
	var origRenderLink = LinkWidget.prototype.renderLink;
	LinkWidget.prototype.renderLink = function(parent, nextSibling) {
		origRenderLink.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-link", this.domNodes[this.domNodes.length - 1], this);
		}
	};
	var origCodeBlockRender = CodeBlockWidget.prototype.render;
	CodeBlockWidget.prototype.render = function(parent, nextSibling) {
		origCodeBlockRender.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-codeblock", this.domNodes[this.domNodes.length - 1], this);
		}
	};
	var origExecute = TranscludeWidget.prototype.execute;
	TranscludeWidget.prototype.execute = function() {
		origExecute.call(this);
		if($tw.wiki.trackSourcePositions) {
			if(this.transcludeVariable) {
				var varInfo = this.getVariableInfo(this.transcludeVariable);
				var srcVar = varInfo && varInfo.srcVariable;
				this.sourceContext = (srcVar && srcVar.sourceTitle) || this.transcludeVariable;
				this.sourceContextOffset = 0;
				this.sourceContextVariable = this.transcludeVariable;
				if(srcVar && srcVar.sourceTitle && srcVar.value) {
					this.sourceContextOffset = tracker.findBodyOffset(srcVar.sourceTitle, srcVar.value);
				}
			} else if(this.transcludeTitle) {
				this.sourceContext = this.transcludeTitle;
				this.sourceContextOffset = 0;
			}
		}
	};
	return function restore() {
		restoreSourceTitle();
		LinkWidget.prototype.renderLink = origRenderLink;
		CodeBlockWidget.prototype.render = origCodeBlockRender;
		TranscludeWidget.prototype.execute = origExecute;
	};
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
			$tw.wiki.trackSourcePositions = true;
			var tracker = createPosTracker();
			$tw.hooks.addHook("th-dom-rendering-element", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-link", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-codeblock", tracker.posHook);
			var restorePatches = patchPosWidgets(tracker);
			try {
				var posWidget = $tw.wiki.makeWidget(built.wrappedTree, built.widgetOptions);
				posWidget.sourceContext = args.context || "(inline)";
				var posContainer = $tw.fakeDocument.createElement("div");
				posWidget.render(posContainer, null);
				return shared.textResult( compactPositions(posContainer) );
			} finally {
				$tw.wiki.trackSourcePositions = false;
				$tw.hooks.removeHook("th-dom-rendering-element", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-link", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-codeblock", tracker.posHook);
				restorePatches();
			}
		} catch(e) {
			return shared.errorResult( "inspect_pos error: " + e.message );
		}
	}
};
