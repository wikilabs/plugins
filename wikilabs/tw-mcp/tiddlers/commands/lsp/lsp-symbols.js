/*\
title: $:/core/modules/commands/inspect/lsp/lsp-symbols.js
type: application/javascript
module-type: library

Document symbols: a tiddler's outline. Every \procedure, \function, \define and
\widget comes first, with the definitions written inside its body as children,
then the wikitext headings, nested by level.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// LSP SymbolKind: Function for procedures and macros, Operator for a \function
// (a dotted one is used as a filter operator), Class for a \widget.
var KIND = { procedure: 12, macro: 12, "function": 25, widget: 5 };

// String, as markdown outlines show headings.
var KIND_HEADING = 15;

// The outline as nested DocumentSymbols, or as a flat SymbolInformation list for
// a client that cannot nest them.
function documentSymbols(uri, text, options) {
	var body = source.bodyOf(uri, text);
	if(!files.isWikitext(uri, body)) {
		return [];
	}
	var symbols = definitionSymbols(body).concat(headingSymbols(body));
	return options && options.hierarchical === false ? flatten(uri, symbols, null) : symbols;
}

function definitionSymbols(body) {
	var definitions = calls.sitesIn(body.text).definitions,
		symbols = definitions.map(function(definition) {
			return {
				name: definition.name,
				detail: (definition.kind === "macro" ? "macro " : "") + signature(definition.params),
				kind: KIND[definition.kind],
				range: rangeIn(body, definition.range.start, definition.range.end),
				selectionRange: rangeIn(body, definition.start, definition.end),
				children: []
			};
		}),
		top = [];
	definitions.forEach(function(definition, index) {
		(definition.parent === null ? top : symbols[definition.parent].children).push(symbols[index]);
	});
	return top;
}

function signature(params) {
	return "(" + params.map(function(param) {
		return param.name + (param["default"] === undefined ? "" : ":\"" + param["default"] + "\"");
	}).join(", ") + ")";
}

// A heading spans to the next heading as high or higher, so the breadcrumbs
// follow the cursor through its section. Headings inside a definition body
// belong to what it renders, not to this tiddler, so bodies are not parsed.
function headingSymbols(body) {
	var headings = [];
	source.eachNode(source.parseBody(body.text), function(node) {
		var level = node.type === "element" && /^h([1-6])$/.exec(node.tag || "");
		if(level && node.start !== undefined) {
			headings.push({ level: Number(level[1]), start: node.start, end: node.end, name: body.text.slice(node.start, node.end).replace(/^!+\s*/, "").trim() });
		}
	});
	var roots = [],
		stack = [];
	headings.forEach(function(heading, index) {
		var next = headings.slice(index + 1).find(function(later) { return later.level <= heading.level; }),
			symbol = {
				name: heading.name || "(heading)",
				kind: KIND_HEADING,
				range: rangeIn(body, heading.start, next ? next.start : body.text.length),
				selectionRange: rangeIn(body, heading.start, heading.end),
				children: []
			};
		while(stack.length && stack[stack.length - 1].level >= heading.level) {
			stack.pop();
		}
		(stack.length ? stack[stack.length - 1].symbol.children : roots).push(symbol);
		stack.push({ level: heading.level, symbol: symbol });
	});
	return roots;
}

function rangeIn(body, start, end) {
	return { start: source.positionAt(body.starts, body.offset + start), end: source.positionAt(body.starts, body.offset + end) };
}

// The flat list names each symbol's parent as its container.
function flatten(uri, symbols, container) {
	var flat = [];
	symbols.forEach(function(symbol) {
		flat.push({ name: symbol.name, kind: symbol.kind, location: { uri: uri, range: symbol.range }, containerName: container || undefined });
		flat = flat.concat(flatten(uri, symbol.children, symbol.name));
	});
	return flat;
}

exports.documentSymbols = documentSymbols;
