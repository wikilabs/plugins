/*\
title: title: $:/plugins/wikilabs/bundler/upgrade.js
type: application/javascript
module-type: upgrader

This module checks, if tiddlers, that are imported already exist. If they do, they are disabled and a tiddler with a new name will be created. ge: "New Tiddler (1)".

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var ENABLE_OVERWRITE_CHECK = "$:/config/wikilabs/enableOverwriteCheck";

exports.upgrade = function(wiki,titles,tiddlers) {
	var self = this,
		messages = {},
		overwriteCheck = $tw.wiki.checkTiddlerText(ENABLE_OVERWRITE_CHECK,"yes");

	$tw.utils.each(titles,function(title) {
		var tiddler = {},
			tiddlerData = wiki.getTiddler(title);
		// Check for tiddlers on our list. Atm, we check for names only, since 5.1.14 allows modification date to be supressed.
		// Creating a hash, would be a better option. ToDo
		if (wiki.tiddlerExists(title)) {
			messages[title] = "Existing tiddler will be overwritten!";
			// create new tiddler with a new name
			if (overwriteCheck) {
				messages[title] = "A tiddler with that name exists. A new name will be used!";
				tiddler = new $tw.Tiddler(tiddlers[title], {"title": wiki.generateNewTitle(title) });
				tiddlers[tiddler.fields.title] = tiddler.fields;
				// remove the original tiddler
				tiddlers[title] = Object.create(null);
			}
		}
	});
	return messages;
	}

})();
