/*\
title: $:/plugins/wikilabs/uuid7/startup.js
type: application/javascript
module-type: startup

UUID v7 startup module
=======================
Hooks into the TiddlyWiki runtime to make c7 the source of truth for
tiddler creation time.

Patches:
1. Override the "created" field module so its stringify always derives
   the date from c7 when present (c7 = source of truth).
2. Hook getCreationFields() to assign a c7 field (does NOT touch "created").
3. Hook th-saving-tiddler to strip "created" when the original tiddler
   had no created (respects user's choice to omit created).

\*/

"use strict";

exports.name = "uuid7-startup";
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	var creator = require("$:/plugins/wikilabs/uuid7/creator.js");
	var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");

	// --- 1. Override the "created" field module ---
	// When c7 is present, stringify always derives from it, ensuring c7
	// is the source of truth even if "created" was set independently.
	$tw.Tiddler.fieldModules["created"] = {
		name: "created",
		parse: $tw.utils.parseDate,
		stringify: function(value) {
			if(this.fields && this.fields.c7) {
				var ms = creator.extractTimestampMs(this.fields.c7);
				if(ms !== null) {
					return $tw.utils.stringifyDate(new Date(ms));
				}
			}
			return $tw.utils.stringifyDate(value);
		}
	};

	// --- 2. Hook getCreationFields ---
	// Only adds c7. Does NOT override "created" — the original function
	// sets created: new Date() as normal. We don't force "created" because
	// getCreationFields() is also called when saving existing drafts
	// (navigator.js:327), and we must not inject "created" into tiddlers
	// where the user intentionally removed it.
	var originalGetCreationFields = $tw.wiki.getCreationFields.bind($tw.wiki);
	$tw.wiki.getCreationFields = function() {
		var fields = originalGetCreationFields();
		var bytes = creator.generateUUIDv7Bytes();
		fields.c7 = creator.toUUIDString(bytes);
		fields.c32 = c32lib.format(c32lib.encode(bytes));
		var cfg = $tw.wiki.getTiddler("$:/config/wikilabs/uuid7");
		if(cfg && cfg.fields["no-created"] === "yes") {
			delete fields.created;
		}
		return fields;
	};

	// --- 3. Hook th-saving-tiddler ---
	// When saving a draft, core's getCreationFields() injects "created"
	// into every tiddler. If the original tiddler had no created,
	// strip the injected created to respect the user's choice.
	$tw.hooks.addHook("th-saving-tiddler",function(newTiddler,draftTiddler) {
		var cfg = $tw.wiki.getTiddler("$:/config/wikilabs/uuid7");
		var noCreated = cfg && cfg.fields["no-created"] === "yes";
		if(noCreated) {
			return new $tw.Tiddler(newTiddler, {created: undefined});
		}
		var draftOf = draftTiddler && draftTiddler.fields["draft.of"];
		if(draftOf) {
			var originalTiddler = $tw.wiki.getTiddler(draftOf);
			if(originalTiddler && !originalTiddler.fields.created) {
				return new $tw.Tiddler(newTiddler, {created: undefined});
			}
		}
		return newTiddler;
	});

	// --- 4. Hook th-importing-tiddler ---
	// Add c7 to imported tiddlers that match the backfill criteria.
	// Uses setTimeout to batch-flush the log after all imports complete.
	var LOG_TITLE = "_log/backfill-c7";
	var importLogLines = [];
	var importLogTimer = null;

	function flushImportLog() {
		if(importLogLines.length === 0) { return; }
		var now = new Date();
		var dateStr = now.toISOString().slice(0, 10)
			+ " " + String(now.getHours()).padStart(2, "0")
			+ ":" + String(now.getMinutes()).padStart(2, "0")
			+ ":" + String(now.getSeconds()).padStart(2, "0");
		var newSection = "!! Import — " + dateStr + "\n\n"
			+ "Tiddlers imported with c7: " + importLogLines.length + "\n\n"
			+ "|!Title|!Source|!Created|!Generated c7|\n"
			+ importLogLines.join("\n");
		var existingLog = $tw.wiki.getTiddler(LOG_TITLE);
		var text;
		if(existingLog && existingLog.fields.text) {
			text = newSection + "\n\n---\n\n" + existingLog.fields.text;
		} else {
			text = newSection;
		}
		$tw.wiki.addTiddler(new $tw.Tiddler(
			$tw.wiki.getCreationFields(),
			{
				title: LOG_TITLE,
				"backfill-mode": "import",
				text: text
			},
			$tw.wiki.getModificationFields()
		));
		importLogLines = [];
	}

	$tw.hooks.addHook("th-importing-tiddler",function(tiddler) {
		if(tiddler.fields.c7) {
			return tiddler;
		}
		var title = tiddler.fields.title;
		var isSystem = (title.charAt(0) === "$" && title.charAt(1) === ":");
		var allowed = !isSystem;
		if(!allowed) {
			var customFilter = ($tw.wiki.getTiddlerText("$:/config/wikilabs/uuid7/backfill-filter", "") || "").trim();
			if(customFilter) {
				var matches = $tw.wiki.filterTiddlers(customFilter, null, $tw.wiki.makeTiddlerIterator([title]));
				allowed = matches.indexOf(title) >= 0;
			}
		}
		if(!allowed) {
			return tiddler;
		}
		var ms = null;
		var source = "Date.now()";
		if(tiddler.fields.created) {
			var parsed = $tw.utils.parseDate(tiddler.fields.created);
			if(parsed) { ms = parsed.getTime(); source = "created"; }
		}
		if(!ms && tiddler.fields.modified) {
			var parsed = $tw.utils.parseDate(tiddler.fields.modified);
			if(parsed) { ms = parsed.getTime(); source = "modified"; }
		}
		var bytes = creator.generateUUIDv7Bytes(ms || undefined);
		var c7 = creator.toUUIDString(bytes);
		var c32 = c32lib.format(c32lib.encode(bytes));
		var c7Ms = creator.extractTimestampMs(c7);
		var createdStr = $tw.utils.stringifyDate(new Date(c7Ms));
		importLogLines.push("|[[" + title + "]]|" + source + "|" + createdStr + "|" + c7 + "|");
		// Schedule log flush after all import hooks have fired
		clearTimeout(importLogTimer);
		importLogTimer = setTimeout(flushImportLog, 100);
		return new $tw.Tiddler(tiddler, {c7: c7, c32: c32});
	});
};
