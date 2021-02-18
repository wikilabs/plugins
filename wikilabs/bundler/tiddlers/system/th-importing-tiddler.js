/*\
title: $:/plugins/wikilabs/bundler/th-importing-tiddler.js
type: application/javascript
module-type: startup

A startup module to log imported tiddlers to the import.bundle tiddler.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false, exports: true */
"use strict";

// Export name and synchronous status
exports.name = "bundlerimporttiddler";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// Favicon tiddler
var ENABLE_LOG_TITLE = "$:/config/wikilabs/enableImportBundle",
	IMPORT_LOG_TITLE = "import.bundle";

exports.startup = function() {
	$tw.hooks.addHook("th-importing-tiddler",function(tiddler) {
		var logTiddler,
			tidTitle = tiddler.fields.title;

		if($tw.wiki.checkTiddlerText(ENABLE_LOG_TITLE,"yes")) {
			logTiddler = $tw.wiki.getTiddler(IMPORT_LOG_TITLE) || new $tw.Tiddler($tw.wiki.getCreationFields(), $tw.wiki.getModificationFields(), {title: IMPORT_LOG_TITLE, text: "", type: "text/plain", tags: ["$:/tags/Bundle"]});

			if (tidTitle.indexOf(" ") !== -1) {
				$tw.wiki.addTiddler( new $tw.Tiddler( logTiddler, {text: logTiddler.fields.text + "[[" + tidTitle + "]]\n"}));
			} else {
				$tw.wiki.addTiddler( new $tw.Tiddler( logTiddler, {text: logTiddler.fields.text + tidTitle + "\n"}));
			}
		}
		return tiddler;
	});
};

})();
