/*\
title: $:/core/modules/commands/inspect/lsp/lsp-references.js
type: application/javascript
module-type: library

Find references: every place the macro, procedure, function or widget under the
cursor is called, across the wiki's .tid files.

The call sites come from tw-mcp-core's calls.js, which knows nothing about LSP.
What this file adds is the editor's view of them. Files are read from DISK,
because the running wiki does not watch its folder, so a file saved from the
editor can differ from the wiki's copy; and an open buffer beats both, because
it is what the reader is looking at.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null;

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// Sites per file path, kept while the file's mtime and size are unchanged.
var fileCache = Object.create(null);

// Sites of a tiddler's read-only view, in the wiki's own per-tiddler cache.
var VIEW_CACHE_KEY = "tw-lsp-view-sites";

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
		located.push({
			name: site.name,
			start: base - body.offset + site.start,
			definition: definition,
			range: {
				start: source.positionAt(body.starts, base + site.start),
				end: source.positionAt(body.starts, base + site.end)
			}
		});
	}
	found.calls.forEach(function(site) { add(site, false, body.offset); });
	found.definitions.forEach(function(site) { add(site, true, body.offset); });
	headerFields(body).forEach(function(field) {
		calls.sitesIn(field.value).calls.forEach(function(site) { add(site, false, field.start); });
	});
	return located;
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
// so two spellings of one file must compare equal.
function sameFileKey(uri) {
	if(source.isVirtualUri(uri)) {
		return "tiddlywiki:" + source.titleOfVirtualUri(uri);
	}
	return decodeURIComponent(uri).replace(/^file:\/\/\/([a-zA-Z]):/, function(match, drive) {
		return "file:///" + drive.toLowerCase() + ":";
	});
}

function references(uri, text, position, context, openDocuments) {
	var here = sitesOfDocument(uri, text),
		target = siteAt(here, position);
	if(!target) {
		return null;
	}
	var includeDeclaration = !!(context && context.includeDeclaration),
		body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text),
		binding = target.definition ? null : scope.resolve(target.name, target.start, tree, body.text);
	if(binding) {
		return scopedReferences(uri, here, binding, tree, body, includeDeclaration);
	}
	var documents = Object.assign({}, openDocuments),
		seen = Object.create(null),
		locations = [];
	documents[uri] = text;
	function add(docUri, sites) {
		for(var i = 0; i < sites.length; i++) {
			if(sites[i].name === target.name && (includeDeclaration || !sites[i].definition)) {
				locations.push({ uri: docUri, range: sites[i].range });
			}
		}
	}
	for(var openUri in documents) {
		seen[sameFileKey(openUri)] = true;
		add(openUri, openUri === uri ? here : sitesOfDocument(openUri, documents[openUri]));
	}
	var files = $tw.boot.files || {};
	for(var title in files) {
		var filepath = files[title].filepath;
		if(!filepath || !source.isTidUri(filepath)) {
			continue;
		}
		var fileUri = source.pathToUri(filepath);
		if(!seen[sameFileKey(fileUri)]) {
			seen[sameFileKey(fileUri)] = true;
			add(fileUri, sitesOfFile(filepath));
		}
	}
	// Last, tiddlers with no file of their own, as the read-only view the editor
	// opens for them.
	wikiOnlyTitles().forEach(function(title) {
		var viewUri = source.virtualUri(title);
		if(!seen[sameFileKey(viewUri)] && mentions(title, target.name)) {
			seen[sameFileKey(viewUri)] = true;
			add(viewUri, $tw.wiki.getCacheForTiddler(title, VIEW_CACHE_KEY, function() {
				return sitesOfDocument(viewUri, source.virtualText(title));
			}));
		}
	});
	return locations.sort(byPosition);
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

// A parameter or a widget's variable is that name only inside its own scope in
// this document, and an inner binding of the same name hides it.
function scopedReferences(uri, sites, binding, tree, body, includeDeclaration) {
	var locations = sites.filter(function(site) {
		if(site.definition || site.name !== binding.name) {
			return false;
		}
		var own = scope.resolve(site.name, site.start, tree, body.text);
		return own && own.scope.node === binding.scope.node;
	}).map(function(site) {
		return { uri: uri, range: site.range };
	});
	if(includeDeclaration && binding.declaration) {
		locations.push({
			uri: uri,
			range: {
				start: source.positionAt(body.starts, body.offset + binding.declaration.start),
				end: source.positionAt(body.starts, body.offset + binding.declaration.end)
			}
		});
	}
	return locations.sort(byPosition);
}

function byPosition(a, b) {
	if(a.uri !== b.uri) {
		return a.uri < b.uri ? -1 : 1;
	}
	return (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character);
}

exports.references = references;
exports.sameFileKey = sameFileKey;
