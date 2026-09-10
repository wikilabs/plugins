/*\
title: $:/core/modules/commands/inspect/lsp/lsp-reload.js
type: application/javascript
module-type: library

A .tid saved in the editor, read into the running wiki. The wiki does not watch
its folder, so without this every hover, global and reference would keep
answering from the text as it was when the wiki started.

\*/

"use strict";

var path = $tw.node ? require("path") : null;

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// Loads the .tid at uri into the wiki and returns the titles it holds, or null
// when the file is not the wiki's: one it files a tiddler in, or one in its
// tiddlers folder. A plugin's source file must never become a real tiddler.
function reloadSaved(uri) {
	if(!source.isTidUri(uri)) {
		return null;
	}
	var key = files.sameFileKey(uri),
		filed = titlesFiledAt(key);
	if(!filed.length && !inTiddlersFolder(key)) {
		return null;
	}
	var filepath = filed.length ? $tw.boot.files[filed[0]].filepath : path.resolve(source.uriToPath(uri)),
		loaded = $tw.loadTiddlersFromFile(filepath),
		titles = [];
	loaded.tiddlers.forEach(function(fields) {
		if(!fields.title) {
			return;
		}
		titles.push(fields.title);
		$tw.boot.files[fields.title] = Object.assign({}, $tw.boot.files[fields.title], { filepath: filepath, type: loaded.type, hasMetaFile: loaded.hasMetaFile });
		if(!sameFields($tw.wiki.getTiddler(fields.title), fields)) {
			shared.addToWikiSilently(fields);
		}
	});
	// A title the file no longer holds is unfiled first, so the syncer's delete
	// finds no file to remove: the file now belongs to the new title.
	filed.forEach(function(title) {
		if(!titles.includes(title)) {
			delete $tw.boot.files[title];
			$tw.wiki.deleteTiddler(title);
		}
	});
	return titles;
}

function titlesFiledAt(key) {
	return Object.keys($tw.boot.files || {}).filter(function(title) {
		var filepath = $tw.boot.files[title].filepath;
		return !!filepath && files.sameFileKey(source.pathToUri(filepath)) === key;
	});
}

function inTiddlersFolder(key) {
	return !!$tw.boot.wikiTiddlersPath && key.startsWith(files.sameFileKey(source.pathToUri(path.resolve($tw.boot.wikiTiddlersPath))) + "/");
}

// An unchanged save adds nothing, so it fires no change and clears no cache.
function sameFields(tiddler, fields) {
	if(!tiddler) {
		return false;
	}
	var before = tiddler.getFieldStrings(),
		after = new $tw.Tiddler(fields).getFieldStrings();
	return Object.keys(before).length === Object.keys(after).length && Object.keys(after).every(function(name) {
		return before[name] === after[name];
	});
}

exports.reloadSaved = reloadSaved;
