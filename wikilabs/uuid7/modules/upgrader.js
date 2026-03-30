/*\
title: $:/plugins/wikilabs/uuid7/upgrader.js
type: application/javascript
module-type: upgrader

UUID v7 upgrader
=================
Backfills the "c7" field on imported tiddlers that don't have one.

Timestamp priority for generating c7:
1. "created" field if present
2. "modified" field as fallback
3. Date.now() if neither exists

Never adds or modifies the "created" field — only c7.
Shadow tiddlers are skipped. Tiddlers that already have c7 are skipped.

\*/

"use strict";

var creator = require("$:/plugins/wikilabs/uuid7/creator.js");
var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
var b62lib = require("$:/plugins/wikilabs/uuid7/base62id.js");

function parseDateField(value) {
	if(!value) {
		return null;
	}
	var ms;
	if(value instanceof Date) {
		ms = value.getTime();
	} else if(typeof value === "string" && value.length > 0) {
		var parsed = $tw.utils.parseDate(value);
		if(parsed) {
			ms = parsed.getTime();
		}
	}
	return (ms && !isNaN(ms)) ? ms : null;
}

exports.upgrade = function(wiki, titles, tiddlers) {
	var messages = {};
	$tw.utils.each(titles, function(title) {
		var tiddler = tiddlers[title];
		if(!tiddler) {
			return;
		}
		// Skip system/shadow tiddlers
		if(title.charAt(0) === "$") {
			return;
		}
		// Backfill c32/c62 from existing c7
		if(tiddler.c7 && (!tiddler.c32 || !tiddler.c62)) {
			if(!tiddler.c32) { tiddler.c32 = c32lib.fromUUID(tiddler.c7); }
			if(!tiddler.c62) { tiddler.c62 = b62lib.fromUUID(tiddler.c7); }
			messages[title] = "Added c32/c62 fields from existing c7";
			return;
		}
		if(tiddler.c7) {
			return;
		}
		// Find best available timestamp: created > modified > now
		var ms = parseDateField(tiddler.created) || parseDateField(tiddler.modified) || Date.now();
		var bytes = creator.generateUUIDv7Bytes(ms);
		tiddler.c7 = creator.toUUIDString(bytes);
		tiddler.c32 = c32lib.format(c32lib.encode(bytes));
		tiddler.c62 = b62lib.encode(bytes);
		var source = tiddler.created ? "created" : (tiddler.modified ? "modified" : "Date.now()");
		messages[title] = "Added c7, c32, c62 fields from " + source + " timestamp";
	});
	return messages;
};
