/*\
title: $:/core/modules/commands/inspect/lsp/lsp-files.js
type: application/javascript
module-type: library

The call and definition sites of every document the editor can open: its open
buffers, the wiki's .tid files read from disk, and the read-only views of
tiddlers without a file of their own. Find references and go to definition
both read them from here.

Files are read from DISK, because the running wiki does not watch its folder,
so a file saved from the editor can differ from the wiki's copy; and an open
buffer beats both, because it is what the reader is looking at.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null;

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// Sites per file path, kept while the file's mtime and size are unchanged.
var fileCache = Object.create(null);

// Sites of a tiddler's read-only view, in the wiki's own per-tiddler cache.
var VIEW_CACHE_KEY = "tw-lsp-view-sites";

// The views a walk visits, in the wiki's global cache.
var VIEWS_CACHE_KEY = "tw-lsp-views";

// URI and comparison key per file path (see fileDocument).
var fileDocuments = Object.create(null);

/**
 * Every call and definition in a document with protocol ranges, header field calls included; none for a document holding no wikitext.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @returns {object[]} Sites
 */
function sitesOfDocument(uri, text) {
	var body = source.bodyOf(uri, text);
	if(!isWikitext(uri, body)) {
		return [];
	}
	var found = calls.sitesIn(body.text),
		located = [];
	// base is where the scanned text starts in the document; start stays in body
	// coordinates, the ones scope resolution works in.
	function add(site, definition, base) {
		var entry = {
			name: site.name,
			start: base - body.offset + site.start,
			definition: definition,
			range: rangeOf(body, base + site.start, base + site.end)
		};
		if(definition) {
			// The whole pragma, for a peek that shows the definition entire.
			entry.full = rangeOf(body, base + site.range.start, base + site.range.end);
			entry.topLevel = site.parent === null;
			entry.kind = site.kind;
		}
		located.push(entry);
	}
	found.calls.forEach(function(site) { add(site, false, body.offset); });
	found.definitions.forEach(function(site) { add(site, true, body.offset); });
	headerFields(body).forEach(function(field) {
		calls.sitesIn(field.value).calls.forEach(function(site) { add(site, false, field.start); });
	});
	return located;
}

/**
 * The protocol range between two document offsets.
 * @param {object} body - from source.bodyOf
 * @param {number} start - offset
 * @param {number} end - offset
 * @returns {object} LSP range
 */
function rangeOf(body, start, end) {
	return { start: source.positionAt(body.starts, start), end: source.positionAt(body.starts, end) };
}

/**
 * The value of each .tid header field but the title, and where it starts.
 * @param {object} body - from source.bodyOf
 * @returns {Array<{value: string, start: number}>} Fields
 */
function headerFields(body) {
	var fields = [];
	for(var i = 0; i < body.firstLine - 1; i++) {
		var match = /^([^:\s]+):\s?/.exec(body.lines[i]);
		if(match && match[1] !== "title") {
			fields.push({ value: body.lines[i].slice(match[0].length), start: body.starts[i] + match[0].length });
		}
	}
	return fields;
}

/**
 * Tells whether a document is wikitext: a view by its wiki tiddler's type, a .tid by its own type: line, since the wiki's copy may be stale.
 * @param {string} uri - document URI
 * @param {object} body - from source.bodyOf
 * @returns {boolean} True for wikitext
 */
function isWikitext(uri, body) {
	if(source.isVirtualUri(uri)) {
		var title = source.titleOfVirtualUri(uri),
			tiddler = title === null ? null : $tw.wiki.getTiddler(title);
		return !!tiddler && (tiddler.fields.type || source.WIKITEXT_TYPE) === source.WIKITEXT_TYPE;
	}
	for(var i = 0; i < body.firstLine; i++) {
		var match = /^type:\s*(.*)$/.exec(body.lines[i]);
		if(match) {
			return match[1].trim() === "" || match[1].trim() === source.WIKITEXT_TYPE;
		}
	}
	return true;
}

/**
 * The sites of a file on disk, cached while its mtime and size are unchanged.
 * @param {string} filepath - file path
 * @returns {object[]} Sites
 */
function sitesOfFile(filepath) {
	var stat = fs.statSync(filepath, { throwIfNoEntry: false });
	if(!stat) {
		delete fileCache[filepath];
		return [];
	}
	var cached = fileCache[filepath];
	if(cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
		return cached.sites;
	}
	var sites = sitesOfDocument(source.pathToUri(filepath), fs.readFileSync(filepath, "utf8"));
	fileCache[filepath] = { mtimeMs: stat.mtimeMs, size: stat.size, sites: sites };
	return sites;
}

/**
 * The sites of a tiddler's read-only view.
 * @param {string} title - tiddler title
 * @returns {object[]} Sites
 */
function sitesOfView(title) {
	var viewUri = source.virtualUri(title);
	return $tw.wiki.getCacheForTiddler(title, VIEW_CACHE_KEY, function() {
		return sitesOfDocument(viewUri, source.virtualText(title));
	});
}

/**
 * The site at a position: a name never spans lines, so anywhere on its line from its first character to just after its last.
 * @param {object[]} sites - sites of the document
 * @param {{line: number, character: number}} position - cursor
 * @returns {(object|null)} Site
 */
function siteAt(sites, position) {
	for(var i = 0; i < sites.length; i++) {
		var range = sites[i].range;
		if(range.start.line === position.line && position.character >= range.start.character && position.character <= range.end.character) {
			return sites[i];
		}
	}
	return null;
}

/**
 * A key under which two spellings of one file compare equal (VS Code writes file:///e%3A/...), and a view compares by title.
 * @param {string} uri - document URI
 * @returns {string} Key
 */
function sameFileKey(uri) {
	if(source.isVirtualUri(uri)) {
		return "tiddlywiki:" + source.titleOfVirtualUri(uri);
	}
	return decodeURIComponent(uri).replace(/^file:\/\/\/([a-zA-Z]):/, function(match, drive) {
		return "file:///" + drive.toLowerCase() + ":";
	});
}

/**
 * Wikitext tiddlers the editor can only open as a view: real ones no file holds exactly, and shadows no real tiddler overrides.
 * @returns {string[]} Titles
 */
function wikiOnlyTitles() {
	var titles = [];
	function consider(tiddler, title) {
		if((tiddler.fields.type || source.WIKITEXT_TYPE) === source.WIKITEXT_TYPE && source.isVirtualUri(source.documentUriOf(title) || "")) {
			titles.push(title);
		}
	}
	$tw.wiki.each(consider);
	$tw.wiki.eachShadow(function(tiddler, title) {
		if(!$tw.wiki.tiddlerExists(title)) {
			consider(tiddler, title);
		}
	});
	return titles;
}

/**
 * A cheap test before a tiddler is parsed: the name appears in some field.
 * @param {string} title - tiddler title
 * @param {string} name - name searched for
 * @returns {boolean} True if mentioned
 */
function mentions(title, name) {
	var tiddler = $tw.wiki.getTiddler(title);
	return Object.keys(tiddler.fields).some(function(key) {
		return key !== "title" && tiddler.getFieldString(key).includes(name);
	});
}

/**
 * Visits every document the editor can open once, under the first spelling of its URI: open buffers, the wiki's .tid files, plugin source files, then views.
 * @param {object} openDocuments - open documents by URI
 * @param {function(string, string, function(): object[]): void} visit - receives uri, title and a sites() to call only if needed
 * @returns {void}
 */
function eachDocument(openDocuments, visit) {
	var seen = Object.create(null);
	function offer(docUri, title, sites, key) {
		seen[key || sameFileKey(docUri)] = true;
		visit(docUri, title, sites);
	}
	function offerFile(title, filepath) {
		if(filepath && source.isTidUri(filepath)) {
			var file = fileDocument(filepath);
			if(!seen[file.key]) {
				offer(file.uri, title, sitesOfFile.bind(null, filepath), file.key);
			}
		}
	}
	Object.keys(openDocuments || {}).forEach(function(openUri) {
		offer(openUri, source.titleOfDocument(openUri, openDocuments[openUri]), function() {
			return sitesOfDocument(openUri, openDocuments[openUri]);
		});
	});
	var files = $tw.boot.files || {};
	for(var title in files) {
		offerFile(title, files[title].filepath);
	}
	source.shadowFiles().forEach(function(shadow) {
		offerFile(shadow.title, shadow.filepath);
	});
	// A title filed since the views were listed is a file now.
	wikiOnlyViews().forEach(function(view) {
		if(!seen[view.key] && !source.hasFile(view.title)) {
			offer(view.uri, view.title, sitesOfView.bind(null, view.title), view.key);
		}
	});
}

/**
 * A file's URI and comparison key, which depend on its path alone.
 * @param {string} filepath - file path
 * @returns {{uri: string, key: string}} Document
 */
function fileDocument(filepath) {
	if(!fileDocuments[filepath]) {
		var fileUri = source.pathToUri(filepath);
		fileDocuments[filepath] = { uri: fileUri, key: sameFileKey(fileUri) };
	}
	return fileDocuments[filepath];
}

/**
 * The views of wikitext tiddlers no file holds, kept in the wiki's global cache that every change clears.
 * @returns {Array<{title: string, uri: string, key: string}>} Views
 */
function wikiOnlyViews() {
	return $tw.wiki.getGlobalCache(VIEWS_CACHE_KEY, function() {
		return wikiOnlyTitles().map(function(title) {
			var viewUri = source.virtualUri(title);
			return { title: title, uri: viewUri, key: sameFileKey(viewUri) };
		});
	});
}

/**
 * Every site named name in every document the editor can open.
 * @param {string} name - call or definition name
 * @param {object} openDocuments - open documents by URI
 * @returns {Array<{uri: string, site: object}>} Hits
 */
function sitesNamed(name, openDocuments) {
	var found = [];
	eachDocument(openDocuments, function(docUri, title, sites) {
		// A view is parsed only when its tiddler mentions the name.
		if(source.isVirtualUri(docUri) && !mentions(title, name)) {
			return;
		}
		sites().forEach(function(site) {
			if(site.name === name) {
				found.push({ uri: docUri, site: site });
			}
		});
	});
	return found;
}

exports.sitesOfDocument = sitesOfDocument;
exports.isWikitext = isWikitext;
exports.sitesOfFile = sitesOfFile;
exports.sitesOfView = sitesOfView;
exports.siteAt = siteAt;
exports.sameFileKey = sameFileKey;
exports.sitesNamed = sitesNamed;
exports.eachDocument = eachDocument;
