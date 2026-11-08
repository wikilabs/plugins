/*\
title: $:/core/modules/commands/inspect/lsp/lsp-shadows.js
type: application/javascript
module-type: library

The source file of a shadow tiddler. Boot records none, so the plugin folders
are found again the way boot loaded them; the core stays a read-only view.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null;

// Library kinds in the order boot loads them.
var KINDS = ["plugins", "themes", "languages"];

// Title -> { filepath, hasMetaFile, plugin }, built once: boot loads plugin folders only at startup.
var shadowFiles = null;

/**
 * Parses a JSON file, as boot does, null when it is missing or invalid.
 * @param {string} filepath - file path
 * @returns {(object|null)} Data
 */
function readJson(filepath) {
	if(!fs.existsSync(filepath) || !fs.statSync(filepath).isFile()) {
		return null;
	}
	return $tw.utils.parseJSONSafe(fs.readFileSync(filepath, "utf8"), function() { return null; });
}

/**
 * The folder boot loads a named plugin, theme or language from.
 * @param {string} kind - plugins, themes or languages
 * @param {string} name - eg: wikilabs/bundler
 * @returns {(string|null)} Folder
 */
function libraryFolder(kind, name) {
	return $tw.findLibraryItem(name, $tw.getLibraryItemSearchPaths($tw.config[kind + "Path"], $tw.config[kind + "EnvVar"]));
}

/**
 * Adds the plugin folders a wiki folder loads, includes first, as boot's loadWikiTiddlers does.
 * @param {string} wikiPath - wiki folder
 * @param {string[]} parents - folders already being loaded
 * @param {string[]} folders - receives the folders
 * @returns {void}
 */
function addWikiFolders(wikiPath, parents, folders) {
	var info = readJson(path.resolve(wikiPath, $tw.config.wikiInfo));
	if(!info) {
		return;
	}
	(info.includeWikis || []).forEach(function(entry) {
		var included = path.resolve(wikiPath, typeof entry === "string" ? entry : entry.path);
		if(!parents.includes(included)) {
			addWikiFolders(included, parents.concat(wikiPath), folders);
		}
	});
	KINDS.forEach(function(kind) {
		(info[kind] || []).forEach(function(name) {
			var folder = libraryFolder(kind, name);
			if(folder) {
				folders.push(folder);
			}
		});
	});
	KINDS.forEach(function(kind) {
		var dir = path.resolve(wikiPath, $tw.config["wiki" + kind.charAt(0).toUpperCase() + kind.slice(1) + "SubDir"]);
		if(fs.existsSync(dir)) {
			fs.readdirSync(dir).forEach(function(name) {
				folders.push(path.resolve(dir, name));
			});
		}
	});
}

/**
 * Every plugin folder boot loads after the core, in its order, so a later one replaces an earlier plugin of the same title.
 * @returns {string[]} Folders
 */
function bootFolders() {
	var folders = [];
	($tw.boot.extraPlugins || []).forEach(function(name) {
		var parts = name.split("/"),
			folder = null;
		if(name.charAt(0) === "+") {
			folder = path.resolve(name.substring(1));
		} else if(parts.length === 3 && KINDS.includes(parts[0])) {
			folder = libraryFolder(parts[0], parts[1] + "/" + parts[2]);
		}
		if(folder) {
			folders.push(folder);
		}
	});
	if($tw.boot.wikiPath) {
		addWikiFolders(path.resolve($tw.boot.wikiPath), [], folders);
	}
	return folders;
}

/**
 * Maps each title a running plugin folder holds alone in one file to that file.
 * @returns {Object<string, object>} Title -> { filepath, hasMetaFile, plugin }
 */
function buildShadowFiles() {
	var owners = Object.create(null),
		map = Object.create(null);
	bootFolders().forEach(function(folder) {
		var info = readJson(path.join(folder, "plugin.info"));
		if(info && info.title) {
			owners[info.title] = folder;
		}
	});
	Object.keys(owners).forEach(function(plugin) {
		// A plugin saved as a tiddler file in the wiki replaced the folder's version.
		if(!$tw.wiki.getTiddler(plugin) || ($tw.boot.files || {})[plugin]) {
			return;
		}
		$tw.loadTiddlersFromPath(owners[plugin]).forEach(function(file) {
			if(file.filepath && file.tiddlers.length === 1 && file.tiddlers[0].title) {
				map[file.tiddlers[0].title] = { filepath: file.filepath, hasMetaFile: !!file.hasMetaFile, plugin: plugin };
			}
		});
	});
	return map;
}

/**
 * Tells whether a source file entry is what the wiki runs: a shadow from that plugin that no real tiddler overrides.
 * @param {string} title - tiddler title
 * @param {object} entry - map entry
 * @returns {boolean} True if live
 */
function isLive(title, entry) {
	return !$tw.wiki.tiddlerExists(title) && $tw.wiki.isShadowTiddler(title) && $tw.wiki.getShadowSource(title) === entry.plugin;
}

/**
 * The map, built on first use.
 * @returns {Object<string, object>} Title -> entry
 */
function allShadowFiles() {
	if(!shadowFiles) {
		shadowFiles = $tw.node ? buildShadowFiles() : Object.create(null);
	}
	return shadowFiles;
}

/**
 * The source file of a running shadow.
 * @param {string} title - tiddler title
 * @returns {(object|null)} { filepath, hasMetaFile, plugin }
 */
function fileOfShadow(title) {
	var entry = allShadowFiles()[title];
	return entry && isLive(title, entry) ? entry : null;
}

/**
 * Every running shadow with a source file.
 * @returns {object[]} { title, filepath, hasMetaFile, plugin }
 */
function liveShadowFiles() {
	var map = allShadowFiles();
	return Object.keys(map).filter(function(title) {
		return isLive(title, map[title]);
	}).map(function(title) {
		return Object.assign({ title: title }, map[title]);
	});
}

exports.fileOfShadow = fileOfShadow;
exports.liveShadowFiles = liveShadowFiles;
