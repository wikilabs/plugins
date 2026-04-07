/*\
title: $:/core/modules/commands/inspect/handlers/query.js
type: application/javascript
module-type: library

MCP tool handlers for query operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"run_filter": function(args) {
		if(args.filter && args.filter.length > shared.MAX_FILTER_LENGTH) {
			return shared.errorResult("Filter too long (" + args.filter.length + " chars). Maximum: " + shared.MAX_FILTER_LENGTH);
		}
		try {
			var results = $tw.wiki.filterTiddlers(args.filter);
			var maxResults = 500;
			var total = results.length;
			var output;
			if(total === 0) {
				output = "(no results)";
			} else if(total <= maxResults) {
				output = results.join("\n");
			} else {
				output = results.slice(0, maxResults).join("\n") + "\n\n(" + total + " total, showing first " + maxResults + ")";
			}
			return shared.textResult(output);
		} catch(e) {
			return shared.errorResult("Filter error: " + e.message);
		}
	},

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
			lines.push("MCP: " + $tw.mcp.role + " (PID " + $tw.mcp.pid + ")" + ($tw.mcp.label ? " @" + $tw.mcp.label : ""));
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
	},

	"list_tiddlers": function(args) {
		var filter;
		if(args.plugin) {
			var safePlugin = args.plugin.replace(/[\[\]{}<>]/g, "");
			filter = "[[" + safePlugin + "]plugintiddlers[]sort[title]]";
		} else if(args.overwrittenShadows) {
			filter = "[is[tiddler]is[shadow]sort[title]]";
		} else if(args.tag) {
			var safeTag = args.tag.replace(/[\[\]{}<>\/]/g, "");
			filter = "[tag[" + safeTag + "]]";
		} else if(args.includeSystem) {
			filter = "[all[tiddlers]sort[title]]";
		} else {
			filter = "[all[tiddlers]!is[system]sort[title]]";
		}
		var results = $tw.wiki.filterTiddlers(filter);
		var total = results.length;
		if(total > 100 && !args.limit) {
			var ns = shared.buildTree(results);
			var header = ns.prefix ? ns.prefix + " ... " + total + " tiddlers\n" : "";
			return shared.textResult(header + ns.tree);
		}
		var limit = args.limit || 100;
		var truncated = results.length > limit;
		if(truncated) {
			results = results.slice(0, limit);
		}
		var ns = shared.buildTree(results);
		var header = ns.prefix ? ns.prefix + " ... " + results.length + " tiddlers\n" : "";
		var output = header + ns.tree;
		if(truncated) {
			output += "\n\n(" + total + " total, showing first " + limit + ")";
		}
		return shared.textResult(output);
	}
};
