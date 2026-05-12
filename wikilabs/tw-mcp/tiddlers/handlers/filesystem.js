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

var addToWikiSilently = shared.addToWikiSilently;

// Recursively check whether any wiki in the includeWikis tree has
// `retain-original-tiddler-path: true`. Each includeWikis entry is
// a path string or `{path: "..."}` object, resolved relative to the
// referring wiki's directory. Returns true on first hit.
function wikiInfoHasRetain(info, basePath, seen) {
	if(!info || !basePath) return false;
	if(info.config && info.config["retain-original-tiddler-path"]) return true;
	if(!info.includeWikis || !info.includeWikis.length) return false;
	seen = seen || Object.create(null);
	for(var i = 0; i < info.includeWikis.length; i++) {
		var inc = info.includeWikis[i];
		var incPath = (typeof inc === "string") ? inc : (inc && inc.path);
		if(!incPath) continue;
		try {
			var resolvedDir = path.resolve(basePath, incPath);
			if(seen[resolvedDir]) continue;
			seen[resolvedDir] = true;
			var infoPath = path.resolve(resolvedDir, "tiddlywiki.info");
			if(!fs.existsSync(infoPath)) continue;
			var subInfo = JSON.parse(fs.readFileSync(infoPath, "utf8"));
			if(wikiInfoHasRetain(subInfo, resolvedDir, seen)) return true;
		} catch(e) { /* ignore: continue to next include */ }
	}
	return false;
}

// Change log: accumulates $tw.wiki changes between reload_tiddlers calls
var changeLog = {};
var changeLogActive = false;
// Per-reload title set. The change listener runs on $tw.utils.nextTick
// AFTER reload_tiddlers returns, so events from the reload's own
// addTiddler / deleteTiddler calls would otherwise land in changeLog and
// show up as bogus entries on the next call. While reloadOwnedTitles is
// non-null, the listener skips titles in this set. Cleared via setImmediate
// (which fires after nextTick) so the events have a chance to be filtered.
var reloadOwnedTitles = null;

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
			if(reloadOwnedTitles && reloadOwnedTitles[title]) {
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
		var dualScope = (scope === "all");

		// Reload edition tiddlers
		if(scope === "tiddlers" || scope === "all") {
			if(dualScope) messages.push("=== scope: tiddlers ===");
			if(!$tw.boot.wikiTiddlersPath) {
				return shared.errorResult("No wiki tiddlers path available. Cannot reload from filesystem.");
			}
			var resolvedWikiPath = $tw.boot.wikiTiddlersPath;
			// Effective retain: the outer config does not always carry the
			// flag in an includeWikis setup, so walk the include tree.
			var outerBase = path.resolve($tw.boot.wikiPath || ".");
			var effectiveRetain = wikiInfoHasRetain($tw.boot.wikiInfo, outerBase);
			var added = 0, updated = 0, skippedSystem = 0, unchanged = 0;
			var diskTiddlers = Object.create(null);
			var diskFileInfo = Object.create(null);
			// Texts captured for in-call rename detection. Pair added/deleted
			// titles whose `text` field matches exactly: that case is a
			// rename (most often via bash mv plus reload).
			var addedTexts = Object.create(null);
			var deletedTexts = Object.create(null);
			// Activate listener-suppression for this reload's own touches.
			var ownedTitles = Object.create(null);
			reloadOwnedTitles = ownedTitles;
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
							isEditableFile: effectiveRetain || tiddlerFile.isEditableFile || tiddlerFile.filepath.indexOf($tw.boot.wikiTiddlersPath) !== 0
						};
					}
				});
			});
			for(var title in diskTiddlers) {
				// Refresh boot.files unconditionally -- system tiddlers (`$:/`)
				// still get their on-disk location tracked even though we skip
				// adding them to the wiki below. Without this, a system tiddler
				// file on disk + boot.files entry empty leaves TW core's syncer
				// to uniquify (`_1`) on the next save.
				if(diskFileInfo[title]) {
					$tw.boot.files[title] = diskFileInfo[title];
				}
				if(title.indexOf("$:/") === 0) {
					skippedSystem++;
					continue;
				}
				var tiddlerFields = diskTiddlers[title];
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
						ownedTitles[title] = true;
						addToWikiSilently(tiddlerFields);
						updated++;
					} else {
						unchanged++;
					}
				} else {
					ownedTitles[title] = true;
					addToWikiSilently(tiddlerFields);
					addedTexts[title] = tiddlerFields.text || "";
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
						var existing = $tw.wiki.getTiddler(t);
						deletedTexts[t] = (existing && existing.fields.text) || "";
						ownedTitles[t] = true;
						$tw.wiki.deleteTiddler(t);
						delete $tw.boot.files[t];
						deleted++;
					}
				}
			}
			// Pair add/delete titles with identical text into renames. Each
			// pair represents ONE physical disk file, so decrement the raw
			// add/delete counters: a rename is counted in `renamed` only,
			// not in both `added` and `deleted`.
			var renames = [];
			for(var delTitle in deletedTexts) {
				for(var addTitle in addedTexts) {
					if(deletedTexts[delTitle] === addedTexts[addTitle]) {
						renames.push({from: delTitle, to: addTitle});
						delete addedTexts[addTitle];
						delete deletedTexts[delTitle];
						added--;
						deleted--;
						break;
					}
				}
			}
			// Rebuild $:/config/OriginalTiddlerPaths from $tw.boot.files when
			// any wiki in the includeWikis tree sets retain-original-tiddler-path.
			// When none do, leave OTP alone: it may still hold edge-case entries
			// from tiddlywiki.files imports that the boot-time generator created
			// independently of this flag.
			var otpRefreshed = false, otpSkipped = false, otpCount = 0;
			if(effectiveRetain) {
				var otpOutput = {};
				for(var btitle in $tw.boot.files) {
					var bfi = $tw.boot.files[btitle];
					if(bfi && bfi.isEditableFile && bfi.filepath) {
						var rel = path.relative($tw.boot.wikiTiddlersPath, bfi.filepath);
						otpOutput[btitle] = (path.sep === "/") ? rel : rel.split(path.sep).join("/");
						otpCount++;
					}
				}
				if(otpCount > 0) {
					addToWikiSilently({title: "$:/config/OriginalTiddlerPaths", type: "application/json", text: JSON.stringify(otpOutput)});
				}
				otpRefreshed = true;
			} else {
				otpSkipped = true;
			}
			// Disk-side diff summary. Renames are counted separately from
			// added/deleted so the row sums match the disk-tiddler total.
			var diskTotal = added + updated + unchanged + skippedSystem + deleted + renames.length;
			messages.push("Source: " + resolvedWikiPath);
			messages.push("Disk tiddlers: " + diskTotal + " (added: " + added + ", updated: " + updated + ", unchanged: " + unchanged + ", deleted: " + deleted + ", renamed: " + renames.length + ")");
			if(skippedSystem > 0) {
				messages.push("System tiddlers on disk: " + skippedSystem + " (left untouched by design)");
			}
			if(renames.length > 0) {
				for(var ri = 0; ri < renames.length; ri++) {
					messages.push("  ~ " + renames[ri].from + " -> " + renames[ri].to + " (rename: text identical)");
				}
			}
			if(otpRefreshed) {
				messages.push("OTP: refreshed (" + otpCount + " entries)");
			} else if(otpSkipped) {
				messages.push("OTP: skipped (retain-original-tiddler-path off)");
			}
			// Report changes since last reload via the event-driven change log.
			var logTitles = Object.keys(changeLog);
			if(logTitles.length > 0) {
				var logAdded = 0, logUpdated = 0, logDeleted = 0;
				var logLines = [];
				logTitles.sort();
				for(var li = 0; li < logTitles.length; li++) {
					var lt = logTitles[li];
					var action = changeLog[lt];
					if(action === "added") { logAdded++; logLines.push("  + " + lt + " (added)"); }
					else if(action === "updated") { logUpdated++; logLines.push("  ~ " + lt + " (updated)"); }
					else if(action === "deleted") { logDeleted++; logLines.push("  - " + lt + " (deleted)"); }
				}
				messages.push("\nChange log: " + (logAdded + logUpdated + logDeleted) + " changes since last reload (" + logAdded + " added, " + logUpdated + " updated, " + logDeleted + " deleted)");
				messages.push(logLines.join("\n"));
				changeLog = {};
			} else if(changeLogActive) {
				messages.push("\nChange log: no changes since last reload");
			} else {
				messages.push("\nChange log: empty (first reload after server start; future calls will diff from here)");
			}
			startChangeLog();
			// Release listener-suppression once the change events from this
			// reload's own touches have fired. nextTick fires before
			// setTimeout(0), so the listener sees `reloadOwnedTitles` set and
			// skips those titles; the timer then clears the pointer (but
			// only if a newer reload has not already replaced it).
			setTimeout(function() {
				if(reloadOwnedTitles === ownedTitles) {
					reloadOwnedTitles = null;
				}
			}, 0);
		}

		// Reload shadow tiddlers from plugins
		if(scope === "shadows" || scope === "all") {
			if(dualScope) messages.push("\n=== scope: shadows ===");
			else messages.push("");  // separator when shadows-only
			try {
				var shadowsBefore = $tw.wiki.allShadowTitles().length;
				var results = $tw.wiki.readPluginInfo();
				var modified = results.modifiedPlugins || [];
				$tw.wiki.registerPluginTiddlers(null);
				$tw.wiki.unpackPluginTiddlers();
				var shadowsAfter = $tw.wiki.allShadowTitles().length;
				messages.push("Shadow tiddlers: " + shadowsBefore + " -> " + shadowsAfter + " (re-registered from in-memory plugin JSON; plugin folders NOT re-read)");
				if(modified.length > 0) {
					messages.push("Modified plugins: " + modified.join(", "));
				} else {
					messages.push("No plugin changes detected");
				}
			} catch(e) {
				messages.push("Shadow reload error: " + e.message);
			}
		}

		return shared.textResult(messages.join("\n"));
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
			return shared.textResult("Wiki folder saved to: " + outputPath);
		} catch(e) {
			return shared.errorResult("Failed to save wiki folder: " + e.message);
		}
	},

	"upload_file": function(args) {
		var denied = shared.checkWritable("upload_file");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "upload_file");
		if(titleErr) return titleErr;
		var checkPathAllowed = shared.getCheckPathAllowed();
		var filename = args.filename;
		if(filename.indexOf("/") !== -1 || filename.indexOf("\\") !== -1 || filename.indexOf("..") !== -1) {
			return shared.errorResult("Invalid filename: must not contain path separators or '..'");
		}
		var wikiPath = $tw.boot.wikiPath;
		if(!wikiPath) {
			return shared.errorResult("No wiki path available");
		}
		var filesDir = path.resolve(wikiPath, "files");
		if(args.subfolder) {
			var subfolder = args.subfolder;
			if(subfolder.indexOf("..") !== -1) {
				return shared.errorResult("Invalid subfolder: must not contain '..'");
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
			return shared.errorResult("Failed to write file: " + e.message);
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
		addToWikiSilently(tiddler.fields);
		try {
			var tiddlerFileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
				directory: $tw.boot.wikiTiddlersPath,
				wiki: $tw.wiki,
				fileInfo: {}
			});
			$tw.utils.saveTiddlerToFileSync(tiddler, tiddlerFileInfo);
			$tw.boot.files[title] = tiddlerFileInfo;
		} catch(e) {
			return shared.errorResult("File saved but failed to write .tid tiddler: " + e.message);
		}
		return shared.textResult("File uploaded: " + targetPath + "\nTiddler created: " + tiddlerFileInfo.filepath + " (_canonical_uri: " + canonicalUri + ")");
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
			return shared.textResult("Wiki built: " + outputFile);
		} catch(e) {
			return shared.errorResult("Failed to build wiki: " + e.message);
		}
	}
};
