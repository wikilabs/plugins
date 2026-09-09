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

// --- The tiddler a document is, and the context it gives a filter ---

// Taken from the document's own field header, so a title being renamed in an
// unsaved buffer is honoured, and only then from the file map.
function titleOfDocument(uri, text) {
	var lines = text.split(/\r?\n/),
		firstLine = isTidUri(uri) ? bodyStartLine(lines) : 0;
	for(var i = 0; i < firstLine; i++) {
		var match = /^title:\s*(.+)$/.exec(lines[i]);
		if(match) {
			return match[1].trim();
		}
	}
	return titleOfUri(uri);
}

function titleOfUri(uri) {
	var files = $tw.boot.files || {};
	for(var title in files) {
		if(files[title].filepath && pathToUri(files[title].filepath) === uri) {
			return title;
		}
	}
	return null;
}

// A widget to evaluate a filter against, so [all[current]] means whatever it
// means AT THIS POSITION: the document's own tiddler, or the value an enclosing
// <$let> or <$set> gives it. Built from tw-mcp-core's render context, which
// also imports the wiki's global macros, so a filter calling one resolves.
//
// Only widgets whose parse tree node came from THIS document may be measured
// against a document offset. A macro expansion's nodes carry ranges into the
// macro's own text, so an unrelated node routinely appears to cover the cursor;
// comparing them is meaningless, and doing so picked a widget from inside a
// list iteration instead of the call site.
//
// A variable is visible to a widget's children, never to the widget that set
// it, so what is handed out is always a child.
function renderContext(title, bodyText, offset) {
	if(!title) {
		return null;
	}
	var shared = require("$:/core/modules/commands/inspect/handlers/shared.js"),
		rendered = shared.parseAndRender(bodyText || "", WIKITEXT_TYPE, title);
	if(!rendered || !rendered.widgetNode) {
		return null;
	}
	var own = ownNodes(rendered.parser && rendered.parser.tree),
		innermost = innermostWidget(rendered.widgetNode, own, offset);
	if(innermost) {
		return innermost.makeChildWidget({ type: "widget", children: [] });
	}
	// Nothing in the document encloses the cursor, so the context is the
	// document itself: walk to the foot of the wrapper chain that holds
	// currentTiddler and the imported globals.
	var node = rendered.widgetNode;
	while(node.children && node.children.length) {
		node = node.children[0];
	}
	return node.makeChildWidget({ type: "widget", children: [] });
}

// Identities, not ranges: two nodes from different texts can share a range.
function ownNodes(tree) {
	var seen = [];
	(function collect(nodes) {
		for(var i = 0; i < (nodes || []).length; i++) {
			seen.push(nodes[i]);
			collect(nodes[i].children);
		}
	})(tree);
	return seen;
}

function innermostWidget(root, own, offset) {
	var best = null;
	if(offset === undefined) {
		return null;
	}
	(function walk(widget) {
		var node = widget.parseTreeNode;
		if(node && node.start !== undefined && offset >= node.start && offset <= node.end && own.includes(node)) {
			if(!best || (node.end - node.start) < (best.parseTreeNode.end - best.parseTreeNode.start)) {
				best = widget;
			}
		}
		for(var i = 0; i < (widget.children || []).length; i++) {
			walk(widget.children[i]);
		}
	})(root);
	return best;
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
// there whenever this process is serving HTTP itself.
//
// $tw.httpServer is deliberately a NARROW test, and it is narrower than "HTTP
// is reachable": only the plugin's own `--mcp listen` sets it, so core's
// `--listen` and a secondary process serving through a primary both leave it
// undefined while the wiki is genuinely reachable. Those cases lose the link,
// which is the safe direction: the discovery file records that HTTP is up but
// not on which port, and a link to a guessed port would be worse than none.
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
exports.titleOfDocument = titleOfDocument;
exports.renderContext = renderContext;
