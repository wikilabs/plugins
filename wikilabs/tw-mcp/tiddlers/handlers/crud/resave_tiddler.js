/*\
title: $:/core/modules/commands/inspect/handlers/crud/resave_tiddler.js
type: application/javascript
module-type: library

MCP tool handler: resave_tiddler — re-route an existing tiddler through
FSP/FSE filters, stripping redundant fields and optionally preserving
timestamps. Useful after FileSystemPaths changes.

\*/

"use strict";

var fs = require("fs");
var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
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
		var bundledErr = shared.checkNotBundled(tiddler, "resave", title);
		if(bundledErr) return bundledErr;
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
		var newTiddler = shared.buildTiddlerWithTimestamps(fields, null, preserveTimestamps);
		var oldPath = oldFileInfo.filepath;
		if(args.dry_run) {
			var filters = shared.loadFspFseFilters();
			var previewInfo = $tw.utils.generateTiddlerFileInfo(newTiddler, {
				directory: $tw.boot.wikiTiddlersPath,
				pathFilters: filters.pathFilters,
				extFilters: filters.extFilters,
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
	}
};
