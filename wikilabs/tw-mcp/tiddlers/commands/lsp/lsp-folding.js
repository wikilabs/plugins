/*\
title: $:/core/modules/commands/inspect/lsp/lsp-folding.js
type: application/javascript
module-type: library

Folding ranges: the .tid header, multi-line definitions, each clause of an
<%if%> block, multi-line widgets, elements, comments and code fences.

Once a server offers folding, VS Code stops folding by indentation, so anything
indentation used to fold has to fold here too.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

function foldingRanges(uri, text) {
	var body = source.bodyOf(uri, text);
	if(!files.isWikitext(uri, body)) {
		return [];
	}
	var ranges = [];
	function lineOf(offset) {
		return source.positionAt(body.starts, body.offset + offset).line;
	}
	function add(startLine, endLine, kind) {
		if(endLine > startLine) {
			ranges.push(kind ? { startLine: startLine, endLine: endLine, kind: kind } : { startLine: startLine, endLine: endLine });
		}
	}
	// The header's fields, without the blank line that ends them.
	add(0, body.firstLine - 2, "region");
	// A closing \end or tag stays visible, as a closing brace does.
	calls.sitesIn(body.text).definitions.forEach(function(definition) {
		add(lineOf(definition.range.start), lineOf(definition.range.end) - 1);
	});
	source.eachNode(source.parseWithBodies(body.text), function(node) {
		if(node.start === undefined) {
			return;
		}
		var clauses = calls.conditionalClauses(node, body.text);
		if(clauses) {
			// Each clause on its own, up to the next clause or <%endif%>.
			clauses.forEach(function(clause, index) {
				add(lineOf(clause.at), lineOf(index + 1 < clauses.length ? clauses[index + 1].at : node.end) - 1);
			});
		} else if(body.text.substr(node.start, 4) === "<!--") {
			add(lineOf(node.start), lineOf(node.end), "comment");
		} else if(node.type === "codeblock") {
			add(lineOf(node.start), lineOf(node.end) - 1);
		} else if(writtenTag(node, body.text)) {
			add(lineOf(node.start), lineOf(node.end) - 1);
			// An opening tag written over several lines folds its content on its own too.
			add(lineOf(openingEnd(node, body.text)), lineOf(node.end) - 1);
		}
	});
	return widestPerLine(ranges);
}

// A widget or element written as a tag; a paragraph the parser wraps around
// lines is not one, and would fold everything up to the next blank line.
function writtenTag(node, text) {
	return !!node.tag && text.substr(node.start, node.tag.length + 1) === "<" + node.tag;
}

// The > closing an opening tag: the first one after its last attribute.
function openingEnd(node, text) {
	var from = node.start;
	(node.orderedAttributes || []).forEach(function(attribute) {
		if(attribute.end !== undefined && attribute.end > from) {
			from = attribute.end;
		}
	});
	var at = text.indexOf(">", from);
	return at < 0 ? node.start : at;
}

// One fold per start line, the widest: it hides what a reader clicking there expects.
function widestPerLine(ranges) {
	var seen = Object.create(null);
	return ranges.sort(function(a, b) {
		return (a.startLine - b.startLine) || (b.endLine - a.endLine);
	}).filter(function(range) {
		if(seen[range.startLine]) {
			return false;
		}
		seen[range.startLine] = true;
		return true;
	});
}

exports.foldingRanges = foldingRanges;
