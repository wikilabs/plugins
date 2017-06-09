/*\
title: title: $:/plugins/wikilabs/bundles/upgrade.js
type: application/javascript
module-type: upgrader

This module checks, if tiddlers, that are imported already exist. If they do, they are disabled and a tiddler with a new name will be created. ge: "New Tiddler (1)".

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.upgrade = function(wiki,titles,tiddlers) {
	var self = this,
		messages = {};

	$tw.utils.each(titles,function(title) {
		var tiddler,
			tiddlerData = wiki.getTiddler(title);
		// Check for tiddlers on our list. Atm, we check for names only, since 5.1.14 allows modification date to be supressed.
		// Creating a hash, would be a better option. ToDo
		if (wiki.tiddlerExists(title)) {
			messages[title] = "A tiddler with that name exists. A new tiddler will be created!";
			tiddlers[title] = Object.create(null);
			// create new tiddler with a new name
			tiddler = new $tw.Tiddler(tiddlers[title], {"title": wiki.generateNewTitle(title) });
			tiddlers[tiddler.fields.title] = tiddler.fields;
		}
	});
	return messages;
};

})();
