/*\
title: $:/core/modules/commands/inspect/lsp/lsp-check.js
type: application/javascript
module-type: library

The diagnostics of one document, and the undefined calls and widgets of every
.tid file of the wiki at once, for an editor's problem list. That list leaves
hints out, so there they are information. A missing link target is shown only in
an open file: a wiki routinely links to tiddlers it has yet to write.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null;

var links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js"),
	names = require("$:/core/modules/commands/inspect/lsp/lsp-names.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

var SEVERITY_INFORMATION = 3;

// listed: undefined calls as information, which keeps them in the problem list.
function diagnostics(uri, text, listed) {
	return links.diagnostics(uri, text).concat(listed ? undefinedCalls(uri, text) : names.hints(uri, text));
}

function undefinedCalls(uri, text) {
	return names.hints(uri, text).map(function(hint) {
		return Object.assign({}, hint, { severity: SEVERITY_INFORMATION });
	});
}

// The undefined calls and widgets of every .tid file the wiki saves to, as
// [{ uri, diagnostics, open }], read from disk, or for a file open in the editor
// from its live text, marked open since its own diagnostics already show them.
function listUndefinedCalls(openDocuments) {
	var wikiFiles = tidFiles(),
		listed = [];
	Object.keys(openDocuments || {}).forEach(function(uri) {
		var key = files.sameFileKey(uri);
		if(wikiFiles[key]) {
			delete wikiFiles[key];
			listed.push({ uri: uri, diagnostics: undefinedCalls(uri, openDocuments[uri]), open: true });
		}
	});
	Object.keys(wikiFiles).forEach(function(key) {
		var uri = source.pathToUri(wikiFiles[key]);
		listed.push({ uri: uri, diagnostics: undefinedCalls(uri, fs.readFileSync(wikiFiles[key], "utf8")) });
	});
	return listed;
}

// The undefined calls and widgets of one .tid file of the wiki, read from disk,
// or null for a file the wiki does not save to.
function undefinedCallsInFile(uri) {
	var filepath = tidFiles()[files.sameFileKey(uri)];
	return filepath ? undefinedCalls(uri, fs.readFileSync(filepath, "utf8")) : null;
}

// The .tid files the wiki saves to that exist, by comparison key.
function tidFiles() {
	var found = Object.create(null);
	Object.keys($tw.boot.files || {}).forEach(function(title) {
		var filepath = $tw.boot.files[title].filepath;
		if(filepath && source.isTidUri(filepath) && fs.existsSync(filepath)) {
			found[files.sameFileKey(source.pathToUri(filepath))] = filepath;
		}
	});
	return found;
}

// What a listing found, as { files, undefinedCalls }.
function summarize(listed) {
	var summary = { files: listed.length, undefinedCalls: 0 };
	listed.forEach(function(entry) {
		summary.undefinedCalls += entry.diagnostics.length;
	});
	return summary;
}

exports.diagnostics = diagnostics;
exports.listUndefinedCalls = listUndefinedCalls;
exports.undefinedCallsInFile = undefinedCallsInFile;
exports.summarize = summarize;
