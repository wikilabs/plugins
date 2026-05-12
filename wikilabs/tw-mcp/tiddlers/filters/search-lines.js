/*\
title: $:/core/modules/commands/inspect/filters/search-lines.js
type: application/javascript
module-type: filteroperator

Per-line search across tiddler fields. Mirrors the double-suffix shape
of core `search`: [search-lines:<fields>:<flags>[pattern]].

Default field list: ["text"]. Default flags: case-insensitive literal.
Supported flags: casesensitive, regexp, words (wrap with \b boundaries),
invert (return lines that do NOT match).

Multi-operand context (mirrors core `range`'s operands handling):
  [search-lines[pattern]]              -- no context
  [search-lines[pattern],[N]]          -- N lines before AND after each match
  [search-lines[pattern],[B],[A]]      -- B lines before, A lines after

Output: one string per emitted line in the form
  <title>:<field>:L<line>: <line text>   for match lines
  <title>:<field>:c<line>: <line text>   for context lines (when context > 0)

Multiline fields (default split on /\r?\n/) produce one entry per emitted
line; single-line fields at most one (lineNumber = 1). Array-valued
fields (eg `tags`, `list`) are serialised via $tw.utils.stringifyList
before matching, so the .tid on-disk form is what gets scanned
(multi-word entries wrapped in `[[...]]`). Other non-string field values
are skipped. With context, overlapping windows from adjacent matches are
merged so each line is emitted at most once.

\*/

"use strict";

exports["search-lines"] = function(source, operator, options) {
	var operand = operator.operand;
	if(!operand) return [];
	var fields = ["text"];
	var caseSensitive = false;
	var regexp = false;
	var words = false;
	var invert = false;
	if(operator.suffixes) {
		var suffixFields = operator.suffixes[0] || [];
		if(suffixFields.length > 0) {
			fields = suffixFields;
		}
		var flags = operator.suffixes[1] || [];
		caseSensitive = flags.indexOf("casesensitive") !== -1;
		regexp = flags.indexOf("regexp") !== -1;
		words = flags.indexOf("words") !== -1;
		invert = flags.indexOf("invert") !== -1;
	}
	// Multi-operand context: [pattern, before?, after?]. 1 operand = no context;
	// 2 = symmetric N; 3 = asymmetric.
	var parts = operator.operands || [operand];
	var contextBefore = 0;
	var contextAfter = 0;
	if(parts.length === 2) {
		contextBefore = contextAfter = parseInt(parts[1], 10) || 0;
	} else if(parts.length >= 3) {
		contextBefore = parseInt(parts[1], 10) || 0;
		contextAfter = parseInt(parts[2], 10) || 0;
	}
	if(contextBefore < 0) contextBefore = 0;
	if(contextAfter < 0) contextAfter = 0;
	var hasContext = (contextBefore > 0 || contextAfter > 0);
	var matcher;
	try {
		var src = regexp ? operand : operand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if(words) {
			// Non-capturing group needed so alternations inside the operand
			// (e.g. `foo|bar`) word-bound on both sides, not just the outer ends.
			src = "\\b(?:" + src + ")\\b";
		}
		matcher = new RegExp(src, caseSensitive ? "" : "i");
	} catch(e) {
		return [];
	}
	var results = [];
	source(function(tiddler, title) {
		if(!tiddler) return;
		for(var fi = 0; fi < fields.length; fi++) {
			var field = fields[fi];
			var value = tiddler.fields[field];
			if(Array.isArray(value)) {
				// Match against the .tid on-disk serialisation so callers
				// see `[[Some tag]] Other` rather than the runtime array.
				value = $tw.utils.stringifyList(value);
			}
			if(typeof value !== "string") continue;
			var lines = value.split(/\r?\n/);
			// Pass 1: identify match lines (1-indexed).
			var matchSet = Object.create(null);
			var matchLines = [];
			for(var li = 0; li < lines.length; li++) {
				var matched = matcher.test(lines[li]);
				if(invert ? !matched : matched) {
					matchSet[li + 1] = true;
					matchLines.push(li + 1);
				}
			}
			if(matchLines.length === 0) continue;
			if(!hasContext) {
				for(var mi = 0; mi < matchLines.length; mi++) {
					var ln = matchLines[mi];
					results.push(title + ":" + field + ":L" + ln + ": " + lines[ln - 1]);
				}
				continue;
			}
			// Pass 2: merged context ranges. Adjacent windows (within 1 line) merge.
			var ranges = [];
			for(var mi = 0; mi < matchLines.length; mi++) {
				var lo = Math.max(1, matchLines[mi] - contextBefore);
				var hi = Math.min(lines.length, matchLines[mi] + contextAfter);
				var last = ranges.length > 0 ? ranges[ranges.length - 1] : null;
				if(last && lo <= last.hi + 1) {
					last.hi = Math.max(last.hi, hi);
				} else {
					ranges.push({lo: lo, hi: hi});
				}
			}
			// Pass 3: emit each line in each range exactly once; marker depends on matchSet.
			for(var ri = 0; ri < ranges.length; ri++) {
				var r = ranges[ri];
				for(var ln = r.lo; ln <= r.hi; ln++) {
					var marker = matchSet[ln] ? "L" : "c";
					results.push(title + ":" + field + ":" + marker + ln + ": " + lines[ln - 1]);
				}
			}
		}
	});
	return results;
};
