/*\
title: $:/plugins/wikilabs/shared/sourcepos.js
type: application/javascript
module-type: library

Source-position tracking shared by wikilabs/tw-mcp-core and wikilabs/devtools:
one file, which devtools includes through its tiddlywiki.files, so both plugins
ship it under this title and a wiki loading both runs one copy.

\*/

"use strict";

// --- Source text geometry ---

// Cached per tiddler object, so an edited tiddler is measured again.
var geometryCache = Object.create(null);

function cached(key, title, compute) {
	var tiddler = $tw.wiki.getTiddler(title);
	var entry = geometryCache[key];
	if(!entry || entry.tiddler !== tiddler) {
		entry = geometryCache[key] = { tiddler: tiddler, value: compute() };
	}
	return entry.value;
}

function lineOffsets(text) {
	var offsets = [0];
	for(var i = 0; i < text.length; i++) {
		if(text.charAt(i) === "\n") offsets.push(i + 1);
	}
	return offsets;
}

// Character offset of each line start in a tiddler's text.
exports.getLineOffsets = function(title) {
	return cached("lines\0" + title, title, function() {
		return lineOffsets($tw.wiki.getTiddlerText(title, ""));
	});
};

// Inline text has no tiddler to cache on; one entry is enough, since a render parses one text.
var inlineLines = { text: null, offsets: null };

function inlineLineOffsets(text) {
	if(inlineLines.text !== text) {
		inlineLines = { text: text, offsets: lineOffsets(text) };
	}
	return inlineLines.offsets;
}

// 1-based line number holding charPos.
exports.charToLine = function(offsets, charPos) {
	var lo = 0, hi = offsets.length - 1;
	while(lo < hi) {
		var mid = (lo + hi + 1) >> 1;
		if(offsets[mid] <= charPos) lo = mid; else hi = mid - 1;
	}
	return lo + 1;
};

// Lines the .tid header occupies: one per field, plus the blank line that ends it.
exports.getTidHeaderLines = function(title) {
	return cached("header\0" + title, title, function() {
		var tiddler = $tw.wiki.getTiddler(title);
		if(!tiddler) return 0;
		var exclude = { "text": true, "bag": true, "revision": true };
		var fieldCount = 0;
		for(var f in tiddler.fields) {
			if(!exclude[f]) fieldCount++;
		}
		return fieldCount + 1;
	});
};

// Where a macro or procedure body starts inside its tiddler's text.
exports.findBodyOffset = function(title, bodyText) {
	return cached("body\0" + title + "\0" + bodyText.length, title, function() {
		var idx = $tw.wiki.getTiddlerText(title, "").indexOf(bodyText);
		return idx >= 0 ? idx : 0;
	});
};

// --- Where a rendered widget comes from ---

// The nearest source context above a widget: its tiddler, the offset into it, the variable that produced it, and the inline text it was parsed from, if any.
exports.getSourceInfo = function(widget) {
	for(var w = widget; w; w = w.parentWidget) {
		if(w.sourceContext !== undefined) {
			return { title: w.sourceContext, offset: w.sourceContextOffset || 0, via: w.sourceContextVariable, text: w.sourceContextText };
		}
	}
	return null;
};

// The distinct source contexts above the nearest one: closest caller first, outermost last.
exports.buildCallerChain = function(widget) {
	var chain = [], last = null;
	for(var w = widget; w; w = w.parentWidget) {
		if(w.sourceContext !== undefined && w.sourceContext !== last) {
			if(last !== null) chain.push(w.sourceContext);
			last = w.sourceContext;
		}
	}
	return chain;
};

// A widget's lines in its source tiddler's .tid file, header included, or in the inline text it was parsed from: { title, start, end }, or null.
exports.lineRange = function(widget) {
	var ptn = widget.parseTreeNode;
	if(!ptn || ptn.start === undefined) return null;
	var info = exports.getSourceInfo(widget);
	if(!info) return null;
	var inline = info.text !== undefined;
	var offsets = inline ? inlineLineOffsets(info.text) : exports.getLineOffsets(info.title);
	var header = inline ? 0 : exports.getTidHeaderLines(info.title);
	return {
		title: info.title,
		start: exports.charToLine(offsets, ptn.start + info.offset) + header,
		end: exports.charToLine(offsets, (ptn.end || ptn.start) + info.offset) + header
	};
};

// --- Widget patches ---

// Held on $tw rather than in this module, so re-executing the module cannot install the patches twice.
function patchState() {
	if(!$tw.wikilabsSourcePos) {
		$tw.wikilabsSourcePos = { holders: 0, restore: null };
	}
	return $tw.wikilabsSourcePos;
}

// Installs the patches on first use; the returned release() removes them once the last holder lets go.
exports.acquire = function() {
	var state = patchState();
	if(state.holders++ === 0) {
		state.restore = install();
	}
	var released = false;
	return function release() {
		if(released) return;
		released = true;
		if(--state.holders === 0) {
			state.restore();
			state.restore = null;
		}
	};
};

// Tags variables with their defining tiddler, fires the link and codeblock hooks core lacks, and carries source context through transclusion.
function install() {
	var Widget = require("$:/core/modules/widgets/widget.js").widget;
	var ImportVariablesWidget = require("$:/core/modules/widgets/importvariables.js").importvariables;
	var LinkWidget = require("$:/core/modules/widgets/link.js").link;
	var CodeBlockWidget = require("$:/core/modules/widgets/codeblock.js").codeblock;
	var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;
	var origSetVariable = Widget.prototype.setVariable;
	Widget.prototype.setVariable = function(name, value, params, isMacroDefinition, options) {
		origSetVariable.call(this, name, value, params, isMacroDefinition, options);
		if(options && options.sourceTitle && this.variables[name]) {
			this.variables[name].sourceTitle = options.sourceTitle;
		}
	};
	// importvariables passes no sourceTitle to setVariable, so map each imported name to its tiddler here.
	var origImportExecute = ImportVariablesWidget.prototype.execute;
	ImportVariablesWidget.prototype.execute = function(tiddlerList) {
		origImportExecute.call(this, tiddlerList);
		var varSourceMap = Object.create(null);
		var self = this;
		$tw.utils.each(this.tiddlerList, function(title) {
			var parser = self.wiki.parseTiddler(title, { parseAsInline: true, configTrimWhiteSpace: false });
			var node = parser && parser.tree[0];
			while(node && ["setvariable", "set", "parameters", "void"].includes(node.type)) {
				if(node.attributes && node.attributes.name) {
					varSourceMap[node.attributes.name.value] = title;
				}
				node = node.children && node.children[0];
			}
		});
		for(var ptr = this; ptr; ptr = (ptr.children && ptr.children.length === 1) ? ptr.children[0] : null) {
			var names = ptr.variables ? Object.keys(ptr.variables) : [];
			for(var i = 0; i < names.length; i++) {
				var v = ptr.variables[names[i]];
				if(v && !v.sourceTitle && varSourceMap[names[i]]) {
					v.sourceTitle = varSourceMap[names[i]];
				}
			}
		}
	};
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
	var origTranscludeExecute = TranscludeWidget.prototype.execute;
	TranscludeWidget.prototype.execute = function() {
		origTranscludeExecute.call(this);
		if(!$tw.wiki.trackSourcePositions) return;
		// With both $variable and $tiddler set, the parse tree comes from the variable.
		if(this.transcludeVariable) {
			var varInfo = this.getVariableInfo(this.transcludeVariable);
			var srcVar = varInfo && varInfo.srcVariable;
			this.sourceContext = (srcVar && srcVar.sourceTitle) || this.transcludeVariable;
			this.sourceContextOffset = (srcVar && srcVar.sourceTitle && srcVar.value) ? exports.findBodyOffset(srcVar.sourceTitle, srcVar.value) : 0;
			this.sourceContextVariable = this.transcludeVariable;
		} else if(this.transcludeTitle) {
			this.sourceContext = this.transcludeTitle;
			this.sourceContextOffset = 0;
		}
	};
	return function restore() {
		Widget.prototype.setVariable = origSetVariable;
		ImportVariablesWidget.prototype.execute = origImportExecute;
		LinkWidget.prototype.renderLink = origRenderLink;
		CodeBlockWidget.prototype.render = origCodeBlockRender;
		TranscludeWidget.prototype.execute = origTranscludeExecute;
	};
}
