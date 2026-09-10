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

// Every call and definition in a document, with protocol ranges, calls in its
// .tid header fields included. A document holding no wikitext has none.
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

function rangeOf(body, start, end) {
	return { start: source.positionAt(body.starts, start), end: source.positionAt(body.starts, end) };
}

// The value of each .tid header field but the title, and where it starts.
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

// A view of a wiki tiddler takes its type from the wiki; a .tid file takes it
// from its own type: line, since the wiki's copy may be stale.
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

function sitesOfView(title) {
	var viewUri = source.virtualUri(title);
	return $tw.wiki.getCacheForTiddler(title, VIEW_CACHE_KEY, function() {
		return sitesOfDocument(viewUri, source.virtualText(title));
	});
}

// A name never spans lines, so the cursor only has to sit on the name's line,
// anywhere from its first character to just after its last.
function siteAt(sites, position) {
	for(var i = 0; i < sites.length; i++) {
		var range = sites[i].range;
		if(range.start.line === position.line && position.character >= range.start.character && position.character <= range.end.character) {
			return sites[i];
		}
	}
	return null;
}

// VS Code writes a drive letter lowercase with its colon escaped
// (file:///e%3A/...), where a path from $tw.boot.files gives file:///E:/...,
// so two spellings of one file must compare equal; a view compares by title.
function sameFileKey(uri) {
	if(source.isVirtualUri(uri)) {
		return "tiddlywiki:" + source.titleOfVirtualUri(uri);
	}
	return decodeURIComponent(uri).replace(/^file:\/\/\/([a-zA-Z]):/, function(match, drive) {
		return "file:///" + drive.toLowerCase() + ":";
	});
}

// Wikitext tiddlers the editor can only open as a view: real ones no file holds
// exactly, and shadows that no real tiddler overrides, since only the running
// text counts.
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

// A cheap test before a tiddler is parsed: the name appears in some field.
function mentions(title, name) {
	var tiddler = $tw.wiki.getTiddler(title);
	return Object.keys(tiddler.fields).some(function(key) {
		return key !== "title" && tiddler.getFieldString(key).includes(name);
	});
}

// Every document the editor can open, once each, under whichever spelling of
// its URI came first: open buffers, then the wiki's .tid files, then views.
// visit(uri, title, sites) is handed sites() to call only if it needs them,
// since parsing is the expensive part.
function eachDocument(openDocuments, visit) {
	var seen = Object.create(null);
	function offer(docUri, title, sites, key) {
		seen[key || sameFileKey(docUri)] = true;
		visit(docUri, title, sites);
	}
	Object.keys(openDocuments || {}).forEach(function(openUri) {
		offer(openUri, source.titleOfDocument(openUri, openDocuments[openUri]), function() {
			return sitesOfDocument(openUri, openDocuments[openUri]);
		});
	});
	var files = $tw.boot.files || {};
	for(var title in files) {
		var filepath = files[title].filepath;
		if(filepath && source.isTidUri(filepath)) {
			var file = fileDocument(filepath);
			if(!seen[file.key]) {
				offer(file.uri, title, sitesOfFile.bind(null, filepath), file.key);
			}
		}
	}
	// A title filed since the views were listed is a file now.
	wikiOnlyViews().forEach(function(view) {
		if(!seen[view.key] && !source.hasFile(view.title)) {
			offer(view.uri, view.title, sitesOfView.bind(null, view.title), view.key);
		}
	});
}

// A file's URI and comparison key, which depend on its path alone.
function fileDocument(filepath) {
	if(!fileDocuments[filepath]) {
		var fileUri = source.pathToUri(filepath);
		fileDocuments[filepath] = { uri: fileUri, key: sameFileKey(fileUri) };
	}
	return fileDocuments[filepath];
}

// The views of wikitext tiddlers no file holds, as { title, uri, key }. Finding
// them walks every tiddler, so the list waits in the wiki's global cache, which
// every change to the wiki clears.
function wikiOnlyViews() {
	return $tw.wiki.getGlobalCache(VIEWS_CACHE_KEY, function() {
		return wikiOnlyTitles().map(function(title) {
			var viewUri = source.virtualUri(title);
			return { title: title, uri: viewUri, key: sameFileKey(viewUri) };
		});
	});
}

// Every site named name in every document the editor can open, as { uri, site }.
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
