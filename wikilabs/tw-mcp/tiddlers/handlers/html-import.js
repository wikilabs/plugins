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
		var folder = tag.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9\-]/g, "_");
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

// --- Initialize: load HTML, analyze, import to memory ---

function initialize(htmlFilePath, wiki) {
	var filePath = path.resolve(htmlFilePath);
	if(!fs.existsSync(filePath)) {
		console.error("html-import: File not found: " + filePath);
		return;
	}
	// Re-launch detection: if tiddlers/ has .tid files and FileSystemPaths exists, skip
	if($tw.boot.wikiTiddlersPath && fs.existsSync($tw.boot.wikiTiddlersPath)) {
		var existingFiles = fs.readdirSync($tw.boot.wikiTiddlersPath);
		var hasTidFiles = existingFiles.some(function(f) { return f.endsWith(".tid"); });
		if(hasTidFiles && wiki.tiddlerExists("$:/config/FileSystemPaths")) {
			console.error("html-import: Wiki already has extracted tiddlers and FileSystemPaths — skipping import");
			return;
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
				var libraryInfo = findPluginInLibrary(fields.title);
				if(libraryInfo) {
					libraryPlugins.push(libraryInfo);
					return;
				}
				customPlugins.push(fields.title);
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
	// Import all content + system tiddlers into memory
	var allTiddlers = contentTiddlers.concat(systemTiddlers);
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
	for(var ri = 0; ri < analysis.ruleDescriptions.length; ri++) {
		explanation.push("- " + analysis.ruleDescriptions[ri]);
		explanation.push("  `" + analysis.proposedRules[ri] + "`");
	}
	explanation.push("");
	explanation.push("## Tiddler counts");
	explanation.push("- Content tiddlers: " + contentTiddlers.length);
	explanation.push("- System tiddlers: " + systemTiddlers.length);
	explanation.push("- Library plugins (added to tiddlywiki.info): " + libraryPlugins.length);
	explanation.push("- Custom plugins: " + customPlugins.length);
	explanation.push("- Ignored (boot/core): " + ignoredCount);
	if(Object.keys(analysis.tagCounts).length > 0) {
		explanation.push("");
		explanation.push("## All tags");
		var allTags = Object.keys(analysis.tagCounts).sort(function(a, b) {
			return analysis.tagCounts[b] - analysis.tagCounts[a];
		});
		for(var ati = 0; ati < allTags.length; ati++) {
			explanation.push("- " + allTags[ati] + " (" + analysis.tagCounts[allTags[ati]] + ")");
		}
	}
	if(Object.keys(analysis.prefixCounts).length > 0) {
		explanation.push("");
		explanation.push("## All title prefixes");
		var allPrefixes = Object.keys(analysis.prefixCounts).sort(function(a, b) {
			return analysis.prefixCounts[b] - analysis.prefixCounts[a];
		});
		for(var api = 0; api < allPrefixes.length; api++) {
			explanation.push("- " + allPrefixes[api] + " (" + analysis.prefixCounts[allPrefixes[api]] + ")");
		}
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
	// Log summary to stderr
	console.error("");
	console.error("html-import: Loaded " + filePath);
	console.error("  " + contentTiddlers.length + " content + " + systemTiddlers.length + " system tiddlers imported to memory");
	console.error("  " + libraryPlugins.length + " library plugins added to tiddlywiki.info");
	console.error("  " + analysis.proposedRules.length + " FileSystemPaths rules proposed");
	console.error("");
	console.error("  Tiddlers are in memory only — nothing written to disk yet.");
	console.error("");
	console.error("  Next steps:");
	console.error("    1. Connect an MCP client to this wiki (see below)");
	console.error("    2. Ask the AI: \"Check the tiddlywiki wiki info\"");
	console.error("    3. The AI will show the proposed folder structure for your review");
	console.error("    4. After you approve, the AI extracts .tid files to disk");
	console.error("");
	console.error("  Or browse the wiki at the URL shown below.");
	console.error("");
	console.error("  === Connect Claude Code ===");
	console.error("  claude mcp add --transport stdio tiddlywiki -- tiddlywiki " + wikiPath + " --mcp rw label=claude");
	console.error("");
	console.error("  === Connect Gemini CLI ===");
	console.error("  gemini mcp add --scope project tiddlywiki-mcp tiddlywiki " + wikiPath + " --mcp rw label=gemini");
	console.error("");
}

// --- MCP tool handler: extract to disk ---

function extractHandler(args) {
	var writeCheck = shared.checkWritable("extract_html_wiki");
	if(writeCheck) return writeCheck;
	var analysisTiddler = $tw.wiki.getTiddler("$:/temp/mcp/html-import");
	if(!analysisTiddler) {
		return shared.errorResult("No pending HTML import found. Use --mcp file=xxx.html to load a single-file wiki first.");
	}
	if(analysisTiddler.fields.status === "extracted") {
		return shared.errorResult("Tiddlers have already been extracted to disk.");
	}
	// Determine FileSystemPaths
	var fileSystemPathsText = args.fileSystemPaths || analysisTiddler.fields["proposed-filesystem-paths"];
	if(!fileSystemPathsText) {
		return shared.errorResult("No FileSystemPaths rules available.");
	}
	// Create the FileSystemPaths config tiddler
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
	// Get tiddlers to extract — same exclusions as $:/core/save/all
	var allTitles = $tw.wiki.filterTiddlers(
		"[all[tiddlers]!has[plugin-type]]" +
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
	var filesWritten = 0;
	var errors = [];
	var directorySummary = {};
	for(var i = 0; i < allTitles.length; i++) {
		var title = allTitles[i];
		// Skip tiddlers that already have fileInfo (already on disk)
		if($tw.boot.files[title]) continue;
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
	return shared.textResult(lines.join("\n"));
}

module.exports = {
	initialize: initialize,
	"extract_html_wiki": extractHandler
};
