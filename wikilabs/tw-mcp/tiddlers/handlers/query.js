/*\
title: $:/core/modules/commands/inspect/handlers/query.js
type: application/javascript
module-type: library

MCP tool handlers for query operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// `probe` is a non-global RegExp built once by the caller (the global flag
// of the search matcher would carry lastIndex across calls and skip matches).
function windowSnippet(line, probe, cap) {
	if(line.length <= cap) return line;
	var m = probe.exec(line);
	if(!m) return line.slice(0, cap) + "...";
	var matchStart = m.index;
	var matchLen = m[0].length;
	var remaining = cap - matchLen;
	if(remaining < 20) {
		return "..." + line.slice(matchStart, matchStart + cap - 6) + "...";
	}
	var half = Math.floor(remaining / 2);
	var sliceStart = Math.max(0, matchStart - half);
	var sliceEnd = Math.min(line.length, sliceStart + cap);
	if(sliceEnd === line.length) {
		sliceStart = Math.max(0, line.length - cap);
	}
	var snippet = line.slice(sliceStart, sliceEnd);
	if(sliceStart > 0) snippet = "..." + snippet;
	if(sliceEnd < line.length) snippet = snippet + "...";
	return snippet;
}

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
	},

	"list_tiddlers": function(args) {
		var filter;
		if(args.plugin) {
			filter = "[[" + shared.sanitiseFilterOperand(args.plugin) + "]plugintiddlers[]sort[title]]";
		} else if(args.overwrittenShadows) {
			filter = "[is[tiddler]is[shadow]sort[title]]";
		} else if(args.tag) {
			filter = "[tag[" + shared.sanitiseFilterOperand(args.tag) + "]]";
		} else if(args.includeSystem) {
			filter = "[all[tiddlers]sort[title]]";
		} else {
			filter = "[all[tiddlers]!is[system]sort[title]]";
		}
		var results = $tw.wiki.filterTiddlers(filter);
		var total = results.length;
		if(total > 100 && !args.limit) {
			return shared.textResult(shared.formatTitleTree(results, "tiddlers", total));
		}
		var limit = args.limit || 100;
		var truncated = results.length > limit;
		if(truncated) {
			results = results.slice(0, limit);
		}
		var output = shared.formatTitleTree(results);
		if(truncated) {
			output += "\n\n(" + total + " total, showing first " + limit + ")";
		}
		return shared.textResult(output);
	},

	"search_lines": function(args) {
		if(!args.pattern) {
			return shared.errorResult("search_lines: missing required argument 'pattern'");
		}
		if(args.pattern.length > shared.MAX_FILTER_LENGTH) {
			return shared.errorResult("Pattern too long (max " + shared.MAX_FILTER_LENGTH + ")");
		}
		var fields = (args.fields && args.fields.length > 0) ? args.fields : ["text"];
		var caseSensitive = !!args.case_sensitive;
		var regexp = !!args.regexp;
		var words = !!args.words;
		var invert = !!args.invert;
		var contextN = Math.max(0, args.context | 0);
		var contextBefore = (args.context_before !== undefined) ? Math.max(0, args.context_before | 0) : contextN;
		var contextAfter = (args.context_after !== undefined) ? Math.max(0, args.context_after | 0) : contextN;
		var hasContext = (contextBefore > 0 || contextAfter > 0);
		var compiled = shared.compileSearchRegex({
			pattern: args.pattern,
			regexp: regexp,
			words: words,
			caseSensitive: caseSensitive
		});
		if(compiled.error) {
			return shared.errorResult("Invalid regex: " + compiled.error);
		}
		var matcher = compiled.matcher;
		// Non-global clone for snippet probing (windowSnippet's exec must not
		// advance the shared matcher's lastIndex). Built once instead of per
		// match line.
		var snippetProbe = new RegExp(matcher.source, matcher.flags.replace("g", ""));
		var scoped = shared.scopedTitles(args);
		if(scoped.errorResult) return scoped.errorResult;
		var sourceTitles = scoped.titles;
		var source = function(callback) {
			sourceTitles.forEach(function(title) {
				callback($tw.wiki.getTiddler(title), title);
			});
		};
		// Invoke the filter operator directly so the operand can contain any character
		// (calling via filterTiddlers would require escaping `]` etc).
		var searchLinesOp = require("$:/core/modules/commands/inspect/filters/search-lines.js");
		var flagList = [];
		if(caseSensitive) flagList.push("casesensitive");
		if(regexp) flagList.push("regexp");
		if(words) flagList.push("words");
		if(invert) flagList.push("invert");
		var operands = [args.pattern];
		if(hasContext) {
			operands.push(String(contextBefore));
			operands.push(String(contextAfter));
		}
		var operator = {
			operand: args.pattern,
			operands: operands,
			suffixes: [fields, flagList]
		};
		var rawResults = searchLinesOp["search-lines"](source, operator, {wiki: $tw.wiki});
		if(rawResults.length === 0) {
			return shared.textResult("(no matches)");
		}
		var hashline = require("$:/core/modules/commands/inspect/hashline.js");
		// Operator emits 'L<n>' for match lines and 'c<n>' for context lines.
		var lineRegex = /^(.*?):([^:]+):([Lc])(\d+):\s?([\s\S]*)$/;
		var maxPerTiddler = args.max_lines_per_tiddler || 10;
		var maxTotal = args.max_lines_total || 200;
		var snippetCap = args.snippet_cap || 200;
		// Pass 1: parse the flat operator output into typed entries.
		var entries = [];
		for(var i = 0; i < rawResults.length; i++) {
			var m = lineRegex.exec(rawResults[i]);
			if(!m) continue;
			entries.push({
				title: m[1],
				field: m[2],
				isMatch: m[3] === "L",
				line: parseInt(m[4], 10),
				text: m[5]
			});
		}
		// Pass 2: group by title (preserve first-seen order); within title, group by field.
		var titleOrder = [];
		var titleBuckets = Object.create(null);
		for(var i = 0; i < entries.length; i++) {
			var e = entries[i];
			if(!titleBuckets[e.title]) {
				titleBuckets[e.title] = { fieldOrder: [], fieldEntries: Object.create(null) };
				titleOrder.push(e.title);
			}
			var bucket = titleBuckets[e.title];
			if(!bucket.fieldEntries[e.field]) {
				bucket.fieldOrder.push(e.field);
				bucket.fieldEntries[e.field] = [];
			}
			bucket.fieldEntries[e.field].push(e);
		}
		// Pass 3: format. Detect range boundaries by line-number gaps within (title, field).
		// Apply caps on MATCH count: an entire range is accepted or dropped atomically.
		// Display: existing match form for matches, '- ' prefix for context, '  --'
		// separator between non-adjacent ranges (only when context is requested -- without
		// context every match looks like its own 1-line range, and separators would noise).
		function formatLine(field, lineNum, lineText, isMatch) {
			var displayText = windowSnippet(lineText, snippetProbe, snippetCap);
			var prefix = (field === "text")
				? hashline.formatLineTag(lineNum, lineText)
				: field + ":L" + lineNum;
			return (isMatch ? "  " : "  - ") + prefix + ": " + displayText;
		}
		var blocks = [];
		var totalMatches = 0;
		var truncated = false;
		for(var ti = 0; ti < titleOrder.length; ti++) {
			if(truncated) break;
			var t = titleOrder[ti];
			var bucket = titleBuckets[t];
			var perTiddler = 0;
			var titleLines = [];
			var titleHasContent = false;
			for(var fi = 0; fi < bucket.fieldOrder.length && !truncated; fi++) {
				var fName = bucket.fieldOrder[fi];
				var fEntries = bucket.fieldEntries[fName];
				// Split into ranges by line-number gap.
				var ranges = [];
				var current = null;
				for(var ei = 0; ei < fEntries.length; ei++) {
					var entry = fEntries[ei];
					if(current === null || entry.line !== current[current.length - 1].line + 1) {
						if(current) ranges.push(current);
						current = [];
					}
					current.push(entry);
				}
				if(current) ranges.push(current);
				// Accept whole ranges until a cap would be exceeded.
				for(var ri = 0; ri < ranges.length; ri++) {
					var range = ranges[ri];
					var rangeMatches = 0;
					for(var rei = 0; rei < range.length; rei++) {
						if(range[rei].isMatch) rangeMatches++;
					}
					if(perTiddler + rangeMatches > maxPerTiddler) {
						truncated = true;
						break;
					}
					if(totalMatches + rangeMatches > maxTotal) {
						truncated = true;
						break;
					}
					if(titleHasContent && hasContext) {
						titleLines.push("  --");
					}
					for(var rei = 0; rei < range.length; rei++) {
						var re = range[rei];
						titleLines.push(formatLine(re.field, re.line, re.text, re.isMatch));
					}
					perTiddler += rangeMatches;
					totalMatches += rangeMatches;
					titleHasContent = true;
				}
			}
			if(titleLines.length > 0) {
				blocks.push(t + "\n" + titleLines.join("\n"));
			}
		}
		if(blocks.length === 0) {
			return shared.textResult("(no matches)");
		}
		var output = blocks.join("\n\n");
		output += "\n\n" + totalMatches + " line" + (totalMatches !== 1 ? "s" : "") +
			" matched in " + blocks.length + " tiddler" + (blocks.length !== 1 ? "s" : "");
		if(truncated) {
			output += "\n(truncated at " + maxTotal + " matches; narrow filter or raise max_lines_total)";
		}
		return shared.textResult(output);
	}
};
