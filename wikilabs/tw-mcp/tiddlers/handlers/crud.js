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

	"get_tiddlers": function(args) {
		if(!args.titles || !Array.isArray(args.titles) || args.titles.length === 0) {
			return shared.errorResult("get_tiddlers: 'titles' must be a non-empty array");
		}
		// detailed defaults to TRUE: the batch use case is reading multiple
		// tiddlers' content; metadata-only batch is rare.
		var detailed = args.detailed !== false;
		// verbose=false (default) skips bookkeeping fields. Set true to include them.
		var verbose = !!args.verbose;
		var format = args.format || "hashline";
		var maxTiddlers = args.max_tiddlers || 50;
		var maxBytes = args.max_bytes || 50000;
		var SKIP_FIELDS = {created: 1, modified: 1, creator: 1, modifier: 1, revision: 1};
		function shouldSkipField(name) {
			return !verbose && SKIP_FIELDS[name];
		}
		function extractFields(tiddler, includeText) {
			var fields = {};
			for(var field in tiddler.fields) {
				if(field === "text" && !includeText) continue;
				if(shouldSkipField(field)) continue;
				var value = tiddler.fields[field];
				if(Array.isArray(value)) {
					fields[field] = value.slice();
				} else if($tw.utils.isDate(value)) {
					fields[field] = $tw.utils.stringifyDate(value);
				} else {
					fields[field] = value;
				}
			}
			return fields;
		}
		// title-first fields block (overrides TW's alphabetical sort), with
		// optional bookkeeping filter applied.
		function formatFieldsBlock(tiddler) {
			var strings = tiddler.getFieldStrings({exclude: ["text"]});
			var names = Object.keys(strings).sort();
			var lines = [];
			if(strings.title !== undefined) {
				lines.push("title: " + strings.title);
			}
			for(var i = 0; i < names.length; i++) {
				var n = names[i];
				if(n === "title") continue;
				if(shouldSkipField(n)) continue;
				lines.push(n + ": " + strings[n]);
			}
			return lines.join("\n");
		}
		function renderText(tiddler, includeText) {
			var hasUnsafe = false;
			$tw.utils.each(tiddler.getFieldStrings(), function(value, fieldName) {
				if(fieldName !== "text") {
					hasUnsafe = hasUnsafe || /[\x00-\x1F]/mg.test(value);
					hasUnsafe = hasUnsafe || ($tw.utils.trim(value) !== value);
				}
				hasUnsafe = hasUnsafe || /:|#/mg.test(fieldName);
			});
			var out;
			if(hasUnsafe && format !== "tid") {
				out = JSON.stringify(extractFields(tiddler, false), null, $tw.config.preferences.jsonSpaces);
			} else {
				out = formatFieldsBlock(tiddler);
			}
			if(includeText && tiddler.fields.text !== undefined) {
				if(format === "hashline") {
					var hashlineLib = require("$:/core/modules/commands/inspect/hashline.js");
					out += "\n\n" + hashlineLib.formatHashLines(tiddler.fields.text);
				} else {
					out += "\n\n" + tiddler.fields.text;
				}
			}
			return out;
		}
		var entries = [];
		var missing = [];
		var totalBytes = 0;
		var truncated = 0;
		var inputTitles = args.titles;
		for(var i = 0; i < inputTitles.length; i++) {
			var title = inputTitles[i];
			if(entries.length >= maxTiddlers) {
				truncated = inputTitles.length - i;
				break;
			}
			var tiddler = $tw.wiki.getTiddler(title);
			if(!tiddler) {
				missing.push(title);
				continue;
			}
			var isPlugin = !!tiddler.fields["plugin-type"];
			// Plugins: fields-only (no shadow tree, no bundle text) regardless of detailed.
			var realDetailed = detailed && !isPlugin;
			var entry;
			var entryBytes;
			if(format === "json") {
				entry = { fields: extractFields(tiddler, realDetailed) };
				entryBytes = JSON.stringify(entry.fields).length + 8;
			} else {
				entry = { content: renderText(tiddler, realDetailed) };
				entryBytes = entry.content.length + 4;
			}
			if(entries.length > 0 && totalBytes + entryBytes > maxBytes) {
				truncated = inputTitles.length - i;
				break;
			}
			totalBytes += entryBytes;
			entries.push(entry);
		}
		if(format === "json") {
			var result = { tiddlers: entries.map(function(e) { return e.fields; }) };
			if(missing.length > 0) result.missing = missing;
			if(truncated > 0) result.truncated = truncated;
			return shared.textResult(JSON.stringify(result, null, $tw.config.preferences.jsonSpaces));
		}
		// CompoundTiddlers (text/vnd.tiddlywiki-multiple): blocks separated by `\n+\n`.
		// Missing titles surface in a trailing `Missing: ...` line so the LLM can
		// retry/correct without misreading a stub block as real content.
		var blocks = entries.map(function(e) { return e.content.replace(/\n+$/, ""); });
		var output = blocks.join("\n+\n");
		var trailers = [];
		if(missing.length > 0) {
			trailers.push("Missing: " + missing.join(", "));
		}
		if(truncated > 0) {
			trailers.push("(" + truncated + " entries truncated; raise max_tiddlers or max_bytes)");
		}
		if(trailers.length > 0) {
			output += (output ? "\n\n" : "") + trailers.join("\n");
		}
		return shared.textResult(output);
	},

	"put_tiddler": function(args) {
		var denied = shared.checkWritable("put_tiddler");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "put_tiddler");
		if(titleErr) return titleErr;
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
		var titleErr = shared.checkTitle(args.title, "edit_tiddler");
		if(titleErr) return titleErr;
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
		var titleErr = shared.checkTitle(args.title, "resave_tiddler");
		if(titleErr) return titleErr;
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

	"rename_tiddler": function(args) {
		var denied = shared.checkWritable("rename_tiddler");
		if(denied) return denied;
		var fromErr = shared.checkTitle(args.from, "rename_tiddler");
		if(fromErr) return fromErr;
		var toErr = shared.checkTitle(args.to, "rename_tiddler");
		if(toErr) return toErr;
		if(args.from === args.to) {
			return shared.errorResult("rename_tiddler: from and to are identical: " + args.from);
		}
		var oldTiddler = $tw.wiki.getTiddler(args.from);
		if(!oldTiddler) {
			return shared.errorResult("Tiddler not found: " + args.from);
		}
		var pluginType = oldTiddler.fields["plugin-type"];
		if(pluginType === "plugin" || pluginType === "theme" || pluginType === "language") {
			return shared.errorResult("Refusing to rename bundled " + pluginType + ": " + args.from);
		}
		var oldFileInfo = $tw.boot.files && $tw.boot.files[args.from];
		if(oldFileInfo && /\.multids$/i.test(oldFileInfo.filepath)) {
			return shared.errorResult("Tiddler is bundled in a .multids file, cannot rename individually: " + args.from);
		}
		var existingTarget = $tw.wiki.getTiddler(args.to);
		if(existingTarget && !args.overwrite) {
			return shared.errorResult("Target tiddler already exists: " + args.to + " (pass overwrite=true to replace)");
		}
		// Build new tiddler with the new title. preserve_timestamps defaults
		// to true (housekeeping rename), set false to bump `modified`.
		var preserveTimestamps = args.preserve_timestamps !== false;
		var newTiddler = preserveTimestamps
			? new $tw.Tiddler(oldTiddler.fields, {title: args.to})
			: new $tw.Tiddler(oldTiddler.fields, $tw.wiki.getModificationFields(), {title: args.to});
		// Persist the new tiddler (handles FSP path resolution, write, verify,
		// rollback). On failure the new file/store entry is rolled back and
		// `from` is left untouched.
		var result = shared.persistTiddler(newTiddler, args.to, "renamed-to");
		if(result && result.isError) {
			return result;
		}
		// Remove the old tiddler from disk and store. Best-effort: if the
		// unlink fails we still report the rename a success since the new
		// tiddler is in place; only stderr-warn.
		if(oldFileInfo) {
			try {
				$tw.utils.deleteTiddlerFile(oldFileInfo, function(err) {
					if(err) {
						process.stderr.write("[tw-mcp] rename_tiddler: error removing old file " + oldFileInfo.filepath + ": " + err + "\n");
					}
				});
			} catch(e) {
				process.stderr.write("[tw-mcp] rename_tiddler: exception removing old file " + oldFileInfo.filepath + ": " + e.message + "\n");
			}
			delete $tw.boot.files[args.from];
		}
		$tw.wiki.deleteTiddler(args.from);
		var newPath = $tw.boot.files[args.to] && $tw.boot.files[args.to].filepath;
		return shared.textResult("Tiddler renamed: " + args.from + " -> " + args.to + "\n" +
			"old: " + (oldFileInfo ? oldFileInfo.filepath : "(no file)") + "\n" +
			"new: " + (newPath || "(no file)"));
	},

	"replace_in_tiddlers": function(args) {
		var denied = shared.checkWritable("replace_in_tiddlers");
		if(denied) return denied;
		if(!args.rules || !Array.isArray(args.rules) || args.rules.length === 0) {
			return shared.errorResult("replace_in_tiddlers: 'rules' must be a non-empty array of {pattern, replacement} objects");
		}
		var fields = (args.fields && args.fields.length > 0) ? args.fields : ["text", "caption", "list", "tags"];
		var scope = args.filter || (args.include_system ? "[all[tiddlers]]" : "[all[tiddlers]!is[system]]");
		var dryRun = args.dry_run !== false;
		var maxTiddlers = args.max_tiddlers || 100;
		var maxReplacementsTotal = args.max_replacements_total || 1000;
		var compiledRules = [];
		for(var i = 0; i < args.rules.length; i++) {
			var rule = args.rules[i];
			if(typeof rule.pattern !== "string" || rule.pattern.length === 0) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " missing or empty 'pattern'");
			}
			if(typeof rule.replacement !== "string") {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " 'replacement' must be a string");
			}
			if(rule.pattern.length > shared.MAX_FILTER_LENGTH) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " pattern too long (max " + shared.MAX_FILTER_LENGTH + ")");
			}
			var caseSensitive = !!rule.case_sensitive;
			var regexp = !!rule.regexp;
			var words = !!rule.words;
			var matcher;
			try {
				var src = regexp ? rule.pattern : rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				if(words) {
					src = "\\b(?:" + src + ")\\b";
				}
				matcher = new RegExp(src, "g" + (caseSensitive ? "" : "i"));
			} catch(e) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " invalid regex: " + e.message);
			}
			compiledRules.push({matcher: matcher, replacement: rule.replacement});
		}
		var sourceTitles;
		try {
			sourceTitles = $tw.wiki.filterTiddlers(scope);
		} catch(e) {
			return shared.errorResult("Filter error: " + e.message);
		}
		// Scan: per tiddler, per listed field, per line. Replacements within
		// a line are sequential across rules (rule2 sees rule1's output) so
		// chained renames work like sed -e ... -e ....
		var modified = [];
		var totalReplacements = 0;
		var truncated = false;
		for(var ti = 0; ti < sourceTitles.length && !truncated; ti++) {
			var title = sourceTitles[ti];
			var tiddler = $tw.wiki.getTiddler(title);
			if(!tiddler) continue;
			var perFieldChanges = [];
			var newFieldValues = {};
			var tiddlerReplacements = 0;
			for(var fi = 0; fi < fields.length; fi++) {
				var field = fields[fi];
				var rawValue = tiddler.fields[field];
				var isArrayField = Array.isArray(rawValue);
				var value;
				if(isArrayField) {
					value = $tw.utils.stringifyList(rawValue);
				} else if(typeof rawValue === "string") {
					value = rawValue;
				} else {
					continue;
				}
				var lines = value.split(/\r?\n/);
				var lineDiffs = [];
				var newLines = [];
				var fieldChanged = false;
				for(var li = 0; li < lines.length; li++) {
					var before = lines[li];
					var after = before;
					var lineReplacements = 0;
					for(var ri = 0; ri < compiledRules.length; ri++) {
						var cr = compiledRules[ri];
						var matches = after.match(cr.matcher);
						if(matches) {
							lineReplacements += matches.length;
							after = after.replace(cr.matcher, cr.replacement);
						}
					}
					if(after !== before) {
						lineDiffs.push({lineNum: li + 1, before: before, after: after, count: lineReplacements});
						tiddlerReplacements += lineReplacements;
						fieldChanged = true;
					}
					newLines.push(after);
				}
				if(fieldChanged) {
					var newValue = newLines.join("\n");
					newFieldValues[field] = isArrayField ? $tw.utils.parseStringArray(newValue) : newValue;
					perFieldChanges.push({field: field, isArrayField: isArrayField, lineDiffs: lineDiffs});
				}
			}
			if(perFieldChanges.length === 0) continue;
			if(totalReplacements + tiddlerReplacements > maxReplacementsTotal) {
				truncated = true;
				break;
			}
			modified.push({
				title: title,
				newFieldValues: newFieldValues,
				perFieldChanges: perFieldChanges,
				tiddlerReplacements: tiddlerReplacements
			});
			totalReplacements += tiddlerReplacements;
			if(modified.length >= maxTiddlers) {
				truncated = true;
				break;
			}
		}
		if(modified.length === 0) {
			return shared.textResult("(no matches)");
		}
		if(dryRun) {
			var hashline = require("$:/core/modules/commands/inspect/hashline.js");
			var blocks = [];
			for(var mi = 0; mi < modified.length; mi++) {
				var m = modified[mi];
				var lines = [m.title];
				for(var ci = 0; ci < m.perFieldChanges.length; ci++) {
					var ch = m.perFieldChanges[ci];
					for(var di = 0; di < ch.lineDiffs.length; di++) {
						var ld = ch.lineDiffs[di];
						var prefix = (ch.field === "text")
							? hashline.formatLineTag(ld.lineNum, ld.before)
							: ch.field + ":L" + ld.lineNum;
						lines.push("  - " + prefix + ": " + ld.before);
						lines.push("  + " + prefix + ": " + ld.after);
					}
				}
				blocks.push(lines.join("\n"));
			}
			var output = blocks.join("\n\n");
			output += "\n\nDRY RUN: " + totalReplacements + " replacement" + (totalReplacements !== 1 ? "s" : "") +
				" across " + modified.length + " tiddler" + (modified.length !== 1 ? "s" : "");
			if(truncated) {
				output += "\n(truncated; raise max_tiddlers or max_replacements_total to see more)";
			}
			output += "\nCall again with dry_run=false to apply.";
			return shared.textResult(output);
		}
		// Apply: build a new tiddler per modified entry and persist.
		var persisted = 0;
		var failures = [];
		var modificationFields = $tw.wiki.getModificationFields();
		for(var mi = 0; mi < modified.length; mi++) {
			var m = modified[mi];
			var existing = $tw.wiki.getTiddler(m.title);
			if(!existing) {
				failures.push(m.title + ": tiddler vanished before persist");
				continue;
			}
			var newTiddler = new $tw.Tiddler(existing.fields, m.newFieldValues, modificationFields, {title: m.title});
			var result = shared.persistTiddler(newTiddler, m.title, "replaced");
			if(result && result.isError) {
				failures.push(m.title + ": " + result.content[0].text);
			} else {
				persisted++;
			}
		}
		var summary = persisted + " tiddler" + (persisted !== 1 ? "s" : "") + " modified, " +
			totalReplacements + " replacement" + (totalReplacements !== 1 ? "s" : "");
		if(failures.length > 0) {
			summary += "\n\nFailures (" + failures.length + "):\n  " + failures.join("\n  ");
		}
		if(truncated) {
			summary += "\n(truncated; re-run with narrower filter or higher caps for remaining matches)";
		}
		return shared.textResult(summary);
	},

	"delete_tiddler": function(args) {
		var denied = shared.checkWritable("delete_tiddler");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "delete_tiddler");
		if(titleErr) return titleErr;
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
