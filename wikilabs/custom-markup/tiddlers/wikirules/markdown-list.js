/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/markdown-list.js
type: application/javascript
module-type: wikirule

Markdown-style list block rule. Fires only when the markdown vocabulary
is active for the tiddler being parsed (`;vocab=Markdown` in the type
field or `\importcustom` activation).

Recognises `-`, `*`, `+` for `<ul>` items and `<digits>.` for `<ol>`
items. Nesting uses indent: every 2 spaces (or 1 tab) is one deeper
level. A blank line or any non-list line ends the list. Each item's
body is a single inline run (no nested block parsing in v1).

\*/

"use strict";

exports.name = "markdown-list";
exports.types = {block: true};

var ITEM_RE = /^([ \t]*)([-*+]|\d+\.)[ \t]+/mg;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = ITEM_RE;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
	}
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.isActiveVocab("vocab/markdown")) {
		return undefined;
	}
	var regex = new RegExp(ITEM_RE.source, "mg");
	regex.lastIndex = startPos;
	var match = regex.exec(this.parser.source);
	if(!match) { return undefined; }
	this.match = match;
	return match.index;
};

exports.parse = function() {
	var parser = this.parser;
	// Multiple top-level lists are possible when consecutive blocks of
	// different list types appear at level 0 with no blank line between
	// them. Each goes into roots; TW renders them as siblings.
	var roots = [];
	// stack[level] = { listNode, listType }
	var stack = [];

	while(true) {
		var regex = new RegExp(ITEM_RE.source, "mg");
		regex.lastIndex = parser.pos;
		var match = regex.exec(parser.source);
		if(!match || match.index !== parser.pos) {
			break;
		}

		var indent = match[1].replace(/\t/g, "  ").length;
		var level = Math.floor(indent / 2);
		var prefix = match[2];
		var listType = /^[-*+]$/.test(prefix) ? "ul" : "ol";

		// Can't skip levels — clamp to stack depth.
		if(level > stack.length) { level = stack.length; }

		// Truncate any deeper levels still on the stack.
		while(stack.length > level + 1) { stack.pop(); }

		// Same level but different list type → close and reopen at this level.
		if(stack.length === level + 1 && stack[level].listType !== listType) {
			stack.pop();
		}

		// Open a list at this level if missing.
		if(stack.length === level) {
			var newList = {type: "element", tag: listType, children: []};
			if(level === 0) {
				roots.push(newList);
			} else {
				var parentList = stack[level - 1].listNode;
				var parentItem = parentList.children[parentList.children.length - 1];
				parentItem.children.push(newList);
			}
			stack.push({listNode: newList, listType: listType});
		}

		parser.pos = match.index + match[0].length;
		// eatTerminator so parser.pos lands just past the newline. Without
		// it the default skipWhitespace would swallow the next line's
		// leading indent — which is how nesting level is signalled.
		var bodyTree = parser.parseInlineRun(/(\r?\n)/mg, {eatTerminator: true});

		stack[level].listNode.children.push({
			type: "element",
			tag: "li",
			children: bodyTree
		});
	}

	return roots;
};
