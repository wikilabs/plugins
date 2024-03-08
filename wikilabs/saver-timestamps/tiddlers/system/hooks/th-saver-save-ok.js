/*\
title: $:/plugins/wikilabs/saver-timestamps/th-saver-save-ok.js
type: application/javascript
module-type: startup

A startup module to add a saver save OK hook to eg: notify other tabs

Everything, which would trigger an "autosave" will count as a "lastChanged" tiddler.
Filter is defined in: $:/config/SaverFilter

\*/

/*jslint node: true, browser: true */
/*global $tw: false, exports: true */
"use strict";

// Export name and synchronous status
exports.name = "saversaveok";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// Favicon tiddler
var ENABLE_SAVE_OK_TIDDLER = "$:/config/wikilabs/saver-timestamps/enableSaveTimestamps",
	SAVE_STATE = "$:/temp/saver/save/info";

exports.startup = function() {
	$tw.hooks.addHook("th-saver-save-ok",function(options, wiki) {
		if($tw.wiki.getTiddlerText(ENABLE_SAVE_OK_TIDDLER,"yes").trim() === "yes") {
			var isEncrypted = wiki.getTiddlerText("$:/isEncrypted") === "yes";
			var lastChanged = wiki.getTiddler(wiki.filterTiddlers("[subfilter{$:/config/SaverFilter}!sort[modified]limit[1]]"));
			var saveTimestamp = $tw.utils.formatDateString(new Date(),"YYYY0MM0DD0hh0mm0ss0XXX");

			// Do NOT leak the tiddler title or modified date if store is encrypted
			var lastModifiedTiddler = (lastChanged && !isEncrypted) ? lastChanged.fields.title + "----" + lastChanged.getFieldString("modified") : "";

			// AdvancedSearch Filter: [subfilter{$:/config/SaverFilter}!sort[modified]limit[1]] :map[<currentTiddler>addsuffix{!!modified}sha256[20]]
			var lastModifiedTiddlerSha256 = (lastChanged) ? $tw.utils.sha256(lastChanged.fields.title + lastChanged.getFieldString("modified"),{length: 20}) : "";

			wiki.addTiddler(
				new $tw.Tiddler({title:SAVE_STATE,
					text:"saveTimestamp: " +  saveTimestamp + "\n" +
					"lastModifiedTiddler: " + lastModifiedTiddler  + "\n" +
					"lastModifiedTiddlerSha256: " + lastModifiedTiddlerSha256,
					type:"application/x-tiddler-dictionary"},
					wiki.getModificationFields()
				)
			);
		} else {
			wiki.deleteTiddler(SAVE_STATE);
		}
		return null;
	});
};
