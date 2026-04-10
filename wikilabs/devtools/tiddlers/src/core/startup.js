/*\
title: $:/plugins/wikilabs/devtools/startup.js
type: application/javascript
module-type: startup

Source position tracking plugin. Adds data-pos attributes to rendered
HTML elements and links, tracing each back to its source tiddler and line range.

All tracking logic lives in this plugin — no core modifications required.
Uses th-dom-rendering-element and th-dom-rendering-link hooks for elements/links,
and monkey-patches the transclude widget to set sourceContext for tiddler attribution.

\*/

"use strict";

var sourcePosUtils = require("$:/plugins/wikilabs/devtools/utils.js");

exports.name = "sourcepos";
exports.before = ["startup"];
exports.after = ["load-modules"];
exports.synchronous = true;

// Caches (reset on each tracking toggle to avoid stale data)
var lineCache = {};
var headerCache = {};
var bodyOffsetCache = {};

// Build array of line-start character offsets for a tiddler's text
function getLineOffsets(title) {
	if(lineCache[title]) return lineCache[title];
	var text = $tw.wiki.getTiddlerText(title, "");
	var offsets = [0];
	for(var i = 0; i < text.length; i++) {
		if(text.charAt(i) === "\n") offsets.push(i + 1);
	}
	lineCache[title] = offsets;
	return offsets;
}

// Binary search: character offset → 1-based line number
function charToLine(offsets, charPos) {
	var lo = 0, hi = offsets.length - 1;
	while(lo < hi) {
		var mid = (lo + hi + 1) >> 1;
		if(offsets[mid] <= charPos) lo = mid; else hi = mid - 1;
	}
	return lo + 1;
}

// Count .tid file header lines (fields excluding text + 1 blank separator)
function getTidHeaderLines(title) {
	if(headerCache[title] !== undefined) return headerCache[title];
	var tiddler = $tw.wiki.getTiddler(title);
	if(!tiddler) {
		headerCache[title] = 0;
		return 0;
	}
	// Exclude fields not written to .tid files: 'text' (body), 'bag' (excluded by
	// $:/core/templates/tid-tiddler), and 'revision' (sync adapter runtime field)
	var exclude = {"text": true, "bag": true, "revision": true};
	var fieldCount = 0;
	for(var f in tiddler.fields) {
		if(!exclude[f]) fieldCount++;
	}
	headerCache[title] = fieldCount + 1; // fields + empty line
	return headerCache[title];
}

// Find the character offset where a variable body starts within the full tiddler text
function findBodyOffset(title, bodyText) {
	var key = title + "\0" + bodyText.length;
	if(bodyOffsetCache[key] !== undefined) return bodyOffsetCache[key];
	var fullText = $tw.wiki.getTiddlerText(title, "");
	var idx = fullText.indexOf(bodyText);
	bodyOffsetCache[key] = idx >= 0 ? idx : 0;
	return bodyOffsetCache[key];
}

// Walk up the widget tree to find the nearest sourceContext
function getSourceInfo(widget) {
	var w = widget;
	while(w) {
		if(w.sourceContext !== undefined) {
			return { title: w.sourceContext, offset: w.sourceContextOffset || 0 };
		}
		w = w.parentWidget;
	}
	return null;
}

// Build the transclusion caller chain by walking up sourceContext changes.
// Stops at the first non-system tiddler to avoid showing TW's internal
// UI template chain ($:/core/ui/ViewTemplate, PageTemplate, etc.)
function buildCallerChain(widget) {
	var chain = [];
	var lastContext = null;
	var w = widget;
	while(w) {
		if(w.sourceContext !== undefined && w.sourceContext !== lastContext) {
			if(lastContext !== null) {
				chain.push(w.sourceContext);
			}
			lastContext = w.sourceContext;
		}
		w = w.parentWidget;
	}
	return chain;
}

// Build the data-pos value with line numbers: L{start}-L{end} @ tiddlerTitle
function buildPosInfo(widget) {
	var ptn = widget.parseTreeNode;
	if(!ptn || ptn.start === undefined) {
		return null;
	}
	var info = getSourceInfo(widget);
	if(!info) {
		return null;
	}
	var offsets = getLineOffsets(info.title);
	var absStart = ptn.start + info.offset;
	var absEnd = (ptn.end || ptn.start) + info.offset;
	var startLine = charToLine(offsets, absStart);
	var endLine = charToLine(offsets, absEnd);
	var headerOffset = getTidHeaderLines(info.title);
	return sourcePosUtils.format(startLine + headerOffset, endLine + headerOffset, info.title);
}

exports.startup = function() {
	// --- Prototype patches for core widgets (no core modifications required) ---

	// Patch setVariable to store sourceTitle for variable-to-tiddler attribution
	var Widget = require("$:/core/modules/widgets/widget.js").widget;
	var origSetVariable = Widget.prototype.setVariable;
	Widget.prototype.setVariable = function(name, value, params, isMacroDefinition, options) {
		origSetVariable.call(this, name, value, params, isMacroDefinition, options);
		if(options && options.sourceTitle && this.variables[name]) {
			this.variables[name].sourceTitle = options.sourceTitle;
		}
	};

	// Patch importvariables to propagate sourceTitle through imported globals
	var ImportVariablesWidget = require("$:/core/modules/widgets/importvariables.js").importvariables;
	var origImportExecute = ImportVariablesWidget.prototype.execute;
	ImportVariablesWidget.prototype.execute = function(tiddlerList) {
		origImportExecute.call(this, tiddlerList);
		// Build map: variable name → source tiddler title
		var varSourceMap = Object.create(null);
		var self = this;
		$tw.utils.each(this.tiddlerList, function(title) {
			var parser = self.wiki.parseTiddler(title, {parseAsInline: true, configTrimWhiteSpace: false});
			if(parser) {
				var node = parser.tree[0];
				while(node && ["setvariable", "set", "parameters", "void"].indexOf(node.type) !== -1) {
					if(node.attributes && node.attributes.name) {
						varSourceMap[node.attributes.name.value] = title;
					}
					node = node.children && node.children[0];
				}
			}
		});
		// Walk the widget chain and tag variables that lack sourceTitle
		var ptr = this;
		while(ptr) {
			if(ptr.variables) {
				var ownKeys = Object.keys(ptr.variables);
				for(var ki = 0; ki < ownKeys.length; ki++) {
					var v = ptr.variables[ownKeys[ki]];
					if(v && !v.sourceTitle && varSourceMap[ownKeys[ki]]) {
						v.sourceTitle = varSourceMap[ownKeys[ki]];
					}
				}
			}
			ptr = (ptr.children && ptr.children.length === 1) ? ptr.children[0] : null;
		}
	};

	// Patch link widget to invoke th-dom-rendering-link hook
	var LinkWidget = require("$:/core/modules/widgets/link.js").link;
	var origRenderLink = LinkWidget.prototype.renderLink;
	LinkWidget.prototype.renderLink = function(parent, nextSibling) {
		origRenderLink.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-link", this.domNodes[this.domNodes.length - 1], this);
		}
	};

	// Patch codeblock widget to invoke th-dom-rendering-codeblock hook
	var CodeBlockWidget = require("$:/core/modules/widgets/codeblock.js").codeblock;
	var origCodeBlockRender = CodeBlockWidget.prototype.render;
	CodeBlockWidget.prototype.render = function(parent, nextSibling) {
		origCodeBlockRender.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-codeblock", this.domNodes[this.domNodes.length - 1], this);
		}
	};

	// --- Source position tracking setup ---

	// Set initial state from config
	updateTracking();
	// Watch for config changes
	$tw.wiki.addEventListener("change", function(changes) {
		if(changes["$:/config/wikilabs/SourcePositionTracking"]) {
			updateTracking();
		}
	});
	// Shared hook logic for elements and links
	var addSourcePos = function(domNode, widget) {
		if($tw.wiki.trackSourcePositions) {
			var posInfo = buildPosInfo(widget);
			if(posInfo) {
				domNode.setAttribute("data-pos", posInfo);
				// Store raw char range for precise editor selection
				// Offset adjusts for macro body position within the tiddler text
				var ptn = widget.parseTreeNode;
				var srcInfo = getSourceInfo(widget);
				var charOffset = srcInfo ? srcInfo.offset : 0;
				if(ptn && ptn.start !== undefined) {
					domNode.setAttribute("data-range", (ptn.start + charOffset) + "," + ((ptn.end || ptn.start) + charOffset));
				}
				var callers = buildCallerChain(widget);
				// Add currentTiddler context so repeated list items can be distinguished
				var ct = widget.getVariable("currentTiddler");
				var info = getSourceInfo(widget);
				if(ct && info && ct !== info.title) {
					domNode.setAttribute("data-ctx", ct);
				}
				if(callers.length > 0) {
					domNode.setAttribute("data-caller", callers.map(function(c) { return "\u2190 " + c; }).join("\n"));
				}
			}
			// Store widget back-reference for variable inspection
			domNode._twWidget = widget;
		}
		return domNode;
	};
	// Hook: add data-pos to element DOM nodes
	$tw.hooks.addHook("th-dom-rendering-element", addSourcePos);
	// Hook: add data-pos to link DOM nodes
	$tw.hooks.addHook("th-dom-rendering-link", addSourcePos);
	// Hook: add data-pos to codeblock DOM nodes
	$tw.hooks.addHook("th-dom-rendering-codeblock", addSourcePos);
	// Monkey-patch transclude widget to set sourceContext for position attribution
	var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;
	var origExecute = TranscludeWidget.prototype.execute;
	TranscludeWidget.prototype.execute = function() {
		origExecute.call(this);
		// Set source context after execute so transcludeTitle/transcludeVariable are resolved
		if($tw.wiki.trackSourcePositions) {
			// Check transcludeVariable first — when both $variable and $tiddler are set,
			// the parse tree comes from the variable definition, not the tiddler
			if(this.transcludeVariable) {
				var varInfo = this.getVariableInfo(this.transcludeVariable);
				var srcVar = varInfo && varInfo.srcVariable;
				this.sourceContext = (srcVar && srcVar.sourceTitle) || this.transcludeVariable;
				this.sourceContextOffset = 0;
				if(srcVar && srcVar.sourceTitle && srcVar.value) {
					this.sourceContextOffset = findBodyOffset(srcVar.sourceTitle, srcVar.value);
				}
			} else if(this.transcludeTitle) {
				this.sourceContext = this.transcludeTitle;
				this.sourceContextOffset = 0;
			}
		}
	};
};

function updateTracking() {
	var enabled = $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking", "no").trim() === "yes";
	$tw.wiki.trackSourcePositions = enabled;
	// Clear caches when tracking state changes
	if(enabled) {
		lineCache = {};
		headerCache = {};
		bodyOffsetCache = {};
	}
}
