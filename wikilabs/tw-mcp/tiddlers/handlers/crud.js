/*\
title: $:/core/modules/commands/inspect/handlers/crud.js
type: application/javascript
module-type: library

MCP tool handlers for tiddler CRUD operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"get_tiddler": function(args) {
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return { isError: true, content: [{ type: "text", text: "Tiddler not found: " + args.title }] };
		}
		if(tiddler.fields["plugin-type"]) {
			var pluginInfo = $tw.wiki.getPluginInfo(args.title);
			var shadowTitles = pluginInfo && pluginInfo.tiddlers ? Object.keys(pluginInfo.tiddlers).sort() : [];
			var fieldStrings = [];
			for(var f in tiddler.fields) {
				if(f === "text") continue;
				fieldStrings.push(f + ": " + tiddler.getFieldString(f));
			}
			var readmeTitle = args.title + "/readme";
			var readmeIdx = shadowTitles.indexOf(readmeTitle);
			if(readmeIdx > 0) {
				shadowTitles.splice(readmeIdx, 1);
				shadowTitles.unshift(readmeTitle);
			}
			var ns = shared.buildTree(shadowTitles);
			var header = ns.prefix ? ns.prefix + " ... " + shadowTitles.length + " shadow tiddlers\n" : "";
			var output = fieldStrings.join("\n") + "\n\n" + header + ns.tree;
			return { content: [{ type: "text", text: output }] };
		}
		var includeText = !!args.detailed;
		if(args.format === "hashline") {
			var hashline = require("$:/core/modules/commands/inspect/hashline.js");
			var fieldStrings = [];
			for(var f in tiddler.fields) {
				if(f === "text") continue;
				fieldStrings.push(f + ": " + tiddler.getFieldString(f));
			}
			var output = fieldStrings.join("\n");
			if(tiddler.fields.text !== undefined) {
				output += "\n\n" + hashline.formatHashLines(tiddler.fields.text);
			}
			return { content: [{ type: "text", text: output }] };
		}
		if(args.format !== "json") {
			var fieldStrings = [];
			for(var f in tiddler.fields) {
				if(f === "text") continue;
				fieldStrings.push(f + ": " + tiddler.getFieldString(f));
			}
			var output = fieldStrings.join("\n");
			if(includeText && tiddler.fields.text !== undefined) {
				output += "\n\n" + tiddler.fields.text;
			}
			return { content: [{ type: "text", text: output }] };
		}
		var fields = {};
		for(var field in tiddler.fields) {
			if(field === "text" && !includeText) continue;
			var value = tiddler.fields[field];
			if(Array.isArray(value)) {
				fields[field] = value.slice();
			} else if($tw.utils.isDate(value)) {
				fields[field] = $tw.utils.stringifyDate(value);
			} else {
				fields[field] = value;
			}
		}
		return { content: [{ type: "text", text: JSON.stringify(fields, null, $tw.config.preferences.jsonSpaces) }] };
	},

	"put_tiddler": function(args) {
		var denied = shared.checkWritable("put_tiddler");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var title = args.title,
			existingTiddler = $tw.wiki.getTiddler(title),
			creationFields = $tw.wiki.getCreationFields(),
			modificationFields = $tw.wiki.getModificationFields(),
			tiddler;
		if(existingTiddler && args.overwrite) {
			tiddler = new $tw.Tiddler(existingTiddler.fields, args.fields, modificationFields, {title: title});
		} else if(existingTiddler) {
			title = $tw.wiki.generateNewTitle(title);
			tiddler = new $tw.Tiddler(creationFields, args.fields, modificationFields, {title: title});
		} else {
			tiddler = new $tw.Tiddler(creationFields, args.fields, modificationFields, {title: title});
		}
		$tw.wiki.addTiddler(tiddler);
		if($tw.boot.wikiTiddlersPath) {
			try {
				var pathFilters, extFilters;
				if($tw.wiki.tiddlerExists("$:/config/FileSystemPaths")) {
					pathFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "").split("\n");
				}
				if($tw.wiki.tiddlerExists("$:/config/FileSystemExtensions")) {
					extFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "").split("\n");
				}
				var fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
					directory: $tw.boot.wikiTiddlersPath,
					pathFilters: pathFilters,
					extFilters: extFilters,
					wiki: $tw.wiki,
					fileInfo: $tw.boot.files[title] || {}
				});
				var pathDenied = checkPathAllowed(fileInfo.filepath);
				if(pathDenied) {
					$tw.wiki.deleteTiddler(title);
					return pathDenied;
				}
				$tw.utils.saveTiddlerToFileSync(tiddler, fileInfo);
				$tw.boot.files[title] = fileInfo;
				return { content: [{ type: "text", text: "Tiddler saved: " + title + " -> " + fileInfo.filepath }] };
			} catch(e) {
				return { isError: true, content: [{ type: "text", text: "Tiddler added to store but failed to save to disk: " + e.message }] };
			}
		}
		return { content: [{ type: "text", text: "Tiddler saved to store only (no wiki tiddlers path): " + title }] };
	},

	"edit_tiddler": function(args) {
		var denied = shared.checkWritable("edit_tiddler");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var hashline = require("$:/core/modules/commands/inspect/hashline.js");
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return { isError: true, content: [{ type: "text", text: "Tiddler not found: " + args.title }] };
		}
		var edits = [];
		for(var i = 0; i < args.edits.length; i++) {
			var e = args.edits[i];
			var edit = { op: e.op, lines: e.lines || [] };
			if(e.pos) edit.pos = hashline.parseTag(e.pos);
			if(e.end) edit.end = hashline.parseTag(e.end);
			edits.push(edit);
		}
		try {
			var result = hashline.applyEdits(tiddler.fields.text || "", edits);
		} catch(e) {
			if(e.name === "HashlineMismatchError") {
				return { isError: true, content: [{ type: "text", text: e.message }] };
			}
			return { isError: true, content: [{ type: "text", text: "Edit failed: " + e.message }] };
		}
		var title = args.title;
		var modificationFields = $tw.wiki.getModificationFields();
		var newTiddler = new $tw.Tiddler(tiddler.fields, { text: result.text }, modificationFields, { title: title });
		$tw.wiki.addTiddler(newTiddler);
		if($tw.boot.wikiTiddlersPath) {
			try {
				var pathFilters, extFilters;
				if($tw.wiki.tiddlerExists("$:/config/FileSystemPaths")) {
					pathFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "").split("\n");
				}
				if($tw.wiki.tiddlerExists("$:/config/FileSystemExtensions")) {
					extFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "").split("\n");
				}
				var fileInfo = $tw.utils.generateTiddlerFileInfo(newTiddler, {
					directory: $tw.boot.wikiTiddlersPath,
					pathFilters: pathFilters,
					extFilters: extFilters,
					wiki: $tw.wiki,
					fileInfo: $tw.boot.files[title] || {}
				});
				var pathDenied = checkPathAllowed(fileInfo.filepath);
				if(pathDenied) {
					$tw.wiki.deleteTiddler(title);
					return pathDenied;
				}
				$tw.utils.saveTiddlerToFileSync(newTiddler, fileInfo);
				$tw.boot.files[title] = fileInfo;
				return { content: [{ type: "text", text: "Tiddler edited: " + title + " -> " + fileInfo.filepath }] };
			} catch(e) {
				return { isError: true, content: [{ type: "text", text: "Tiddler edited in store but failed to save to disk: " + e.message }] };
			}
		}
		return { content: [{ type: "text", text: "Tiddler edited in store only: " + title }] };
	},

	"delete_tiddler": function(args) {
		var denied = shared.checkWritable("delete_tiddler");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		if(!$tw.wiki.tiddlerExists(args.title)) {
			return { isError: true, content: [{ type: "text", text: "Tiddler not found: " + args.title }] };
		}
		var fileInfo = $tw.boot.files && $tw.boot.files[args.title];
		if(fileInfo) {
			var pathDenied = checkPathAllowed(fileInfo.filepath);
			if(pathDenied) return pathDenied;
			try {
				$tw.utils.deleteTiddlerFile(fileInfo, function(err) {
					if(err) {
						process.stderr.write("[tw-mcp] Error deleting file for tiddler: " + args.title + ": " + err + "\n");
					}
				});
				delete $tw.boot.files[args.title];
			} catch(e) {
				$tw.wiki.deleteTiddler(args.title);
				return { isError: true, content: [{ type: "text", text: "Tiddler deleted from store but failed to remove file: " + e.message }] };
			}
		}
		$tw.wiki.deleteTiddler(args.title);
		return { content: [{ type: "text", text: "Tiddler deleted: " + args.title }] };
	}
};
