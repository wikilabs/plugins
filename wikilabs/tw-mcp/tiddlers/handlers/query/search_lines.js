/*\
title: $:/core/modules/commands/inspect/handlers/query/search_lines.js
type: application/javascript
module-type: library

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
