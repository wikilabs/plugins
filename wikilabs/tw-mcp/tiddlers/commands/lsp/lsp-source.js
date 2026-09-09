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

// --- Tiddlers on disk ---

// LSP speaks URIs, and a Windows path is not one: the separators are wrong and
// a space in a title's filename must be escaped.
function pathToUri(filepath) {
	var slashed = filepath.replace(/\\/g, "/");
	if(slashed.charAt(0) !== "/") {
		slashed = "/" + slashed;
	}
	return "file://" + encodeURI(slashed).replace(/[?#]/g, function(ch) {
		return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
	});
}

// Where a title lives on disk, or null when it has no file of its own. A shadow
// tiddler is the ordinary case of that: it is supplied by a plugin, and neither
// $tw.boot.files nor the plugin tiddler records the folder it came from.
function fileOfTitle(title) {
	var entry = ($tw.boot.files || {})[title];
	return entry && entry.filepath ? entry.filepath : null;
}

// The file URI for a title, or null when it has no file to open.
function uriOfTitle(title) {
	var filepath = fileOfTitle(title);
	return filepath ? pathToUri(filepath) : null;
}

// Somewhere the reader can open this title: its own file, or failing that the
// wiki in the browser. A shadow has no file, and a core macro is exactly the
// definition a reader most wants to look at, so the browser is the answer
// there whenever this process is also serving HTTP.
function browsableUri(title) {
	var fileUri = uriOfTitle(title);
	if(fileUri) {
		return fileUri;
	}
	var address = $tw.httpServer && $tw.httpServer.nodeServer && $tw.httpServer.nodeServer.address();
	if(!address || !address.port) {
		return null;
	}
	return "http://127.0.0.1:" + address.port + "/#" + encodeURIComponent(title);
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
exports.pathToUri = pathToUri;
exports.fileOfTitle = fileOfTitle;
exports.uriOfTitle = uriOfTitle;
exports.browsableUri = browsableUri;
