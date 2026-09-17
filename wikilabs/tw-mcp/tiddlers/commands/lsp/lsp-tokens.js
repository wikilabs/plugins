/*\
title: $:/core/modules/commands/inspect/lsp/lsp-tokens.js
type: application/javascript
module-type: library

Semantic tokens: each name classified by what it means where it is written, which
a TextMate grammar cannot know. A parameter is told from a global of the same
name, a core macro from your own, and a filter operator from the field test a
misspelt one becomes. A name nothing defines gets no token; its hint says why.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	names = require("$:/core/modules/commands/inspect/lsp/lsp-names.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js");

// Standard LSP types, so any theme that colours them colours these; "tiddlywiki" is a name sent without its
// type, which no theme colours.
var LEGEND = {
	tokenTypes: ["function", "macro", "class", "parameter", "variable", "method", "property", "tiddlywiki"],
	tokenModifiers: ["declaration", "defaultLibrary"]
};

var DECLARATION = 1,
	DEFAULT_LIBRARY = 2,
	UNTYPED = LEGEND.tokenTypes.indexOf("tiddlywiki");

var TYPE_OF_KIND = { procedure: "function", "function": "function", macro: "macro", widget: "class", javascript: "macro" };

// The kinds of name a client can colour one by one.
var COLOR_KINDS = ["definitions", "calls", "parameters", "variables", "operators", "fieldTests"],
	COLOR_KIND_OF_TYPE = { parameter: "parameters", variable: "variables", method: "operators", property: "fieldTests" };

// The whole document as { data } in the protocol's relative encoding. options.colors is true, false, or
// { <kind>: true } per COLOR_KINDS; a name whose kind is not coloured is sent untyped. options.italic false
// drops defaultLibrary, options.bold false drops declaration; a name left with nothing to show is not sent.
function semanticTokens(uri, text, options) {
	options = Object.assign({ colors: true, italic: true, bold: true }, options);
	function isColored(kind) {
		return options.colors !== null && typeof options.colors === "object" ? !!options.colors[kind] : options.colors !== false;
	}
	var body = source.bodyOf(uri, text);
	if(!files.isWikitext(uri, body) || (!COLOR_KINDS.some(isColored) && !options.italic && !options.bold)) {
		return { data: [] };
	}
	var tree = source.parseWithBodies(body.text),
		found = [];
	function add(range, type, modifiers) {
		var colored = isColored(COLOR_KIND_OF_TYPE[type] || (modifiers & DECLARATION ? "definitions" : "calls"));
		modifiers &= (options.italic ? DEFAULT_LIBRARY : 0) | (options.bold ? DECLARATION : 0);
		if(colored || modifiers) {
			found.push({ range: range, type: colored ? LEGEND.tokenTypes.indexOf(type) : UNTYPED, modifiers: modifiers });
		}
	}
	function rangeAt(start, end) {
		return { start: source.positionAt(body.starts, body.offset + start), end: source.positionAt(body.starts, body.offset + end) };
	}
	files.sitesOfDocument(uri, text).forEach(function(site) {
		var meaning = site.definition ? { type: TYPE_OF_KIND[site.kind], modifiers: DECLARATION } : meaningOf(site, body, tree);
		if(meaning) {
			add(site.range, meaning.type, meaning.modifiers);
		}
	});
	calls.sitesIn(body.text).definitions.forEach(function(definition) {
		definition.params.forEach(function(param) {
			var declared = scope.parameterDeclaration(definition.range, body.text, param.name);
			if(declared) {
				add(rangeAt(declared.start, declared.end), "parameter", DECLARATION);
			}
		});
	});
	names.operatorsWritten(body.text, tree).forEach(function(step) {
		// A dotted name is a function, which the call sites cover.
		if(step.operator.includes(".")) {
			return;
		}
		var module = $tw.wiki.getFilterOperators()[step.operator] ? modules.moduleOfFilterOperator(step.operator) : null;
		add(rangeAt(step.start, step.end), module ? "method" : "property", fromCore(module) ? DEFAULT_LIBRARY : 0);
	});
	return { data: encode(found) };
}

// What a call means where it is written: a binding in reach, a definition the wiki finds, or a
// variable TiddlyWiki sets itself; null for a name nothing defines.
function meaningOf(site, body, tree) {
	var name = site.name;
	// A header field is rendered elsewhere, out of reach of this body's bindings and definitions.
	var inBody = site.start >= 0,
		binding = inBody && name.charAt(0) !== "$" ? scope.resolve(name, site.start, tree, body.text) : null;
	if(binding) {
		return { type: binding.kind === "parameter" ? "parameter" : "variable", modifiers: 0 };
	}
	var found = macros.findDefinition(name, inBody ? body.text : "", inBody ? site.start : undefined);
	if(found) {
		return { type: TYPE_OF_KIND[found.kind], modifiers: fromCore(found.kind === "javascript" ? modules.moduleOfMacro(name) : found.title) ? DEFAULT_LIBRARY : 0 };
	}
	if(name.charAt(0) === "$") {
		return widgets.isRegistered(name.slice(1)) ? { type: "class", modifiers: fromCore(modules.moduleOfWidget(name.slice(1))) ? DEFAULT_LIBRARY : 0 } : null;
	}
	return filters.CORE_VARIABLES.includes(name) || name.startsWith("tv-") ? { type: "variable", modifiers: DEFAULT_LIBRARY } : null;
}

// The core's own shadow, not replaced by a tiddler.
function fromCore(title) {
	return !!title && $tw.wiki.getShadowSource(title) === "$:/core" && !$tw.wiki.tiddlerExists(title);
}

// Sorted, one line each, without overlaps: line and character relative to the token before.
function encode(found) {
	var data = [],
		line = 0,
		character = 0,
		end = { line: -1, character: 0 };
	found.sort(function(a, b) {
		return (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character);
	}).forEach(function(token) {
		var start = token.range.start;
		if(token.range.end.line !== start.line || (start.line === end.line && start.character < end.character)) {
			return;
		}
		data.push(start.line - line, start.line === line ? start.character - character : start.character, token.range.end.character - start.character, token.type, token.modifiers);
		line = start.line;
		character = start.character;
		end = token.range.end;
	});
	return data;
}

exports.semanticTokens = semanticTokens;
exports.LEGEND = LEGEND;
