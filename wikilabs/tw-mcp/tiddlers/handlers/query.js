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
			return { isError: true, content: [{ type: "text", text: "Filter too long (" + args.filter.length + " chars). Maximum: " + shared.MAX_FILTER_LENGTH }] };
		}
		try {
			var results = $tw.wiki.filterTiddlers(args.filter);
			var ns = shared.buildTree(results);
			var header = ns.prefix ? ns.prefix + " ... " + results.length + " results\n" : "";
			return { content: [{ type: "text", text: header + ns.tree }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Filter error: " + e.message }] };
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
		var basicsLinks = $tw.wiki.filterTiddlers("[[$:/core/ui/ControlPanel/Basics]links[]]");
		var promptMap = {
			"$:/SiteTitle": "Title/Prompt",
			"$:/SiteSubtitle": "Subtitle/Prompt",
			"$:/status/UserName": "Username/Prompt",
			"$:/config/AnimationDuration": "AnimDuration/Prompt",
			"$:/DefaultTiddlers": "DefaultTiddlers/Prompt",
			"$:/language/DefaultNewTiddlerTitle": "NewTiddler/Title/Prompt",
			"$:/config/NewJournal/Title": "NewJournal/Title/Prompt",
			"$:/config/NewJournal/Text": "NewJournal/Text/Prompt",
			"$:/config/NewTiddler/Tags": "NewTiddler/Tags/Prompt",
			"$:/config/NewJournal/Tags": "NewJournal/Tags/Prompt",
			"$:/config/AutoFocus": "AutoFocus/Prompt",
			"$:/config/AutoFocusEdit": "AutoFocusEdit/Prompt"
		};
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
		$tw.utils.each(basicsLinks, function(title) {
			var promptKey = promptMap[title];
			var description = promptKey ? $tw.wiki.getTiddlerText("$:/language/ControlPanel/Basics/" + promptKey, "") : "";
			var value = $tw.wiki.getTiddlerText(title, "");
			if(value.indexOf("\n") !== -1) {
				lines.push("  " + title + (description ? " (" + description + ")" : "") + ":");
				lines.push("    " + value.split("\n").join("\n    "));
			} else {
				lines.push("  " + title + " = " + value + (description ? " (" + description + ")" : ""));
			}
		});
		return { content: [{ type: "text", text: lines.join("\n") }] };
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
			return { content: [{ type: "text", text: header + ns.tree }] };
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
		return { content: [{ type: "text", text: output }] };
	}
};
