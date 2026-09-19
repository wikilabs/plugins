/*\
title: $:/core/modules/commands/inspect/handlers/query/search_lines.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: search_lines — per-line search via the search-lines
filter operator; groups by title+field, splits into ranges by line-number
gaps, formats with hashline anchors + optional context (`- ` prefix) and
`--` separators between non-adjacent ranges.

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
		// Caps count MATCH lines; the range that reaches one is cut after its last allowed match.
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
		// The entries of a range up to and including its nth match.
		function cutAfterMatches(range, n) {
			var kept = [], seen = 0;
			for(var i = 0; i < range.length && seen < n; i++) {
				kept.push(range[i]);
				if(range[i].isMatch) seen++;
			}
			return kept;
		}
		var blocks = [];
		var totalMatches = 0;
		var truncated = false;
		var tiddlersCut = 0;
		for(var ti = 0; ti < titleOrder.length && !truncated; ti++) {
			var t = titleOrder[ti];
			var bucket = titleBuckets[t];
			var perTiddler = 0;
			var tiddlerCut = false;
			var titleLines = [];
			var titleHasContent = false;
			for(var fi = 0; fi < bucket.fieldOrder.length && !truncated && !tiddlerCut; fi++) {
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
				// The per-tiddler cap ends this tiddler only; the total cap ends the search.
				for(var ri = 0; ri < ranges.length; ri++) {
					var range = ranges[ri];
					var rangeMatches = 0;
					for(var rei = 0; rei < range.length; rei++) {
						if(range[rei].isMatch) rangeMatches++;
					}
					var tiddlerRoom = maxPerTiddler - perTiddler;
					var totalRoom = maxTotal - totalMatches;
					var room = Math.min(tiddlerRoom, totalRoom);
					if(rangeMatches > room) {
						range = cutAfterMatches(range, room);
						rangeMatches = room;
						if(totalRoom <= tiddlerRoom) {
							truncated = true;
						} else {
							tiddlerCut = true;
						}
					}
					if(rangeMatches > 0) {
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
					if(truncated || tiddlerCut) break;
				}
			}
			if(tiddlerCut) tiddlersCut++;
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
		if(tiddlersCut > 0) {
			output += "\n(truncated: " + tiddlersCut + " tiddler" + (tiddlersCut !== 1 ? "s" : "") +
				" cut at max_lines_per_tiddler=" + maxPerTiddler + "; raise it to see more)";
		}
		if(truncated) {
			output += "\n(truncated at " + maxTotal + " matches; narrow filter or raise max_lines_total)";
		}
		return shared.textResult(output);
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["search_lines"].definition = {
	"description": "Per-line text search. Output per match: title header, indented '<n>#<hash>: text' for text field (anchor → edit_tiddler `pos`) or 'field:L<n>: text' for other fields. With context>0, context lines prefixed '- ' (also anchored); '--' separates non-adjacent context blocks. Footer: 'N lines matched in M tiddlers'; '(truncated...)' suffix when caps hit. Empty: '(no matches)'. Caps count matches only (context is free). Defaults: fields=['text'], case-insensitive literal, context=0. Asymmetric via context_before / context_after. Filter form: [search-lines:fields:flags[pattern],[before],[after]] (range-style operands); `]`-bearing regex via `{Title}` or `<var>`.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"pattern": {
				"type": "string",
				"description": "Search pattern (literal by default; regex when regexp=true)"
			},
			"fields": {
				"type": "array",
				"items": {
					"type": "string"
				},
				"description": "Fields to scan; default ['text']. Multiline fields produce per-line matches; single-line fields at most one (lineNumber=1)."
			},
			"regexp": {
				"type": "boolean",
				"default": false
			},
			"case_sensitive": {
				"type": "boolean",
				"default": false
			},
			"words": {
				"type": "boolean",
				"default": false,
				"description": "Whole-word match (wraps pattern with \\b boundaries)"
			},
			"invert": {
				"type": "boolean",
				"default": false,
				"description": "Return lines that do NOT match (per-line invert, not per-tiddler)"
			},
			"filter": {
				"type": "string",
				"description": "TW filter scope; default '[all[tiddlers]!is[system]]' or '[all[tiddlers]]' when include_system"
			},
			"include_system": {
				"type": "boolean",
				"default": false
			},
			"max_lines_per_tiddler": {
				"type": "number",
				"default": 10
			},
			"max_lines_total": {
				"type": "number",
				"default": 200
			},
			"snippet_cap": {
				"type": "number",
				"default": 200,
				"description": "Per-line display cap; longer lines windowed around the match. Hash always derives from the full line."
			},
			"context": {
				"type": "number",
				"default": 0,
				"description": "Context lines before AND after each match (grep -C). Caps count matches only -- context lines are free."
			},
			"context_before": {
				"type": "number",
				"description": "Override context for BEFORE only (grep -B). Defaults to value of context."
			},
			"context_after": {
				"type": "number",
				"description": "Override context for AFTER only (grep -A). Defaults to value of context."
			}
		},
		"required": [
			"pattern"
		]
	}
};
