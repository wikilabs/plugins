/*\
title: $:/plugins/wikilabs/bundler/import-image.js
type: application/javascript
module-type: upgrader

This module checks, if tiddlers, that are imported are named "image.png". 
If so, they are renamed according the template config tiddler.

The default image name comming from the clipboard depends on the browser language setting.
\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var IMAGE_DEFAULT_TITLE = "$:/config/wikilabs/import/image/default-title",
	IMAGE_TITLE_TEMPLATE = "$:/config/wikilabs/import/image/title-template",
	ENABLE_IMPORT_RENAME = "$:/config/wikilabs/enableImportRename";

exports.upgrade = function(wiki,titles,tiddlers) {
	// Check if function is enabled
	if ($tw.wiki.getTiddlerText(ENABLE_IMPORT_RENAME,"no").trim() !== "yes" ) {
		return {};
	}
	var self = this,
		messages = {},
		defaultTitle = $tw.wiki.getTiddlerText(IMAGE_DEFAULT_TITLE,"image.png").trim(),
		targetTitle = $tw.wiki.getTiddlerText(IMAGE_TITLE_TEMPLATE,"image YYYY-0MM-0DD, 0hh:0mm:0XXX.png").trim();

	$tw.utils.each(titles,function(title) {
		var tiddler = {};
		// If the tiddler has been removed, there will be no fields.
		if (title === defaultTitle) {
			messages[title] = "auto-renamed";
			var test= $tw.utils.formatDateString(new Date(),targetTitle);
			tiddler = new $tw.Tiddler(tiddlers[title], {"title": test });
			tiddlers[tiddler.fields.title] = tiddler.fields;
			// remove the original tiddler
			tiddlers[title] = Object.create(null);
		}
	});
	return messages;
	}
