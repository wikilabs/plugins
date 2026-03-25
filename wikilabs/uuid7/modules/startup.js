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
		fields.c7 = creator.generateUUIDv7();
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
};
