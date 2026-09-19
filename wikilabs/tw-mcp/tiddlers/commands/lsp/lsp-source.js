/*\
title: $:/core/modules/commands/inspect/lsp/lsp-source.js
type: application/javascript
module-type: library

Source text plumbing shared by every LSP feature: where a .tid body begins,
converting between character offsets and the line/column the protocol speaks
in, and walking a parse tree.

\*/

"use strict";

var calls = require("$:/core/modules/commands/inspect/calls.js");

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

// A git: URI carries the version in a query after the path.
function isTidUri(uri) {
	return /\.tid(?:\?.*)?$/.test(uri);
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

// The trees of the last few texts: every request on an unchanged buffer needs
// the same one, and parsing each definition body is the cost.
var recentTrees = [],
	RECENT_MAX = 8;

// The parse tree with each \procedure, \define and \widget body parsed in place
// and moved into document offsets, so what is written inside a body can be
// hovered. A \function body is a filter, which its caller locates itself. The
// tree is shared between callers: read it, never change it.
function parseWithBodies(bodyText) {
	for(var i = 0; i < recentTrees.length; i++) {
		if(recentTrees[i].text === bodyText) {
			return recentTrees[i].tree;
		}
	}
	var tree = parseBody(bodyText);
	eachNode(tree, function(node) {
		var body = calls.definitionBody(node, bodyText);
		if(body && body.kind !== "function") {
			var inner = parseBody(body.text);
			shift(inner, body.start);
			node.children = inner.concat(node.children || []);
		}
	});
	recentTrees.unshift({ text: bodyText, tree: tree });
	recentTrees.length = Math.min(recentTrees.length, RECENT_MAX);
	return tree;
}

// Where the parser says an element's tags sit, next to its start and end.
var TAG_EDGES = ["openTagStart", "openTagEnd", "closeTagStart", "closeTagEnd"];

// Moves every range in a parsed tree by delta. An attribute is reachable both
// through attributes and orderedAttributes, so each object is moved once.
function shift(nodes, delta) {
	var moved = [];
	function move(item) {
		if(item.start !== undefined && !moved.includes(item)) {
			moved.push(item);
			item.start += delta;
			item.end += delta;
			TAG_EDGES.forEach(function(edge) {
				if(item[edge] !== undefined) item[edge] += delta;
			});
		}
	}
	(function walk(list) {
		for(var i = 0; i < (list || []).length; i++) {
			var node = list[i],
				named = node.attributes || {},
				attributes = (node.orderedAttributes || []).concat(Object.keys(named).map(function(key) { return named[key]; }));
			move(node);
			attributes.forEach(function(attribute) {
				move(attribute);
				if(attribute.type === "macro" && attribute.value) {
					walk([attribute.value]);
				}
			});
			walk(node.children);
		}
	})(nodes);
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
	if(isVirtualUri(uri)) {
		return titleOfVirtualUri(uri);
	}
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
function renderAt(title, bodyText, offset) {
	if(!title) {
		return { context: null, widget: null };
	}
	var shared = require("$:/core/modules/commands/inspect/handlers/shared.js"),
		rendered = shared.parseAndRender(bodyText || "", WIKITEXT_TYPE, title);
	if(!rendered || !rendered.widgetNode) {
		return { context: null, widget: null };
	}
	var own = ownNodes(rendered.parser && rendered.parser.tree),
		innermost = innermostWidget(rendered.widgetNode, own, offset);
	if(innermost) {
		return {
			context: innermost.makeChildWidget({ type: "widget", children: [] }),
			widget: innermost
		};
	}
	// Nothing in the document encloses the cursor, so the context is the
	// document itself: walk to the foot of the wrapper chain that holds
	// currentTiddler and the imported globals.
	var node = rendered.widgetNode;
	while(node.children && node.children.length) {
		node = node.children[0];
	}
	return { context: node.makeChildWidget({ type: "widget", children: [] }), widget: null };
}

function renderContext(title, bodyText, offset) {
	return renderAt(title, bodyText, offset).context;
}

// What a widget actually produced. A widget that creates no element of its own
// has empty domNodes and its children hold the output, so the whole subtree is
// gathered. This is the render the document already did, not a second one.
function renderedTextOf(widget) {
	if(!widget) {
		return null;
	}
	var parts = [];
	(function gather(node) {
		var doms = node.domNodes || [];
		if(doms.length) {
			// A DOM node's text already contains its descendants', so taking a
			// child's nodes as well would count every item twice.
			for(var i = 0; i < doms.length; i++) {
				parts.push(doms[i].formattedTextContent !== undefined
					? doms[i].formattedTextContent
					: (doms[i].textContent || ""));
			}
			return;
		}
		for(var c = 0; c < (node.children || []).length; c++) {
			gather(node.children[c]);
		}
	})(widget);
	var text = parts.join("").replace(/\n{3,}/g, "\n\n").trim();
	return text || null;
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
		if(node && node.start !== undefined && offset >= node.start && offset < node.end && own.includes(node)) {
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
// A file URI's path, the inverse of pathToUri: /E:/x becomes E:/x.
function uriToPath(uri) {
	var decoded = decodeURIComponent(uri.replace(/^file:\/\//, ""));
	return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

function fileOfTitle(title) {
	var entry = ($tw.boot.files || {})[title];
	return entry && entry.filepath ? entry.filepath : null;
}

// The file URI for a title, or null when it has no file to open.
function uriOfTitle(title) {
	var filepath = fileOfTitle(title);
	return filepath ? pathToUri(filepath) : null;
}

// --- Read-only views of tiddlers without a file of their own ---

// Shadows, and tiddlers packed into .json or .multids files, open under this
// scheme; the extension asks for their text with the tiddlywiki/tiddler request.
var VIRTUAL_SCHEME = "tiddlywiki:";

function isVirtualUri(uri) {
	return uri.startsWith(VIRTUAL_SCHEME);
}

// A version that does not run: neither a file of the wiki nor a view of its running text, such as the HEAD
// side of a git diff or a plugin's shadow that another version replaces.
function isOtherVersionUri(uri) {
	return !uri.startsWith("file:") && (!isVirtualUri(uri) || sourceOfVirtualUri(uri) !== null);
}

// The path is the whole title plus an extension naming the editor's language:
// a wikitext view is always .tid, other types keep an extension they end in. A
// source names the plugin whose shadow the view shows instead of the running text.
function virtualUri(title, source) {
	var tiddler = $tw.wiki.getTiddler(title),
		type = (tiddler && tiddler.fields.type) || WIKITEXT_TYPE,
		info = $tw.config.contentTypeInfo[type],
		extension = type !== WIKITEXT_TYPE && info && info.extension ? info.extension : ".tid",
		suffix = type !== WIKITEXT_TYPE && title.endsWith(extension) ? "" : extension;
	return VIRTUAL_SCHEME + "/" + encodeURIComponent(title) + suffix + (source ? "?source=" + encodeURIComponent(source) : "");
}

function sourceOfVirtualUri(uri) {
	var match = /\?(?:[^#]*&)?source=([^&#]*)/.exec(uri);
	return match ? decodeURIComponent(match[1]) : null;
}

// The editor re-encodes a URI it was given (%2F comes back as /), so the title is
// decoded from the whole path; null when no such tiddler exists.
function titleOfVirtualUri(uri) {
	var path = decodeURIComponent(uri.slice(VIRTUAL_SCHEME.length).replace(/\?.*$/, "")).replace(/^\/+/, ""),
		stripped = path.replace(/\.tid$/, ""),
		strippedTiddler = stripped !== path ? $tw.wiki.getTiddler(stripped) : null;
	if(strippedTiddler && (strippedTiddler.fields.type || WIKITEXT_TYPE) === WIKITEXT_TYPE) {
		return stripped;
	}
	return $tw.wiki.getTiddler(path) ? path : null;
}

// A wikitext view reads as a .tid file, fields as get_tiddler format=tid gives
// them, so every .tid rule applies; any other type is its text alone.
function virtualText(title) {
	return viewText($tw.wiki.getTiddler(title));
}

function viewText(tiddler) {
	var crud = require("$:/core/modules/commands/inspect/handlers/crud/_shared.js");
	if(!tiddler) {
		return null;
	}
	var text = tiddler.fields.text || "";
	if((tiddler.fields.type || WIKITEXT_TYPE) !== WIKITEXT_TYPE || crud.hasUnsafeFields(tiddler)) {
		return text;
	}
	return crud.formatFieldsBlock(tiddler, { exclude: ["text"] }) + "\n\n" + text;
}

// The shadow of title that plugin ships, as its view reads; null when the plugin ships no such title.
function shadowVersionText(title, plugin) {
	var info = $tw.wiki.getPluginInfo(plugin),
		fields = info && info.tiddlers && $tw.utils.hop(info.tiddlers, title) ? info.tiddlers[title] : null;
	return fields ? viewText(new $tw.Tiddler(fields, { title: title })) : null;
}

function virtualDocument(uri) {
	var title = isVirtualUri(uri) ? titleOfVirtualUri(uri) : null,
		plugin = title === null ? null : sourceOfVirtualUri(uri);
	if(title === null) {
		return null;
	}
	return plugin === null ? virtualText(title) : shadowVersionText(title, plugin);
}

// Where the editor can open title: its own file when that file holds exactly
// the tiddler, else the read-only view; null for no such tiddler.
function documentUriOf(title) {
	if(hasFile(title)) {
		return pathToUri($tw.boot.files[title].filepath);
	}
	return $tw.wiki.getTiddler(title) ? virtualUri(title) : null;
}

// Whether the editor opens title as a file of its own: a .tid, or a file with a .meta sidecar.
function hasFile(title) {
	var entry = ($tw.boot.files || {})[title];
	return !!(entry && entry.filepath && (isTidUri(entry.filepath) || entry.hasMetaFile));
}

// Somewhere the reader can open this title: its own file, or else the wiki in
// the browser, served by this process or by the dev server in .tw-mcp/connect.
// Core's --listen records no port, so it gets no link rather than a guess.
function browsableUri(title) {
	var fileUri = uriOfTitle(title);
	if(fileUri) {
		return fileUri;
	}
	var port = httpPort();
	return port ? "http://127.0.0.1:" + port + "/#" + encodeURIComponent(title) : null;
}

function httpPort() {
	var address = $tw.httpServer && $tw.httpServer.nodeServer && $tw.httpServer.nodeServer.address();
	if(address && address.port) {
		return address.port;
	}
	var primary = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js").readDiscoveryFile();
	return primary && primary.listen && primary.port ? primary.port : null;
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
exports.parseWithBodies = parseWithBodies;
exports.pathToUri = pathToUri;
exports.uriToPath = uriToPath;
exports.fileOfTitle = fileOfTitle;
exports.uriOfTitle = uriOfTitle;
exports.browsableUri = browsableUri;
exports.isVirtualUri = isVirtualUri;
exports.isOtherVersionUri = isOtherVersionUri;
exports.virtualUri = virtualUri;
exports.titleOfVirtualUri = titleOfVirtualUri;
exports.virtualText = virtualText;
exports.virtualDocument = virtualDocument;
exports.documentUriOf = documentUriOf;
exports.hasFile = hasFile;
exports.titleOfDocument = titleOfDocument;
exports.renderContext = renderContext;
exports.renderAt = renderAt;
exports.renderedTextOf = renderedTextOf;
