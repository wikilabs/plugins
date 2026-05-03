/*\
title: $:/core/modules/commands/inspect/handlers/html-import.js
type: application/javascript
module-type: library

HTML single-file wiki import handler for MCP server.
Loads tiddlers from an HTML file, analyzes structure, and provides
deferred extraction to disk with FileSystemPaths configuration.

\*/

"use strict";

var fs = require("fs"),
	path = require("path");

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

var TIDDLERS_TO_IGNORE = [
	"$:/boot/boot.css",
	"$:/boot/boot.js",
	"$:/boot/bootprefix.js",
	"$:/core",
	"$:/core-server",
	"$:/library/sjcl.js",
	"$:/temp/info-plugin"
];

var MIN_GROUP_COUNT = 3;

// Plugins/themes/languages loaded by the running wiki via tiddlywiki.info
// must NOT be treated as custom plugins from the imported HTML, and must
// NOT be written to disk by extract (they will load from the local plugin
// path again on the next boot).
function bootedPluginTitleSet() {
	var info = $tw.boot.wikiInfo || {};
	var set = {};
	(info.plugins || []).forEach(function(n) { set["$:/plugins/" + n] = true; });
	(info.themes || []).forEach(function(n) { set["$:/themes/" + n] = true; });
	(info.languages || []).forEach(function(n) { set["$:/languages/" + n] = true; });
	return set;
}

// Trim leading/trailing whitespace and trailing dots from each path component.
// Windows silently strips trailing whitespace/dots from path components when
// passed through the Win32 API, so files written with such names become
// unreachable through normal tools (they require the \\?\ prefix to access).
function sanitisePathComponents(filepath) {
	var parts = filepath.split(path.sep);
	return parts.map(function(part, idx) {
		if(part === "") return part;
		if(idx === 0 && /^[A-Za-z]:$/.test(part)) return part;
		var cleaned = part.replace(/^\s+/, "").replace(/[\s.]+$/, "");
		return cleaned || "_unnamed_";
	}).join(path.sep);
}

// --- Plugin detection (adapted from savewikifolder.js) ---

function findPluginInLibrary(title) {
	var parts = title.split("/"),
		pluginPath, type, name;
	if(parts[0] === "$:") {
		if(parts[1] === "languages" && parts.length === 3) {
			pluginPath = "languages" + path.sep + parts[2];
			type = parts[1];
			name = parts[2];
		} else if((parts[1] === "plugins" || parts[1] === "themes") && parts.length === 4) {
			pluginPath = parts[1] + path.sep + parts[2] + path.sep + parts[3];
			type = parts[1];
			name = parts[2] + "/" + parts[3];
		}
	}
	if(pluginPath && type && name) {
		pluginPath = path.resolve($tw.boot.bootPath, "..", pluginPath);
		if(fs.existsSync(pluginPath)) {
			return { pluginPath: pluginPath, type: type, name: name };
		}
	}
	return false;
}

// --- Heuristic analysis ---

function analyzeForFileSystemPaths(tiddlers) {
	var tagCounts = {};
	var prefixCounts = {};
	for(var i = 0; i < tiddlers.length; i++) {
		var t = tiddlers[i];
		// Count tags
		var tags = $tw.utils.parseStringArray(t.tags || "");
		for(var ti = 0; ti < tags.length; ti++) {
			var tag = tags[ti];
			if(tag.indexOf("$:/") !== 0) {
				tagCounts[tag] = (tagCounts[tag] || 0) + 1;
			}
		}
		// Count title prefixes (first segment before /)
		var slashIdx = t.title.indexOf("/");
		if(slashIdx > 0) {
			var prefix = t.title.substring(0, slashIdx + 1);
			prefixCounts[prefix] = (prefixCounts[prefix] || 0) + 1;
		}
	}
	// Build proposed rules
	var rules = [];
	var ruleDescriptions = [];
	// System tiddlers
	rules.push("[is[system]removeprefix[$:/]addprefix[_system/]]");
	ruleDescriptions.push("System tiddlers ($:/) → _system/ subfolder");
	// Tags with enough tiddlers
	var sortedTags = Object.keys(tagCounts)
		.filter(function(t) { return tagCounts[t] >= MIN_GROUP_COUNT; })
		.sort(function(a, b) { return tagCounts[b] - tagCounts[a]; });
	for(var si = 0; si < sortedTags.length; si++) {
		var tag = sortedTags[si];
		var folder = tag.toLowerCase()
			.replace(/\s+/g, "-")
			.replace(/[^a-z0-9\-]+/g, "_")
			.replace(/^[-_]+|[-_]+$/g, "");
		rules.push("[tag[" + tag + "]addprefix[" + folder + "/]]");
		ruleDescriptions.push(tagCounts[tag] + " tiddlers tagged '" + tag + "' → " + folder + "/ subfolder");
	}
	// Title prefixes with enough tiddlers
	var sortedPrefixes = Object.keys(prefixCounts)
		.filter(function(p) { return prefixCounts[p] >= MIN_GROUP_COUNT; })
		.sort(function(a, b) { return prefixCounts[b] - prefixCounts[a]; });
	for(var pi = 0; pi < sortedPrefixes.length; pi++) {
		var prefix = sortedPrefixes[pi];
		rules.push("[prefix[" + prefix + "]]");
		ruleDescriptions.push(prefixCounts[prefix] + " tiddlers with title prefix '" + prefix + "' → keep namespace as subfolder");
	}
	return {
		tagCounts: tagCounts,
		prefixCounts: prefixCounts,
		proposedRules: rules,
		ruleDescriptions: ruleDescriptions,
		proposedText: rules.join("\n")
	};
}

// --- Import handler: load HTML, analyze, stage in memory ---

function importHandler(args) {
	var writeCheck = shared.checkWritable("import_html_wiki");
	if(writeCheck) return writeCheck;
	if(!args.path) {
		return shared.errorResult("Missing required argument 'path' (path to single-file HTML wiki).");
	}
	var filePath = path.resolve(args.path);
	if(!fs.existsSync(filePath)) {
		return shared.errorResult("File not found: " + filePath);
	}
	var wiki = $tw.wiki;
	// Refuse if a pending import is already staged
	var existing = wiki.getTiddler("$:/temp/mcp/html-import");
	if(existing && existing.fields.status === "pending") {
		return shared.errorResult("An HTML import is already pending (source: " + existing.fields["source-file"] + "). Call extract_html_wiki to commit it, or delete $:/temp/mcp/html-import to discard.");
	}
	// Refuse if the wiki folder is already populated
	if($tw.boot.wikiTiddlersPath && fs.existsSync($tw.boot.wikiTiddlersPath)) {
		var existingFiles = fs.readdirSync($tw.boot.wikiTiddlersPath);
		var hasTidFiles = existingFiles.some(function(f) { return f.endsWith(".tid"); });
		if(hasTidFiles && wiki.tiddlerExists("$:/config/FileSystemPaths")) {
			return shared.errorResult("Wiki already has extracted tiddlers and FileSystemPaths. Run import against an empty wiki folder.");
		}
	}
	// Ensure tiddlers directory exists
	var wikiPath = $tw.boot.wikiPath;
	var tiddlersDir = path.resolve(wikiPath, "tiddlers");
	if(!fs.existsSync(tiddlersDir)) {
		$tw.utils.createDirectory(tiddlersDir);
	}
	if(!$tw.boot.wikiTiddlersPath) {
		$tw.boot.wikiTiddlersPath = tiddlersDir;
	}
	// Ensure tiddlywiki.info exists
	var infoPath = path.resolve(wikiPath, "tiddlywiki.info");
	var wikiInfo;
	if(fs.existsSync(infoPath)) {
		wikiInfo = $tw.utils.parseJSONSafe(fs.readFileSync(infoPath, "utf8"), {});
	} else {
		wikiInfo = {};
	}
	// Load tiddlers from HTML
	var loaded = $tw.loadTiddlersFromPath(filePath);
	// Classify tiddlers
	var bootedPlugins = bootedPluginTitleSet();
	var contentTiddlers = [];
	var systemTiddlers = [];
	var libraryPlugins = [];
	var customPlugins = [];
	var ignoredCount = 0;
	$tw.utils.each(loaded, function(tiddlerInfo) {
		$tw.utils.each(tiddlerInfo.tiddlers, function(fields) {
			if(!fields.title) return;
			// Skip boot/core tiddlers
			if(TIDDLERS_TO_IGNORE.indexOf(fields.title) !== -1) {
				ignoredCount++;
				return;
			}
			// Check if it's a plugin
			var type = fields.type,
				pluginType = fields["plugin-type"];
			if(type === "application/json" && pluginType) {
				// Plugin already loaded by the running tiddlywiki.info — skip; the
				// local plugin path will load it again on next boot.
				if(bootedPlugins[fields.title]) {
					ignoredCount++;
					return;
				}
				var libraryInfo = findPluginInLibrary(fields.title);
				if(libraryInfo) {
					libraryPlugins.push(libraryInfo);
					return;
				}
				customPlugins.push(fields);
				return;
			}
			// System vs content
			if(fields.title.indexOf("$:/") === 0) {
				systemTiddlers.push(fields);
			} else {
				contentTiddlers.push(fields);
			}
		});
	});
	// Update tiddlywiki.info with library plugins
	var infoChanged = false;
	for(var li = 0; li < libraryPlugins.length; li++) {
		var lp = libraryPlugins[li];
		if(!wikiInfo[lp.type]) {
			wikiInfo[lp.type] = [];
		}
		if(wikiInfo[lp.type].indexOf(lp.name) === -1) {
			wikiInfo[lp.type].push(lp.name);
			infoChanged = true;
		}
	}
	if(infoChanged || !fs.existsSync(infoPath)) {
		fs.writeFileSync(infoPath, JSON.stringify(wikiInfo, null, 4), "utf8");
	}
	// Import all content + system + custom-plugin tiddlers into memory
	var allTiddlers = contentTiddlers.concat(systemTiddlers).concat(customPlugins);
	for(var ai = 0; ai < allTiddlers.length; ai++) {
		wiki.importTiddler(new $tw.Tiddler(allTiddlers[ai]));
	}
	// Reset syncer baseline so imported tiddlers are not seen as dirty
	if($tw.syncer) {
		$tw.syncer.readTiddlerInfo();
	}
	// Analyze for FileSystemPaths
	var analysis = analyzeForFileSystemPaths(contentTiddlers);
	// Build explanation
	var explanation = [
		"## $:/config/FileSystemPaths",
		"",
		"This TiddlyWiki configuration controls how tiddlers are organized into subdirectories when saved as .tid files.",
		"Each line is a filter expression. Tiddlers are tested against each filter in order — the first match determines the subfolder.",
		"If no filter matches, the tiddler title is used as the filename in the tiddlers/ root.",
		"",
		"Full documentation: https://tiddlywiki.com/#Customising%20Tiddler%20File%20Naming",
		"",
		"## Proposed rules",
		""
	];
	var maxExamples = 10;
	var ruleCount = analysis.ruleDescriptions.length;
	var showCount = Math.min(ruleCount, maxExamples);
	for(var ri = 0; ri < showCount; ri++) {
		explanation.push("- " + analysis.ruleDescriptions[ri]);
		explanation.push("  `" + analysis.proposedRules[ri] + "`");
	}
	if(ruleCount > maxExamples) {
		explanation.push("- ... and " + (ruleCount - maxExamples) + " more rules");
		explanation.push("");
		explanation.push("See [[Import — Proposed Folder Structure]] for the full list. You can review it in the browser.");
	}
	explanation.push("");
	explanation.push("## Tiddler counts");
	explanation.push("- Content tiddlers: " + contentTiddlers.length);
	explanation.push("- System tiddlers: " + systemTiddlers.length);
	explanation.push("- Library plugins (added to tiddlywiki.info): " + libraryPlugins.length);
	explanation.push("- Custom plugins (kept as single .tid files): " + customPlugins.length);
	explanation.push("- Ignored (boot/core): " + ignoredCount);
	var totalTags = Object.keys(analysis.tagCounts).length;
	var totalPrefixes = Object.keys(analysis.prefixCounts).length;
	if(totalTags > 0 || totalPrefixes > 0) {
		explanation.push("");
		explanation.push("## Summary");
		explanation.push("- " + totalTags + " unique tags found (" + analysis.proposedRules.filter(function(r) { return r.indexOf("[tag[") !== -1; }).length + " with " + MIN_GROUP_COUNT + "+ tiddlers → proposed as folders)");
		explanation.push("- " + totalPrefixes + " title prefixes found (" + analysis.proposedRules.filter(function(r) { return r.indexOf("[prefix[") !== -1; }).length + " with " + MIN_GROUP_COUNT + "+ tiddlers → proposed as folders)");
	}
	// Store analysis tiddler
	var analysisTiddler = new $tw.Tiddler({
		title: "$:/temp/mcp/html-import",
		type: "text/vnd.tiddlywiki",
		text: explanation.join("\n"),
		status: "pending",
		"source-file": filePath,
		"content-count": String(contentTiddlers.length),
		"system-count": String(systemTiddlers.length),
		"library-plugin-count": String(libraryPlugins.length),
		"custom-plugin-count": String(customPlugins.length),
		"proposed-filesystem-paths": analysis.proposedText
	});
	wiki.addTiddler(analysisTiddler);
	// Create a visible tiddler with the full proposed rules (browsable in the wiki)
	var fullRulesLines = [
		"! Proposed Folder Structure",
		"",
		"These rules will be used by `$:/config/FileSystemPaths` to organize your tiddlers into subdirectories.",
		"Each tiddler is tested against the rules in order — the first match determines the folder.",
		"",
		"!! Rules (" + ruleCount + ")",
		""
	];
	for(var fri = 0; fri < analysis.ruleDescriptions.length; fri++) {
		fullRulesLines.push("# " + analysis.ruleDescriptions[fri]);
		fullRulesLines.push("#* `" + analysis.proposedRules[fri] + "`");
	}
	fullRulesLines.push("");
	fullRulesLines.push("!! What to do");
	fullRulesLines.push("");
	fullRulesLines.push("# Review the rules above");
	fullRulesLines.push("# Edit [[$:/config/FileSystemPaths]] in the browser if you want to change anything");
	fullRulesLines.push("# Tell the AI assistant to proceed with extraction");
	fullRulesLines.push("");
	fullRulesLines.push("[[Full documentation|https://tiddlywiki.com/#Customising%20Tiddler%20File%20Naming]]");
	var now = $tw.utils.stringifyDate(new Date());
	wiki.addTiddler(new $tw.Tiddler({
		title: "Import — Proposed Folder Structure",
		text: fullRulesLines.join("\n"),
		tags: "Import",
		modified: now,
		created: now
	}));
	// Create $:/config/FileSystemPaths so user can edit it in the browser before extraction
	wiki.addTiddler(new $tw.Tiddler({
		title: "$:/config/FileSystemPaths",
		text: analysis.proposedText,
		modified: now,
		created: now
	}));
	// Set as default tiddler so it opens on startup in the browser
	wiki.addTiddler(new $tw.Tiddler({
		title: "$:/DefaultTiddlers",
		text: "[[Import — Proposed Folder Structure]]"
	}));
	var summary = [
		"Loaded " + filePath,
		"  content: " + contentTiddlers.length + " · system: " + systemTiddlers.length + " · library plugins: " + libraryPlugins.length + " · custom plugins: " + customPlugins.length + " · ignored: " + ignoredCount,
		"  " + analysis.proposedRules.length + " FileSystemPaths rules proposed.",
		"",
		"Nothing written to disk yet. Next steps:",
		"  1. Read $:/temp/mcp/html-import for the analysis summary.",
		"  2. Show the user the proposed folder structure (also visible in the browser as 'Import — Proposed Folder Structure').",
		"  3. Let the user edit $:/config/FileSystemPaths in the browser if they want changes.",
		"  4. When approved, call extract_html_wiki() to commit the .tid files to disk.",
		"  5. Restart the server once after extraction so any new library plugins activate."
	].join("\n");
	return shared.textResult(summary);
}

// --- MCP tool handler: extract to disk ---

function extractHandler(args) {
	var writeCheck = shared.checkWritable("extract_html_wiki");
	if(writeCheck) return writeCheck;
	var analysisTiddler = $tw.wiki.getTiddler("$:/temp/mcp/html-import");
	if(!analysisTiddler) {
		return shared.errorResult("No pending HTML import found. Call import_html_wiki(path) first to stage a single-file wiki.");
	}
	if(analysisTiddler.fields.status === "extracted") {
		return shared.errorResult("Tiddlers have already been extracted to disk.");
	}
	// Determine FileSystemPaths: args override > user-edited tiddler > proposed
	var fileSystemPathsText = args.fileSystemPaths
		|| $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "")
		|| analysisTiddler.fields["proposed-filesystem-paths"];
	if(!fileSystemPathsText) {
		return shared.errorResult("No FileSystemPaths rules available.");
	}
	// Update the FileSystemPaths config tiddler (in case args override was used)
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/config/FileSystemPaths",
		text: fileSystemPathsText
	}));
	// Parse path filters
	var pathFilters = fileSystemPathsText.split("\n").filter(function(l) { return l.trim(); });
	var extFilters;
	if($tw.wiki.tiddlerExists("$:/config/FileSystemExtensions")) {
		extFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "").split("\n");
	}
	var tiddlersDir = $tw.boot.wikiTiddlersPath;
	if(!tiddlersDir) {
		return shared.errorResult("No wiki tiddlers path available.");
	}
	// Get tiddlers to extract — regular content + system + custom plugin tiddlers
	// (kept as single tiddlers, not exploded). Library plugins live in tiddlywiki.info
	// and are not in the regular tiddler space, so they're naturally excluded.
	var allTitles = $tw.wiki.filterTiddlers(
		"[all[tiddlers]!has[plugin-type]]" +
		" [all[tiddlers]plugin-type[plugin]]" +
		" -[prefix[$:/state/popup/]]" +
		" -[prefix[$:/temp/]]" +
		" -[prefix[$:/HistoryList]]" +
		" -[[$:/boot/boot.css]]" +
		" -[[$:/boot/boot.js]]" +
		" -[[$:/boot/bootprefix.js]]" +
		" -[[$:/library/sjcl.js]]" +
		" -[is[system]type[application/javascript]library[yes]]" +
		" -[status[pending]plugin-type[import]]"
	);
	var checkPathAllowed = shared.getCheckPathAllowed();
	var bootedPlugins = bootedPluginTitleSet();
	var filesWritten = 0;
	var errors = [];
	var directorySummary = {};
	for(var i = 0; i < allTitles.length; i++) {
		var title = allTitles[i];
		// Skip tiddlers that already have fileInfo (already on disk)
		if($tw.boot.files[title]) continue;
		// Skip plugins/themes/languages loaded by tiddlywiki.info — they live in
		// the local plugin path and must not be duplicated under tiddlers/.
		if(bootedPlugins[title]) continue;
		var tiddler = $tw.wiki.getTiddler(title);
		if(!tiddler) continue;
		try {
			var fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
				directory: tiddlersDir,
				pathFilters: pathFilters,
				extFilters: extFilters,
				wiki: $tw.wiki,
				fileInfo: {}
			});
			fileInfo.filepath = sanitisePathComponents(fileInfo.filepath);
			var pathDenied = checkPathAllowed(fileInfo.filepath);
			if(pathDenied) {
				errors.push(title + ": path denied");
				continue;
			}
			$tw.utils.saveTiddlerToFileSync(tiddler, fileInfo);
			$tw.boot.files[title] = fileInfo;
			filesWritten++;
			// Track directory for summary
			var relPath = path.relative(tiddlersDir, fileInfo.filepath);
			var dir = path.dirname(relPath);
			directorySummary[dir] = (directorySummary[dir] || 0) + 1;
		} catch(e) {
			errors.push(title + ": " + e.message);
		}
	}
	// Update analysis tiddler status
	$tw.wiki.addTiddler(new $tw.Tiddler(analysisTiddler, {
		status: "extracted",
		"files-written": String(filesWritten)
	}));
	// Build result
	var lines = ["Extracted " + filesWritten + " tiddlers to " + tiddlersDir];
	lines.push("");
	var dirs = Object.keys(directorySummary).sort();
	for(var di = 0; di < dirs.length; di++) {
		lines.push("  " + (dirs[di] === "." ? "(root)" : dirs[di] + "/") + " — " + directorySummary[dirs[di]] + " files");
	}
	if(errors.length > 0) {
		lines.push("");
		lines.push(errors.length + " errors:");
		for(var ei = 0; ei < errors.length; ei++) {
			lines.push("  " + errors[ei]);
		}
	}
	var result = lines.join("\n");
	console.error("\nhtml-import: " + result + "\n");
	return shared.textResult(result);
}

module.exports = {
	"import_html_wiki": importHandler,
	"extract_html_wiki": extractHandler
};
