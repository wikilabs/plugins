/*\
title: $:/core/modules/commands/inspect/lsp/lsp-source.js
type: application/javascript
module-type: library

Source text plumbing shared by every LSP feature: where a .tid body begins,
converting between character offsets and the line/column the protocol speaks
in, and walking a parse tree.

\*/

"use strict";

var calls = require("$:/core/modules/commands/inspect/calls.js"),
	shadows = require("$:/core/modules/commands/inspect/lsp/lsp-shadows.js");

var WIKITEXT_TYPE = "text/vnd.tiddlywiki";

/**
 * Index of the first body line; a .tid file's fields run to the first blank line, and a file of fields only has no body.
 * @param {string[]} lines - document lines
 * @returns {number} Line index
 */
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

/**
 * Tells whether a URI names a .tid file, a git: URI carrying its version in a query.
 * @param {string} uri - document URI
 * @returns {boolean} True for a .tid
 */
function isTidUri(uri) {
	return /\.tid(?:\?.*)?$/.test(uri);
}

/**
 * The offset of each line's start, to turn parse tree offsets back into protocol positions.
 * @param {string} text - document text
 * @returns {number[]} Offsets
 */
function lineStarts(text) {
	var starts = [0];
	for(var i = 0; i < text.length; i++) {
		if(text.charAt(i) === "\n") {
			starts.push(i + 1);
		}
	}
	return starts;
}

/**
 * The offset of a protocol position.
 * @param {number[]} starts - from lineStarts
 * @param {{line: number, character: number}} position - protocol position
 * @returns {number} Offset
 */
function offsetAt(starts, position) {
	var line = Math.min(position.line, starts.length - 1);
	return starts[line] + position.character;
}

/**
 * The protocol position of an offset.
 * @param {number[]} starts - from lineStarts
 * @param {number} offset - text offset
 * @returns {{line: number, character: number}} Position
 */
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

/**
 * Everything a feature needs to work in body coordinates and report in document ones, computed once per call.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @returns {object} Body: text, offset, starts, lines, firstLine
 */
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

/**
 * Calls a callback for every node of a parse tree, depth first.
 * @param {object[]} nodes - parse tree nodes
 * @param {function(object): void} callback - receives each node
 * @returns {void}
 */
function eachNode(nodes, callback) {
	for(var i = 0; i < (nodes || []).length; i++) {
		callback(nodes[i]);
		eachNode(nodes[i].children, callback);
	}
}

/**
 * Parses a body as wikitext.
 * @param {string} bodyText - body text
 * @returns {object[]} Parse tree
 */
function parseBody(bodyText) {
	return $tw.wiki.parseText(WIKITEXT_TYPE, bodyText).tree;
}

// The trees of the last few texts: every request on an unchanged buffer needs
// the same one, and parsing each definition body is the cost.
var recentTrees = [],
	RECENT_MAX = 8;

/**
 * The parse tree with each \procedure, \define and \widget body parsed in place in document offsets; shared, so read it, never change it.
 * @param {string} bodyText - body text
 * @returns {object[]} Parse tree
 */
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

/**
 * Moves every range in a parsed tree by delta, each attribute once although two lists reach it.
 * @param {object[]} nodes - parse tree nodes
 * @param {number} delta - offset change
 * @returns {void}
 */
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

/**
 * The document's title from its own field header, so an unsaved rename counts, else from the file map.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @returns {(string|null)} Title
 */
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

/**
 * The title of the tiddler a file URI holds, from the wiki's file map.
 * @param {string} uri - document URI
 * @returns {(string|null)} Title
 */
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
	var shadow = shadows.liveShadowFiles().find(function(entry) {
		return pathToUri(entry.filepath) === uri;
	});
	return shadow ? shadow.title : null;
}

/**
 * The widget a filter at this position runs against, from nodes of this document only; a child, since a widget never sees its own variables.
 * @param {string} title - document's tiddler
 * @param {string} bodyText - body text
 * @param {number} offset - body offset
 * @returns {{context: (object|null), widget: (object|null)}} Context widget and rendered widget
 */
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

/**
 * The context widget at a position.
 * @param {string} title - document's tiddler
 * @param {string} bodyText - body text
 * @param {number} offset - body offset
 * @returns {(object|null)} Widget
 */
function renderContext(title, bodyText, offset) {
	return renderAt(title, bodyText, offset).context;
}

/**
 * The text a widget's subtree produced in the render the document already did.
 * @param {object} widget - rendered widget
 * @returns {string} Text
 */
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

/**
 * The nodes of a tree by identity, since two nodes from different texts can share a range.
 * @param {object[]} tree - parse tree
 * @returns {Set<object>} Nodes
 */
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

/**
 * The innermost rendered widget from this document's own nodes covering an offset.
 * @param {object} root - root widget
 * @param {Set<object>} own - from ownNodes
 * @param {number} offset - body offset
 * @returns {(object|null)} Widget
 */
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

/**
 * A file URI for a path, with the separators and escapes a Windows path lacks.
 * @param {string} filepath - file path
 * @returns {string} URI
 */
function pathToUri(filepath) {
	var slashed = filepath.replace(/\\/g, "/");
	if(slashed.charAt(0) !== "/") {
		slashed = "/" + slashed;
	}
	return "file://" + encodeURI(slashed).replace(/[?#]/g, function(ch) {
		return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
	});
}

/**
 * A file URI's path, the inverse of pathToUri: /E:/x becomes E:/x.
 * @param {string} uri - file URI
 * @returns {string} Path
 */
function uriToPath(uri) {
	var decoded = decodeURIComponent(uri.replace(/^file:\/\//, ""));
	return /^\/[a-zA-Z]:/.test(decoded) ? decoded.slice(1) : decoded;
}

/**
 * Where a title lives on disk: its own file, else for a shadow its plugin's source file.
 * @param {string} title - tiddler title
 * @returns {(string|null)} Path
 */
function fileOfTitle(title) {
	var entry = fileEntry(title);
	return entry && entry.filepath ? entry.filepath : null;
}

/**
 * The file record of a title: boot's, else the shadow's source file.
 * @param {string} title - tiddler title
 * @returns {(object|null)} Entry with filepath and hasMetaFile
 */
function fileEntry(title) {
	return ($tw.boot.files || {})[title] || shadows.fileOfShadow(title);
}

/**
 * Every running shadow with a source file of its own.
 * @returns {object[]} { title, filepath, hasMetaFile, plugin }
 */
function shadowFiles() {
	return shadows.liveShadowFiles();
}

/**
 * The file URI for a title, or null when it has no file to open.
 * @param {string} title - tiddler title
 * @returns {(string|null)} URI
 */
function uriOfTitle(title) {
	var filepath = fileOfTitle(title);
	return filepath ? pathToUri(filepath) : null;
}

// --- Read-only views of tiddlers without a file of their own ---

// Shadows, and tiddlers packed into .json or .multids files, open under this
// scheme; the extension asks for their text with the tiddlywiki/tiddler request.
var VIRTUAL_SCHEME = "tiddlywiki:";

/**
 * Tells whether a URI is one of the server's read-only tiddler views.
 * @param {string} uri - document URI
 * @returns {boolean} True for a view
 */
function isVirtualUri(uri) {
	return uri.startsWith(VIRTUAL_SCHEME);
}

/**
 * Tells whether a URI is a version that does not run, such as a git diff side or a replaced plugin shadow.
 * @param {string} uri - document URI
 * @returns {boolean} True if not running
 */
function isOtherVersionUri(uri) {
	return !uri.startsWith("file:") && (!isVirtualUri(uri) || sourceOfVirtualUri(uri) !== null);
}

/**
 * The view URI of a title: the title plus an extension naming the editor's language, and the plugin when it shows a shadow.
 * @param {string} title - tiddler title
 * @param {string} [source] - plugin whose shadow it shows
 * @returns {string} URI
 */
function virtualUri(title, source) {
	var tiddler = $tw.wiki.getTiddler(title),
		type = (tiddler && tiddler.fields.type) || WIKITEXT_TYPE,
		info = $tw.config.contentTypeInfo[type],
		extension = type !== WIKITEXT_TYPE && info && info.extension ? info.extension : ".tid",
		suffix = type !== WIKITEXT_TYPE && title.endsWith(extension) ? "" : extension;
	return VIRTUAL_SCHEME + "/" + encodeURIComponent(title) + suffix + (source ? "?source=" + encodeURIComponent(source) : "");
}

/**
 * The plugin a view URI shows a shadow of, or null for the running text.
 * @param {string} uri - view URI
 * @returns {(string|null)} Plugin title
 */
function sourceOfVirtualUri(uri) {
	var match = /\?(?:[^#]*&)?source=([^&#]*)/.exec(uri);
	return match ? decodeURIComponent(match[1]) : null;
}

/**
 * The title a view URI shows, decoded from the whole path since the editor re-encodes it.
 * @param {string} uri - view URI
 * @returns {(string|null)} Title, null when no such tiddler exists
 */
function titleOfVirtualUri(uri) {
	var path = decodeURIComponent(uri.slice(VIRTUAL_SCHEME.length).replace(/\?.*$/, "")).replace(/^\/+/, ""),
		stripped = path.replace(/\.tid$/, ""),
		strippedTiddler = stripped !== path ? $tw.wiki.getTiddler(stripped) : null;
	if(strippedTiddler && (strippedTiddler.fields.type || WIKITEXT_TYPE) === WIKITEXT_TYPE) {
		return stripped;
	}
	return $tw.wiki.getTiddler(path) ? path : null;
}

/**
 * The text of a title's view: a wikitext view reads as a .tid file, any other type is its text alone.
 * @param {string} title - tiddler title
 * @returns {(string|null)} Text
 */
function virtualText(title) {
	return viewText($tw.wiki.getTiddler(title));
}

/**
 * The view text of a tiddler.
 * @param {object} tiddler - tiddler
 * @returns {(string|null)} Text
 */
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

/**
 * The shadow of a title that a plugin ships, as its view reads.
 * @param {string} title - tiddler title
 * @param {string} plugin - plugin title
 * @returns {(string|null)} Text, null when the plugin ships no such title
 */
function shadowVersionText(title, plugin) {
	var info = $tw.wiki.getPluginInfo(plugin),
		fields = info && info.tiddlers && $tw.utils.hop(info.tiddlers, title) ? info.tiddlers[title] : null;
	return fields ? viewText(new $tw.Tiddler(fields, { title: title })) : null;
}

/**
 * The text of a view URI.
 * @param {string} uri - view URI
 * @returns {(string|null)} Text
 */
function virtualDocument(uri) {
	var title = isVirtualUri(uri) ? titleOfVirtualUri(uri) : null,
		plugin = title === null ? null : sourceOfVirtualUri(uri);
	if(title === null) {
		return null;
	}
	return plugin === null ? virtualText(title) : shadowVersionText(title, plugin);
}

/**
 * Where the editor can open a title: its own file when that file holds exactly the tiddler, else the read-only view.
 * @param {string} title - tiddler title
 * @returns {(string|null)} URI, null for no such tiddler
 */
function documentUriOf(title) {
	if(hasFile(title)) {
		return pathToUri(fileOfTitle(title));
	}
	return $tw.wiki.getTiddler(title) ? virtualUri(title) : null;
}

/**
 * Tells whether the editor opens a title as a file of its own: a .tid, or a file with a .meta sidecar.
 * @param {string} title - tiddler title
 * @returns {boolean} True if it has a file
 */
function hasFile(title) {
	var entry = fileEntry(title);
	return !!(entry && entry.filepath && (isTidUri(entry.filepath) || entry.hasMetaFile));
}

/**
 * Somewhere the reader can open a title: its own file, else the wiki in the browser; core's --listen records no port, so it gets no link.
 * @param {string} title - tiddler title
 * @returns {(string|null)} URI
 */
function browsableUri(title) {
	var fileUri = uriOfTitle(title);
	if(fileUri) {
		return fileUri;
	}
	var base = browserBase();
	return base ? base + "/#" + encodeURIComponent(title) : null;
}

/**
 * Where a browser reaches the wiki: this process's HTTP server, else the dev server in .tw-mcp/connect.
 * @returns {(string|null)} Base URL, eg: http://127.0.0.1:8080
 */
function browserBase() {
	var mcpLib = require("$:/core/modules/commands/inspect/mcp/mcp-lib.js"),
		address = $tw.httpServer && $tw.httpServer.nodeServer && $tw.httpServer.nodeServer.address();
	if(address && address.port) {
		return "http://" + mcpLib.browserHost() + ":" + address.port;
	}
	var primary = mcpLib.readDiscoveryFile();
	// A primary from before tw-mcp 0.23.1 records no host; it served 127.0.0.1 unless told otherwise.
	return primary && primary.listen && primary.port ? "http://" + (primary.host || "127.0.0.1") + ":" + primary.port : null;
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
exports.shadowFiles = shadowFiles;
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
