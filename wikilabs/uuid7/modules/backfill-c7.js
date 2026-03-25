/*\
title: $:/plugins/wikilabs/uuid7/backfill-c7.js
type: application/javascript
module-type: startup

UUID v7 backfill on startup
============================
Iterates all existing tiddlers and generates a c7 field for those that
don't have one yet. Timestamp priority: created > modified > Date.now().

Modes (controlled by $:/config/wikilabs/uuid7/backfill-mode):
  "dry-run"  — write a log tiddler, don't modify anything (default)
  "live"     — actually add c7 to tiddlers
  "disabled" — do nothing

During live mode, $:/config/TimestampDisable is temporarily set to "yes"
so that writing c7 does not touch the modified field.

\*/

"use strict";

exports.name = "uuid7-backfill";
exports.after = ["uuid7-startup"];
exports.synchronous = true;

var BACKFILL_MODE_TITLE = "$:/config/wikilabs/uuid7/backfill-mode";
var TIMESTAMP_DISABLE_TITLE = "$:/config/TimestampDisable";
var LOG_TITLE = "_log/backfill-c7";

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

exports.startup = function() {
	var creator = require("$:/plugins/wikilabs/uuid7/creator.js");

	var mode = ($tw.wiki.getTiddlerText(BACKFILL_MODE_TITLE, "") || "").trim().toLowerCase();
	if(!mode) {
		mode = "dry-run";
	}
	if(mode === "disabled") {
		return;
	}

	var isLive = (mode === "live");
	var titles = $tw.wiki.allTitles();
	var logLines = [];
	var count = 0;

	logLines.push("|!Title|!Source|!Generated c7|");

	// In live mode, temporarily disable timestamps so writing c7 won't touch modified
	var previousTimestampDisable = null;
	if(isLive) {
		var tsd = $tw.wiki.getTiddler(TIMESTAMP_DISABLE_TITLE);
		previousTimestampDisable = tsd ? tsd.fields.text : null;
		$tw.wiki.addTiddler(new $tw.Tiddler(
			{title: TIMESTAMP_DISABLE_TITLE, text: "yes"}
		));
	}

	try {
		for(var i = 0; i < titles.length; i++) {
			var title = titles[i];
			// Skip system tiddlers
			if(title.charAt(0) === "$") {
				continue;
			}
			var tiddler = $tw.wiki.getTiddler(title);
			if(!tiddler) {
				continue;
			}
			// Skip if already has c7
			if(tiddler.fields.c7) {
				continue;
			}
			// Determine best timestamp
			var ms = parseDateField(tiddler.fields.created)
				|| parseDateField(tiddler.fields.modified)
				|| Date.now();
			var source = tiddler.fields.created ? "created"
				: (tiddler.fields.modified ? "modified" : "Date.now()");
			var c7 = creator.generateUUIDv7(ms);

			logLines.push("|[[" + title + "]]|" + source + "|" + c7 + "|");
			count++;

			if(isLive) {
				$tw.wiki.addTiddler(new $tw.Tiddler(tiddler, {c7: c7}));
			}
		}
	} finally {
		// Restore previous TimestampDisable state
		if(isLive) {
			if(previousTimestampDisable !== null) {
				$tw.wiki.addTiddler(new $tw.Tiddler(
					{title: TIMESTAMP_DISABLE_TITLE, text: previousTimestampDisable}
				));
			} else {
				$tw.wiki.deleteTiddler(TIMESTAMP_DISABLE_TITLE);
			}
		}
	}

	// Write the log tiddler (timestamps are re-enabled at this point)
	var summary = "Backfill mode: ''" + mode + "''\n\n";
	if(isLive) {
		summary += "Tiddlers updated: " + count + "\n\n";
	} else {
		summary += "Tiddlers that would be updated: " + count + "\n\n"
			+ "* ''No tiddlers have been changed.''\n"
			+ "* This is a dry-run preview.\n"
			+ "* Set the mode to ''live'' in [[$:/ControlPanel]] > Settings > WikiLabs > UUID v7\n"
			+ "* ''Reload'' to apply changes.\n\n";
	}
	$tw.wiki.addTiddler(new $tw.Tiddler(
		$tw.wiki.getCreationFields(),
		$tw.wiki.getModificationFields(),
		{
			title: LOG_TITLE,
			text: summary + logLines.join("\n")
		}
	));
};
