/*\
title: $:/core/modules/commands/inspect/handlers/query/get_wiki_info.js
type: application/javascript
module-type: library

MCP tool handler: get_wiki_info — wiki metadata (title, version, counts,
plugins, themes, settings) plus MCP role/PID and HTML-import status if
pending.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"get_wiki_info": function(args) {
		var plugins = $tw.wiki.filterTiddlers("[plugin-type[plugin]]");
		var themes = $tw.wiki.filterTiddlers("[plugin-type[theme]]");
		var languages = $tw.wiki.filterTiddlers("[plugin-type[language]]");
		var wikiTitle = $tw.wiki.renderText("text/plain", "text/vnd.tiddlywiki", $tw.wiki.getTiddlerText("$:/SiteTitle", "Untitled"));
		var wikiSubtitle = $tw.wiki.renderText("text/plain", "text/vnd.tiddlywiki", $tw.wiki.getTiddlerText("$:/SiteSubtitle", ""));
		var tiddlerCount = parseInt($tw.wiki.filterTiddlers("[!is[system]count[]]")[0]) || 0;
		var tagCount = parseInt($tw.wiki.filterTiddlers("[tags[]count[]]")[0]) || 0;
		var systemTiddlerCount = parseInt($tw.wiki.filterTiddlers("[is[system]count[]]")[0]) || 0;
		var shadowTiddlerCount = parseInt($tw.wiki.filterTiddlers("[all[shadows]count[]]")[0]) || 0;
		var overriddenShadowCount = parseInt($tw.wiki.filterTiddlers("[is[tiddler]is[shadow]count[]]")[0]) || 0;
		var settingsList = [
			{title: "$:/SiteTitle", prompt: "Title/Prompt"},
			{title: "$:/SiteSubtitle", prompt: "Subtitle/Prompt"},
			{title: "$:/status/UserName", prompt: "Username/Prompt"},
			{title: "$:/config/AnimationDuration", prompt: "AnimDuration/Prompt"},
			{title: "$:/DefaultTiddlers", prompt: "DefaultTiddlers/Prompt"},
			{title: "$:/language/DefaultNewTiddlerTitle", prompt: "NewTiddler/Title/Prompt"},
			{title: "$:/config/NewJournal/Title", prompt: "NewJournal/Title/Prompt"},
			{title: "$:/config/NewJournal/Text", prompt: "NewJournal/Text/Prompt"},
			{title: "$:/config/NewTiddler/Tags", prompt: "NewTiddler/Tags/Prompt"},
			{title: "$:/config/NewJournal/Tags", prompt: "NewJournal/Tags/Prompt"},
			{title: "$:/config/AutoFocus", prompt: "AutoFocus/Prompt"},
			{title: "$:/config/AutoFocusEdit", prompt: "AutoFocusEdit/Prompt"}
		];
		var lines = [];
		lines.push(wikiTitle + (wikiSubtitle ? " — " + wikiSubtitle : ""));
		lines.push("TiddlyWiki v" + $tw.version + (shared.isReadonly() ? " (readonly)" : ""));
		lines.push("");
		lines.push("Tiddlers: " + tiddlerCount + " | Tags: " + tagCount + " | System: " + systemTiddlerCount + " | Shadow: " + shadowTiddlerCount + " | Overridden: " + overriddenShadowCount);
		lines.push("Filesystem: " + (!!$tw.syncadaptor ? "yes" : "no") + (($tw.boot.wikiTiddlersPath) ? " (" + $tw.boot.wikiTiddlersPath + ")" : ""));
		if($tw.mcp) {
			lines.push("MCP: " + $tw.mcp.role + " v" + ($tw.mcp.version || "?") + " (PID " + $tw.mcp.pid + ")" + ($tw.mcp.label ? " @" + $tw.mcp.label : ""));
		}
		if($tw.httpServer) {
			var addr = $tw.httpServer.nodeServer && $tw.httpServer.nodeServer.address();
			lines.push("HTTP: " + (addr ? addr.address + ":" + addr.port : "not listening"));
		}
		if(plugins.length) {
			lines.push("Plugins:");
			$tw.utils.each(plugins, function(p) { lines.push("  " + p); });
		}
		if(themes.length) {
			lines.push("Themes:");
			$tw.utils.each(themes, function(t) { lines.push("  " + t); });
		}
		if(languages.length) {
			lines.push("Languages:");
			$tw.utils.each(languages, function(l) { lines.push("  " + l); });
		}
		// HTML import status
		var importTiddler = $tw.wiki.getTiddler("$:/temp/mcp/html-import");
		if(importTiddler) {
			var importStatus = importTiddler.fields.status;
			var sourceFile = importTiddler.fields["source-file"] || "unknown";
			var contentCount = importTiddler.fields["content-count"] || "?";
			if(importStatus === "pending") {
				lines.push("");
				lines.push("HTML Import: PENDING — " + contentCount + " tiddlers in memory from " + sourceFile);
				lines.push("  Read $:/temp/mcp/html-import for analysis and proposed FileSystemPaths");
				lines.push("  Use extract_html_wiki to write .tid files after review");
			} else if(importStatus === "extracted") {
				lines.push("");
				lines.push("HTML Import: extracted " + (importTiddler.fields["files-written"] || "?") + " files from " + sourceFile);
			}
		}
		lines.push("");
		lines.push("Settings:");
		$tw.utils.each(settingsList, function(entry) {
			var description = $tw.wiki.getTiddlerText("$:/language/ControlPanel/Basics/" + entry.prompt, "");
			var value = $tw.wiki.getTiddlerText(entry.title, "");
			if(value.indexOf("\n") !== -1) {
				lines.push("  " + entry.title + (description ? " (" + description + ")" : "") + ":");
				lines.push("    " + value.split("\n").join("\n    "));
			} else {
				lines.push("  " + entry.title + " = " + value + (description ? " (" + description + ")" : ""));
			}
		});
		return shared.textResult(lines.join("\n"));
	}
};
