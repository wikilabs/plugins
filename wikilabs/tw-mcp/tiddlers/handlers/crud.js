/*\
title: $:/core/modules/commands/inspect/handlers/crud.js
type: application/javascript
module-type: library

MCP tool handlers for tiddler CRUD operations.

\*/

"use strict";

var fs = require("fs");
var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"get_tiddler": function(args) {
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + args.title);
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
			return shared.textResult(output);
		}
		var includeText = !!args.detailed || !!args.lines;
		// Detect unsafe fields (same check as TW filesystem: control chars, leading/trailing whitespace, : or # in field names)
		var hasUnsafeFields = false;
		$tw.utils.each(tiddler.getFieldStrings(),function(value,fieldName) {
			if(fieldName !== "text") {
				hasUnsafeFields = hasUnsafeFields || /[\x00-\x1F]/mg.test(value);
				hasUnsafeFields = hasUnsafeFields || ($tw.utils.trim(value) !== value);
			}
			hasUnsafeFields = hasUnsafeFields || /:|#/mg.test(fieldName);
		});
		if(args.format === "json") {
			// Pure JSON — no hashes, includes text if detailed
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
			return shared.textResult(JSON.stringify(fields, null, $tw.config.preferences.jsonSpaces));
		} else if(args.format === "tid") {
			// Plain tid — no hashes
			var output = tiddler.getFieldStringBlock({exclude: ["text"]});
			if(includeText && tiddler.fields.text !== undefined) {
				output += "\n\n" + tiddler.fields.text;
			}
			return shared.textResult(output);
		} else {
			// Default (hashline): tid headers for safe fields, JSON for unsafe, hashlined text
			var header;
			if(hasUnsafeFields) {
				var fields = {};
				for(var field in tiddler.fields) {
					if(field === "text") continue;
					var value = tiddler.fields[field];
					if(Array.isArray(value)) {
						fields[field] = value.slice();
					} else if($tw.utils.isDate(value)) {
						fields[field] = $tw.utils.stringifyDate(value);
					} else {
						fields[field] = value;
					}
				}
				header = JSON.stringify(fields, null, $tw.config.preferences.jsonSpaces);
			} else {
				header = tiddler.getFieldStringBlock({exclude: ["text"]});
			}
			var output = header;
			if(includeText && tiddler.fields.text !== undefined) {
				var hashline = require("$:/core/modules/commands/inspect/hashline.js");
				output += "\n\n" + hashline.formatHashLines(tiddler.fields.text);
			}
			return shared.textResult(output);
		}
	},

	"put_tiddler": function(args) {
		var denied = shared.checkWritable("put_tiddler");
		if(denied) return denied;
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
		return shared.persistTiddler(tiddler, title, "saved");
	},

	"edit_tiddler": function(args) {
		var denied = shared.checkWritable("edit_tiddler");
		if(denied) return denied;
		var hashline = require("$:/core/modules/commands/inspect/hashline.js");
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + args.title);
		}
		// Apply text edits if provided
		var newText = tiddler.fields.text || "";
		if(args.edits && args.edits.length > 0) {
			var edits = [];
			for(var i = 0; i < args.edits.length; i++) {
				var e = args.edits[i];
				var edit = { op: e.op, lines: e.lines || [] };
				if(e.pos) edit.pos = hashline.parseTag(e.pos);
				if(e.end) edit.end = hashline.parseTag(e.end);
				edits.push(edit);
			}
			try {
				var result = hashline.applyEdits(newText, edits);
				newText = result.text;
			} catch(e) {
				if(e.name === "HashlineMismatchError") {
					return shared.errorResult(e.message);
				}
				return shared.errorResult("Edit failed: " + e.message);
			}
		}
		// Build updated fields
		var updates = { text: newText };
		if(args.set_fields) {
			for(var key in args.set_fields) {
				if(key !== "text" && key !== "title") {
					updates[key] = args.set_fields[key];
				}
			}
		}
		var title = args.title;
		var modificationFields = $tw.wiki.getModificationFields();
		var newTiddler = new $tw.Tiddler(tiddler.fields, updates, modificationFields, { title: title });
		// Delete fields if requested
		if(args.delete_fields && args.delete_fields.length > 0) {
			var fieldsToKeep = {};
			for(var f in newTiddler.fields) {
				if(args.delete_fields.indexOf(f) === -1) {
					fieldsToKeep[f] = newTiddler.fields[f];
				}
			}
			newTiddler = new $tw.Tiddler(fieldsToKeep);
		}
		return shared.persistTiddler(newTiddler, title, "edited");
	},

	"resave_tiddler": function(args) {
		var denied = shared.checkWritable("resave_tiddler");
		if(denied) return denied;
		var title = args.title;
		var tiddler = $tw.wiki.getTiddler(title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + title);
		}
		var pluginType = tiddler.fields["plugin-type"];
		if(pluginType === "plugin" || pluginType === "theme" || pluginType === "language") {
			return shared.errorResult("Refusing to resave bundled " + pluginType + ": " + title);
		}
		var oldFileInfo = $tw.boot.files && $tw.boot.files[title];
		if(!oldFileInfo || !oldFileInfo.filepath) {
			return shared.errorResult("Tiddler has no file on disk (shadow-only): " + title);
		}
		if(/\.multids$/i.test(oldFileInfo.filepath)) {
			return shared.errorResult("Tiddler is bundled in a .multids file, cannot resave individually: " + title);
		}
		var fields = {};
		for(var f in tiddler.fields) {
			fields[f] = tiddler.fields[f];
		}
		var stripped = [];
		var stripRedundant = args.strip_redundant !== false;
		if(stripRedundant) {
			if("revision" in fields) { delete fields.revision; stripped.push("revision"); }
			if(fields.type === "text/vnd.tiddlywiki") { delete fields.type; stripped.push("type"); }
		}
		var preserveTimestamps = args.preserve_timestamps !== false;
		var newTiddler = preserveTimestamps
			? new $tw.Tiddler(fields)
			: new $tw.Tiddler(fields, $tw.wiki.getModificationFields());
		var oldPath = oldFileInfo.filepath;
		if(args.dry_run) {
			var fspText = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "");
			var fseText = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "");
			var pathFilters = fspText ? fspText.split("\n") : undefined;
			var extFilters = fseText ? fseText.split("\n") : undefined;
			var previewInfo = $tw.utils.generateTiddlerFileInfo(newTiddler, {
				directory: $tw.boot.wikiTiddlersPath,
				pathFilters: pathFilters,
				extFilters: extFilters,
				wiki: $tw.wiki,
				fileInfo: { overwrite: true }
			});
			var relocated = previewInfo.filepath !== oldPath;
			return shared.textResult(
				"DRY RUN resave_tiddler: " + title + "\n" +
				"old:       " + oldPath + "\n" +
				"new:       " + previewInfo.filepath + "\n" +
				"relocated: " + relocated + "\n" +
				"timestamps_preserved: " + preserveTimestamps + "\n" +
				"fields_stripped: " + (stripped.length ? stripped.join(",") : "(none)")
			);
		}
		var result = shared.persistTiddler(newTiddler, title, "resaved");
		if(result && result.isError) {
			return result;
		}
		var newPath = $tw.boot.files[title] && $tw.boot.files[title].filepath;
		var relocated = !!(newPath && oldPath && newPath !== oldPath);
		if(relocated) {
			try { fs.unlinkSync(oldPath); } catch(e) { /* best effort */ }
			try {
				if(fs.existsSync(oldPath + ".meta")) fs.unlinkSync(oldPath + ".meta");
			} catch(e) { /* best effort */ }
		}
		var msg = "Tiddler resaved: " + title + "\n" +
			"old:       " + oldPath + "\n" +
			"new:       " + newPath + "\n" +
			"relocated: " + relocated + "\n" +
			"timestamps_preserved: " + preserveTimestamps + "\n" +
			"fields_stripped: " + (stripped.length ? stripped.join(",") : "(none)");
		return shared.textResult(msg);
	},

	"delete_tiddler": function(args) {
		var denied = shared.checkWritable("delete_tiddler");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		if(!$tw.wiki.tiddlerExists(args.title)) {
			return shared.errorResult("Tiddler not found: " + args.title);
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
				return shared.errorResult("Tiddler deleted from store but failed to remove file: " + e.message);
			}
		}
		$tw.wiki.deleteTiddler(args.title);
		return shared.textResult("Tiddler deleted: " + args.title);
	}
};
