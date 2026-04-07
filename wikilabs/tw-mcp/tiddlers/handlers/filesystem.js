/*\
title: $:/core/modules/commands/inspect/handlers/filesystem.js
type: application/javascript
module-type: library

MCP tool handlers for filesystem and build operations.

\*/

"use strict";

var fs = require("fs"),
	path = require("path");

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// Change log: accumulates $tw.wiki changes between reload_tiddlers calls
var changeLog = {};
var changeLogActive = false;

function startChangeLog() {
	if(changeLogActive) {
		return;
	}
	changeLogActive = true;
	$tw.wiki.addEventListener("change", function(changes) {
		var titles = Object.keys(changes);
		for(var i = 0; i < titles.length; i++) {
			var title = titles[i];
			if(title.indexOf("$:/") === 0) {
				continue;
			}
			if(changes[title].deleted) {
				changeLog[title] = "deleted";
			} else if(changeLog[title] === undefined) {
				changeLog[title] = "added";
			} else {
				changeLog[title] = "updated";
			}
		}
	});
}

module.exports = {
	"reload_tiddlers": function(args) {
		var scope = (args && args.scope) || "tiddlers";
		var messages = [];

		// Reload edition tiddlers
		if(scope === "tiddlers" || scope === "all") {
			if(!$tw.boot.wikiTiddlersPath) {
				return { isError: true, content: [{ type: "text", text: "No wiki tiddlers path available. Cannot reload from filesystem." }] };
			}
			var resolvedWikiPath = $tw.boot.wikiTiddlersPath;
			var wikiInfo = $tw.boot.wikiInfo || {};
			var config = wikiInfo.config || {};
			var countBefore = $tw.wiki.allTitles().length;
			var added = 0, updated = 0, skippedSystem = 0, unchanged = 0;
			var diskTiddlers = Object.create(null);
			var diskFileInfo = Object.create(null);
			$tw.utils.each($tw.loadTiddlersFromPath(resolvedWikiPath), function(tiddlerFile) {
				$tw.utils.each(tiddlerFile.tiddlers, function(tiddlerFields) {
					var title = tiddlerFields.title;
					if(!title) return;
					diskTiddlers[title] = tiddlerFields;
					if(tiddlerFile.filepath) {
						diskFileInfo[title] = {
							filepath: tiddlerFile.filepath,
							type: tiddlerFile.type,
							hasMetaFile: tiddlerFile.hasMetaFile,
							isEditableFile: config["retain-original-tiddler-path"] || tiddlerFile.isEditableFile || tiddlerFile.filepath.indexOf($tw.boot.wikiTiddlersPath) !== 0
						};
					}
				});
			});
			for(var title in diskTiddlers) {
				if(title.indexOf("$:/") === 0) {
					skippedSystem++;
					continue;
				}
				var tiddlerFields = diskTiddlers[title];
				if(diskFileInfo[title]) {
					$tw.boot.files[title] = diskFileInfo[title];
				}
				var existing = $tw.wiki.getTiddler(title);
				if(existing) {
					var changed = false;
					var newTiddler = new $tw.Tiddler(tiddlerFields);
					var existingFields = existing.getFieldStrings();
					var newFields = newTiddler.getFieldStrings();
					if(Object.keys(existingFields).length !== Object.keys(newFields).length) {
						changed = true;
					} else {
						for(var field in newFields) {
							if(existingFields[field] !== newFields[field]) {
								changed = true;
								break;
							}
						}
					}
					if(changed) {
						$tw.wiki.addTiddler(newTiddler);
						updated++;
					} else {
						unchanged++;
					}
				} else {
					$tw.wiki.addTiddler(new $tw.Tiddler(tiddlerFields));
					added++;
				}
			}
			var deleted = 0;
			var allTitles = $tw.wiki.allTitles();
			for(var ti = 0; ti < allTitles.length; ti++) {
				var t = allTitles[ti];
				if($tw.boot.files[t] && $tw.boot.files[t].filepath) {
					var filePath = $tw.boot.files[t].filepath;
					if(filePath.indexOf(resolvedWikiPath) === 0 && !diskTiddlers[t]) {
						$tw.wiki.deleteTiddler(t);
						delete $tw.boot.files[t];
						deleted++;
					}
				}
			}
			var countAfter = $tw.wiki.allTitles().length;
			messages.push("Tiddlers reloaded from: " + resolvedWikiPath);
			messages.push("Before: " + countBefore + ", After: " + countAfter + " (added: " + added + ", updated: " + updated + ", unchanged: " + unchanged + ", skipped-system: " + skippedSystem + ", deleted: " + deleted + ")");
			// Report changes since last reload
			var logTitles = Object.keys(changeLog);
			if(logTitles.length > 0) {
				var logAdded = 0, logUpdated = 0, logDeleted = 0;
				var logLines = [];
				logTitles.sort();
				for(var li = 0; li < logTitles.length; li++) {
					var lt = logTitles[li];
					var action = changeLog[lt];
					if(action === "added") { logAdded++; logLines.push("  + " + lt); }
					else if(action === "updated") { logUpdated++; logLines.push("  ~ " + lt); }
					else if(action === "deleted") { logDeleted++; logLines.push("  - " + lt); }
				}
				messages.push("\nSince last reload: " + logAdded + " added, " + logUpdated + " updated, " + logDeleted + " deleted");
				messages.push(logLines.join("\n"));
				changeLog = {};
			} else if(changeLogActive) {
				messages.push("\nSince last reload: no changes");
			} else {
				messages.push("\nChange tracking started.");
			}
			startChangeLog();
		}

		// Reload shadow tiddlers from plugins
		if(scope === "shadows" || scope === "all") {
			try {
				var shadowsBefore = $tw.wiki.allShadowTitles().length;
				var results = $tw.wiki.readPluginInfo();
				var modified = results.modifiedPlugins || [];
				$tw.wiki.registerPluginTiddlers(null);
				$tw.wiki.unpackPluginTiddlers();
				var shadowsAfter = $tw.wiki.allShadowTitles().length;
				messages.push("\nShadow tiddlers refreshed");
				messages.push("Shadows: " + shadowsBefore + " -> " + shadowsAfter);
				if(modified.length > 0) {
					messages.push("Modified plugins: " + modified.join(", "));
				} else {
					messages.push("No plugin changes detected on disk");
				}
			} catch(e) {
				messages.push("\nShadow reload error: " + e.message);
			}
		}

		return { content: [{ type: "text", text: messages.join("\n") }] };
	},

	"save_wiki_folder": function(args) {
		var denied = shared.checkWritable("save_wiki_folder");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var outputPath = path.resolve(args.path);
		var pathDenied = checkPathAllowed(outputPath);
		if(pathDenied) return pathDenied;
		var tiddlerFilter = args.filter || "[all[tiddlers]]";
		var explodePlugins = (args.explodePlugins === "no") ? "no" : "yes";
		try {
			var commander = new $tw.Commander(
				["--savewikifolder", outputPath, "filter=" + tiddlerFilter, "explodePlugins=" + explodePlugins],
				function(err) {
					if(err) {
						process.stderr.write("[tw-mcp] savewikifolder error: " + err + "\n");
					}
				},
				$tw.wiki
			);
			commander.execute();
			return { content: [{ type: "text", text: "Wiki folder saved to: " + outputPath }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Failed to save wiki folder: " + e.message }] };
		}
	},

	"upload_file": function(args) {
		var denied = shared.checkWritable("upload_file");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var filename = args.filename;
		if(filename.indexOf("/") !== -1 || filename.indexOf("\\") !== -1 || filename.indexOf("..") !== -1) {
			return { isError: true, content: [{ type: "text", text: "Invalid filename: must not contain path separators or '..'" }] };
		}
		var wikiPath = $tw.boot.wikiPath;
		if(!wikiPath) {
			return { isError: true, content: [{ type: "text", text: "No wiki path available" }] };
		}
		var filesDir = path.resolve(wikiPath, "files");
		if(args.subfolder) {
			var subfolder = args.subfolder;
			if(subfolder.indexOf("..") !== -1) {
				return { isError: true, content: [{ type: "text", text: "Invalid subfolder: must not contain '..'" }] };
			}
			filesDir = path.resolve(filesDir, subfolder);
		}
		var targetPath = path.resolve(filesDir, filename);
		var pathDenied = checkPathAllowed(targetPath);
		if(pathDenied) return pathDenied;
		try {
			var buffer = Buffer.from(args.data, "base64");
			$tw.utils.createDirectory(filesDir);
			fs.writeFileSync(targetPath, buffer);
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Failed to write file: " + e.message }] };
		}
		var title = args.title || filename;
		var canonicalUri = "files/" + (args.subfolder ? args.subfolder + "/" : "") + filename;
		var creationFields = $tw.wiki.getCreationFields();
		var modificationFields = $tw.wiki.getModificationFields();
		var tiddlerFields = {
			title: title,
			type: args.type,
			_canonical_uri: canonicalUri
		};
		if(args.tags) {
			tiddlerFields.tags = args.tags;
		}
		var tiddler = new $tw.Tiddler(creationFields, tiddlerFields, modificationFields);
		$tw.wiki.addTiddler(tiddler);
		try {
			var tiddlerFileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
				directory: $tw.boot.wikiTiddlersPath,
				wiki: $tw.wiki,
				fileInfo: {}
			});
			$tw.utils.saveTiddlerToFileSync(tiddler, tiddlerFileInfo);
			$tw.boot.files[title] = tiddlerFileInfo;
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "File saved but failed to write .tid tiddler: " + e.message }] };
		}
		return { content: [{ type: "text", text: "File uploaded: " + targetPath + "\nTiddler created: " + tiddlerFileInfo.filepath + " (_canonical_uri: " + canonicalUri + ")" }] };
	},

	"build_wiki": function(args) {
		var denied = shared.checkWritable("build_wiki");
		if(denied) return denied;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var outputFile = path.resolve(args.output);
		var pathDenied = checkPathAllowed(outputFile);
		if(pathDenied) return pathDenied;
		var template = args.template || "$:/core/save/all";
		try {
			var text = $tw.wiki.renderTiddler("text/plain", template);
			$tw.utils.createFileDirectories(outputFile);
			fs.writeFileSync(outputFile, text, "utf8");
			return { content: [{ type: "text", text: "Wiki built: " + outputFile }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Failed to build wiki: " + e.message }] };
		}
	}
};
