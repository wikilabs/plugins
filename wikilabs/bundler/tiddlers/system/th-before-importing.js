/*\
title: $:/plugins/wikilabs/bundler/th-before-importing.js
type: application/javascript
module-type: startup

A startup module to log imported tiddlers to the import.bundle tiddler.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false, exports: true */
"use strict";

// Export name and synchronous status
exports.name = "bundlerbeforeimport";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// Favicon tiddler
var ENABLE_IMPORT_HEADER = "$:/config/wikilabs/bundler/enableImportHeader",
	IMPORT_HEADER_TEMPLATE = "$:/config/wikilabs/bundler/importHeaderTemplate",
	// Next line needs to be that name because of compatibility reasons
	
	ENABLE_IMPORT_BUNDLE = "$:/config/wikilabs/enableImportBundle",
	IMPORT_LOG_TITLE = "import.bundle";

exports.startup = function() {
	$tw.hooks.addHook("th-before-importing",function(importTiddler) {
		var logTiddler,
			logHeader = $tw.wiki.renderTiddler("text/plain",IMPORT_HEADER_TEMPLATE) || "New import started!";

		if($tw.wiki.checkTiddlerText(ENABLE_IMPORT_HEADER,"yes")) {
			if($tw.wiki.checkTiddlerText(ENABLE_IMPORT_BUNDLE,"yes")) {
				logTiddler = $tw.wiki.getTiddler(IMPORT_LOG_TITLE) || new $tw.Tiddler($tw.wiki.getCreationFields(), $tw.wiki.getModificationFields(), {title: IMPORT_LOG_TITLE, text: "", type: "text/plain", tags: ["$:/tags/Bundle"]});

				var lineFeed = (logTiddler.fields.text) ? "\n" : "";

				$tw.wiki.addTiddler( new $tw.Tiddler( logTiddler, 
					{text: logTiddler.fields.text + lineFeed + "[[--- " + logHeader + " ---]]\n"}));
			}
		}
		return importTiddler;
	});
};

})();
