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
		if(tiddler.c7) {
			return;
		}
		// Find best available timestamp: created > modified > now
		var ms = parseDateField(tiddler.created) || parseDateField(tiddler.modified) || Date.now();
		tiddler.c7 = creator.generateUUIDv7(ms);
		var source = tiddler.created ? "created" : (tiddler.modified ? "modified" : "Date.now()");
		messages[title] = "Added c7 field from " + source + " timestamp";
	});
	return messages;
};
