/*\
title: $:/plugins/wikilabs/bundler/import-untitled.js
type: application/javascript
module-type: upgrader

This module checks, if tiddlers, that are imported are named "untitled.png". 
If so, they are renamed according the template config tiddler.

The default untitled name comming from the clipboard depends on the browser language setting.
\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var UNTITLED_DEFAULT_TITLE = "$:/config/wikilabs/import/untitled/default-title",
	UNTITLED_TITLE_TEMPLATE = "$:/config/wikilabs/import/untitled/title-template",
	ENABLE_IMPORT_RENAME = "$:/config/wikilabs/enableImportRename";

exports.upgrade = function(wiki,titles,tiddlers) {
	// Check if function is enabled
	if ($tw.wiki.getTiddlerText(ENABLE_IMPORT_RENAME,"no").trim() !== "yes" ) {
		return {};
	}
	var self = this,
		messages = {},
		defaultTitle = $tw.wiki.getTiddlerText(UNTITLED_DEFAULT_TITLE,"Untitled").trim(),
		targetTitle = $tw.wiki.getTiddlerText(UNTITLED_TITLE_TEMPLATE,"Clipboard YYYY-0MM-0DD, 0hh:0mm:0XXX").trim();

	$tw.utils.each(titles,function(title) {
		var tiddler = {};
		var regexp = /(^untitled)(.*)/i; // check for prefix "untitled" non case sensitive
		var match = regexp.exec(title);

		// If the tiddler has been removed, there will be no fields.
		if (match && (match[0] === defaultTitle + match[2])) {
			messages[title] = "auto-renamed";
			var newTitle = $tw.utils.formatDateString(new Date(),targetTitle + match[2]);
			tiddler = new $tw.Tiddler(tiddlers[title], {"title": newTitle });
			tiddlers[tiddler.fields.title] = tiddler.fields;
			// remove the original tiddler
			tiddlers[title] = Object.create(null);
		}
	});
	return messages;
	}
