/*\
title: $:/core/modules/commands/inspect/handlers/crud/get_tiddlers.js
type: application/javascript
module-type: library

MCP tool handler: get_tiddlers — batch read by titles array. Text output
is CompoundTiddlers (blocks separated by `\n+\n`); JSON output is
{tiddlers, missing?, truncated?}.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var crudShared = require("$:/core/modules/commands/inspect/handlers/crud/_shared.js");

module.exports = {
	"get_tiddlers": function(args) {
		if(!args.titles || !Array.isArray(args.titles) || args.titles.length === 0) {
			return shared.errorResult("get_tiddlers: 'titles' must be a non-empty array");
		}
		// detailed defaults to TRUE: the batch use case is reading multiple
		// tiddlers' content; metadata-only batch is rare.
		var detailed = args.detailed !== false;
		// verbose=false (default) skips bookkeeping fields. Set true to include them.
		var verbose = !!args.verbose;
		var format = args.format || "hashline";
		var maxTiddlers = args.max_tiddlers || 50;
		var maxBytes = args.max_bytes || 50000;
		var SKIP_FIELDS = {created: 1, modified: 1, creator: 1, modifier: 1, revision: 1};
		var skipSet = verbose ? {} : SKIP_FIELDS;
		function renderText(tiddler, includeText) {
			var unsafe = crudShared.hasUnsafeFields(tiddler);
			var out;
			if(unsafe && format !== "tid") {
				out = shared.jsonStringify(crudShared.extractFieldsObject(tiddler, {skipSet: skipSet}));
			} else {
				out = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"], skipSet: skipSet});
			}
			if(includeText && tiddler.fields.text !== undefined) {
				if(format === "hashline") {
					var hashlineLib = require("$:/core/modules/commands/inspect/hashline.js");
					out += "\n\n" + hashlineLib.formatHashLines(tiddler.fields.text);
				} else {
					out += "\n\n" + tiddler.fields.text;
				}
			}
			return out;
		}
		var entries = [];
		var missing = [];
		var totalBytes = 0;
		var truncated = 0;
		var inputTitles = args.titles;
		for(var i = 0; i < inputTitles.length; i++) {
			var title = inputTitles[i];
			if(entries.length >= maxTiddlers) {
				truncated = inputTitles.length - i;
				break;
			}
			var tiddler = $tw.wiki.getTiddler(title);
			if(!tiddler) {
				missing.push(title);
				continue;
			}
			var isPlugin = shared.isPluginTiddler(tiddler);
			// Plugins: fields-only (no shadow tree, no bundle text) regardless of detailed.
			var realDetailed = detailed && !isPlugin;
			var entry;
			var entryBytes;
			if(format === "json") {
				entry = { fields: crudShared.extractFieldsObject(tiddler, {includeText: realDetailed, skipSet: skipSet}) };
				entryBytes = JSON.stringify(entry.fields).length + 8;
			} else {
				entry = { content: renderText(tiddler, realDetailed) };
				entryBytes = entry.content.length + 4;
			}
			if(entries.length > 0 && totalBytes + entryBytes > maxBytes) {
				truncated = inputTitles.length - i;
				break;
			}
			totalBytes += entryBytes;
			entries.push(entry);
		}
		if(format === "json") {
			var result = { tiddlers: entries.map(function(e) { return e.fields; }) };
			if(missing.length > 0) result.missing = missing;
			if(truncated > 0) result.truncated = truncated;
			return shared.textResult(shared.jsonStringify(result));
		}
		// CompoundTiddlers (text/vnd.tiddlywiki-multiple): blocks separated by `\n+\n`.
		// Missing titles surface in a trailing `Missing: ...` line so the LLM can
		// retry/correct without misreading a stub block as real content.
		var blocks = entries.map(function(e) { return e.content.replace(/\n+$/, ""); });
		var output = blocks.join("\n+\n");
		var trailers = [];
		if(missing.length > 0) {
			trailers.push("Missing: " + missing.join(", "));
		}
		if(truncated > 0) {
			trailers.push("(" + truncated + " entries truncated; raise max_tiddlers or max_bytes)");
		}
		if(trailers.length > 0) {
			output += (output ? "\n\n" : "") + trailers.join("\n");
		}
		return shared.textResult(output);
	}
};
