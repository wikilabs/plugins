/*\
title: $:/core/modules/commands/inspect/handlers/crud/rename_tiddler.js
type: application/javascript
module-type: library

MCP tool handler: rename_tiddler — write the new title, then unlink the
old file + store entry. Best-effort on the unlink (the new tiddler is
already in place).

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
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
		var bundledErr = shared.checkNotBundled(oldTiddler, "rename", args.from);
		if(bundledErr) return bundledErr;
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
		var newTiddler = shared.buildTiddlerWithTimestamps(oldTiddler.fields, {title: args.to}, preserveTimestamps);
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
	}
};
