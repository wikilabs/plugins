/*\
title: $:/core/modules/commands/inspect/lsp/lsp-source.js
type: application/javascript
module-type: library

Source text plumbing shared by every LSP feature: where a .tid body begins,
converting between character offsets and the line/column the protocol speaks
in, and walking a parse tree.

\*/

"use strict";

var WIKITEXT_TYPE = "text/vnd.tiddlywiki";

// Index of the first body line. A .tid file's fields run until the first blank
// line; a file that is nothing but fields has no body at all.
function bodyStartLine(lines) {
	for(var i = 0; i < lines.length; i++) {
		if(lines[i].trim() === "") {
			return i + 1;
		}
		if(!/^[a-zA-Z0-9\-_.]+:/.test(lines[i])) {
			// Not a field line, so this file was never a .tid header.
			return 0;
		}
	}
	return lines.length;
}

function isTidUri(uri) {
	return uri.endsWith(".tid");
}

// Character offset of the start of each line, so a parse tree's offsets can be
// turned back into the line and column the protocol speaks in.
function lineStarts(text) {
	var starts = [0];
	for(var i = 0; i < text.length; i++) {
		if(text.charAt(i) === "\n") {
			starts.push(i + 1);
		}
	}
	return starts;
}

function offsetAt(starts, position) {
	var line = Math.min(position.line, starts.length - 1);
	return starts[line] + position.character;
}

function positionAt(starts, offset) {
	var lo = 0,
		hi = starts.length - 1;
	while(lo < hi) {
		var mid = Math.ceil((lo + hi) / 2);
		if(starts[mid] <= offset) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return { line: lo, character: offset - starts[lo] };
}

// Everything a feature needs to work in body coordinates and report in document
// ones, computed once per call.
function bodyOf(uri, text) {
	var lines = text.split(/\r?\n/),
		starts = lineStarts(text),
		firstLine = isTidUri(uri) ? bodyStartLine(lines) : 0,
		offset = firstLine < starts.length ? starts[firstLine] : text.length;
	return {
		lines: lines,
		starts: starts,
		firstLine: firstLine,
		offset: offset,
		text: text.slice(offset)
	};
}

function eachNode(nodes, callback) {
	for(var i = 0; i < (nodes || []).length; i++) {
		callback(nodes[i]);
		eachNode(nodes[i].children, callback);
	}
}

function parseBody(bodyText) {
	return $tw.wiki.parseText(WIKITEXT_TYPE, bodyText).tree;
}

exports.WIKITEXT_TYPE = WIKITEXT_TYPE;
exports.bodyStartLine = bodyStartLine;
exports.isTidUri = isTidUri;
exports.lineStarts = lineStarts;
exports.offsetAt = offsetAt;
exports.positionAt = positionAt;
exports.bodyOf = bodyOf;
exports.eachNode = eachNode;
exports.parseBody = parseBody;
