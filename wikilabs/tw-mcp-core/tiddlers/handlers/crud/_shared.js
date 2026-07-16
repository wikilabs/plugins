/*\
title: $:/core/modules/commands/inspect/handlers/crud/_shared.js
type: application/javascript
module-type: library

Per-group helpers shared by the crud/* handler files. Kept here (not in
top-level handlers/shared.js) because every consumer is a crud tool;
moving them up would pollute the cross-handler helper-bag.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// Mirrors TW filesystem's unsafe-field check: control chars or leading /
// trailing whitespace anywhere in a non-text field value, or `:` / `#` in any
// field name. When a tiddler has unsafe fields, the standard `.tid` header
// can't represent it; we fall back to JSON.
var UNSAFE_CONTROL_CHARS = /[\x00-\x1F]/;
var UNSAFE_FIELDNAME_CHARS = /[:#]/;

function hasUnsafeFields(tiddler) {
	var unsafe = false;
	$tw.utils.each(tiddler.getFieldStrings(), function(value, fieldName) {
		if(fieldName !== "text") {
			unsafe = unsafe || UNSAFE_CONTROL_CHARS.test(value);
			unsafe = unsafe || ($tw.utils.trim(value) !== value);
		}
		unsafe = unsafe || UNSAFE_FIELDNAME_CHARS.test(fieldName);
	});
	return unsafe;
}

// Title-first fields block for `.tid`-style output. Overrides TW's default
// alphabetical sort so the title is on line 1 — easier for LLMs (and humans)
// to identify each block at a glance. options.exclude is an array of field
// names to drop entirely; options.skipSet is a map of field names to skip
// (used by get_tiddlers' verbose filter).
function formatFieldsBlock(tiddler, options) {
	options = options || {};
	var exclude = options.exclude || [];
	var skipSet = options.skipSet || {};
	var strings = tiddler.getFieldStrings({exclude: exclude});
	var names = Object.keys(strings).sort();
	var lines = [];
	if(strings.title !== undefined) {
		lines.push("title: " + strings.title);
	}
	for(var i = 0; i < names.length; i++) {
		var n = names[i];
		if(n === "title") continue;
		if(skipSet[n]) continue;
		lines.push(n + ": " + strings[n]);
	}
	return lines.join("\n");
}

// Title-first plain JS object for JSON output. JS engines preserve insertion
// order for non-integer string keys, so the serialised JSON has title first.
// options.includeText controls whether the text field is included.
// options.skipSet is a map of field names to skip (used by get_tiddlers).
function extractFieldsObject(tiddler, options) {
	options = options || {};
	var includeText = !!options.includeText;
	var skipSet = options.skipSet || {};
	var fields = {};
	if(tiddler.fields.title !== undefined) {
		fields.title = tiddler.fields.title;
	}
	var names = Object.keys(tiddler.fields).sort();
	for(var i = 0; i < names.length; i++) {
		var field = names[i];
		if(field === "title") continue;
		if(field === "text" && !includeText) continue;
		if(skipSet[field]) continue;
		var value = tiddler.fields[field];
		if(Array.isArray(value)) {
			fields[field] = value.slice();
		} else if($tw.utils.isDate(value)) {
			fields[field] = $tw.utils.stringifyDate(value);
		} else {
			fields[field] = value;
		}
	}
	return fields;
}

// Format the dry-run preview block for replace_in_tiddlers. Consumes the
// `modified` accumulator built by the scan pass: an array of
// {title, perFieldChanges:[{field, lineDiffs:[{lineNum,before,after}]}]}.
function formatReplaceDryRun(modified, totalReplacements, truncated) {
	var hashline = require("$:/core/modules/commands/inspect/hashline.js");
	var blocks = [];
	for(var mi = 0; mi < modified.length; mi++) {
		var m = modified[mi];
		var lines = [m.title];
		for(var ci = 0; ci < m.perFieldChanges.length; ci++) {
			var ch = m.perFieldChanges[ci];
			for(var di = 0; di < ch.lineDiffs.length; di++) {
				var ld = ch.lineDiffs[di];
				var prefix = (ch.field === "text")
					? hashline.formatLineTag(ld.lineNum, ld.before)
					: ch.field + ":L" + ld.lineNum;
				lines.push("  - " + prefix + ": " + ld.before);
				lines.push("  + " + prefix + ": " + ld.after);
			}
		}
		blocks.push(lines.join("\n"));
	}
	var output = blocks.join("\n\n");
	output += "\n\nDRY RUN: " + totalReplacements + " replacement" + (totalReplacements !== 1 ? "s" : "") +
		" across " + modified.length + " tiddler" + (modified.length !== 1 ? "s" : "");
	if(truncated) {
		output += "\n(truncated; raise max_tiddlers or max_replacements_total to see more)";
	}
	output += "\nCall again with dry_run=false to apply.";
	return output;
}

// Apply the accumulated replacements to disk + wiki, build the apply-mode
// summary. Each modified entry becomes a new Tiddler with merged field
// values; persist failures land in the trailer.
function applyReplacements(modified, totalReplacements, truncated) {
	var persisted = 0;
	var failures = [];
	var modificationFields = $tw.wiki.getModificationFields();
	for(var mi = 0; mi < modified.length; mi++) {
		var m = modified[mi];
		var existing = $tw.wiki.getTiddler(m.title);
		if(!existing) {
			failures.push(m.title + ": tiddler vanished before persist");
			continue;
		}
		var newTiddler = new $tw.Tiddler(existing.fields, m.newFieldValues, modificationFields, {title: m.title});
		var result = shared.persistTiddler(newTiddler, m.title, "replaced");
		if(result && result.isError) {
			failures.push(m.title + ": " + result.content[0].text);
		} else {
			persisted++;
		}
	}
	var summary = persisted + " tiddler" + (persisted !== 1 ? "s" : "") + " modified, " +
		totalReplacements + " replacement" + (totalReplacements !== 1 ? "s" : "");
	if(failures.length > 0) {
		summary += "\n\nFailures (" + failures.length + "):\n  " + failures.join("\n  ");
	}
	if(truncated) {
		summary += "\n(truncated; re-run with narrower filter or higher caps for remaining matches)";
	}
	return summary;
}

exports.hasUnsafeFields = hasUnsafeFields;
exports.formatFieldsBlock = formatFieldsBlock;
exports.extractFieldsObject = extractFieldsObject;
exports.formatReplaceDryRun = formatReplaceDryRun;
exports.applyReplacements = applyReplacements;
