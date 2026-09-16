/*\
title: $:/core/modules/commands/inspect/lsp/lsp-check.js
type: application/javascript
module-type: library

The diagnostics of one document, and the names nothing defines in every .tid
file of the wiki at once, for an editor's problem list. That list leaves hints
out, so there they are information. A missing link target is shown only in an
open file: a wiki routinely links to tiddlers it has yet to write.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null;

var links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js"),
	names = require("$:/core/modules/commands/inspect/lsp/lsp-names.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

var SEVERITY_INFORMATION = 3;

// listed: undefined names as information, which keeps them in the problem list.
function diagnostics(uri, text, listed) {
	return links.diagnostics(uri, text).concat(listed ? undefinedNames(uri, text) : names.hints(uri, text));
}

function undefinedNames(uri, text) {
	return names.hints(uri, text).map(function(hint) {
		return Object.assign({}, hint, { severity: SEVERITY_INFORMATION });
	});
}

// The undefined names of every .tid file the wiki saves to, as [{ uri,
// diagnostics }], read from disk. A file open in the editor is left out: its
// live diagnostics stay.
function checkAll(openDocuments) {
	var wikiFiles = tidFiles(),
		checked = [];
	Object.keys(openDocuments || {}).forEach(function(uri) {
		delete wikiFiles[files.sameFileKey(uri)];
	});
	Object.keys(wikiFiles).forEach(function(key) {
		var uri = source.pathToUri(wikiFiles[key]);
		checked.push({ uri: uri, diagnostics: undefinedNames(uri, fs.readFileSync(wikiFiles[key], "utf8")) });
	});
	return checked;
}

// The undefined names of one .tid file of the wiki, read from disk, or null for a
// file the wiki does not save to.
function checkFile(uri) {
	var filepath = tidFiles()[files.sameFileKey(uri)];
	return filepath ? undefinedNames(uri, fs.readFileSync(filepath, "utf8")) : null;
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

// What a check found, as { files, undefinedNames }.
function summarize(checked) {
	var summary = { files: checked.length, undefinedNames: 0 };
	checked.forEach(function(entry) {
		summary.undefinedNames += entry.diagnostics.length;
	});
	return summary;
}

exports.diagnostics = diagnostics;
exports.checkAll = checkAll;
exports.checkFile = checkFile;
exports.summarize = summarize;
