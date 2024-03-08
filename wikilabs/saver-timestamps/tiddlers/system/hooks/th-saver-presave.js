/*\
title: $:/plugins/wikilabs/saver-timestamps/th-saver-presave.js
type: application/javascript
module-type: startup

A startup module to add a saver presave hook, with superpowers

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false, exports: true */
"use strict";

// Export name and synchronous status
exports.name = "saverpresave";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// Favicon tiddler
var ENABLE_IMPORT_HEADER = "$:/config/wikilabs/saver-timestamps/enableImportHeader",
	IMPORT_HEADER_TEMPLATE = "$:/config/wikilabs/bundler/importHeaderTemplate",
	// Next line needs to be that name because of compatibility reasons
	
	ENABLE_IMPORT_BUNDLE = "$:/config/wikilabs/enableImportBundle",
	IMPORT_LOG_TITLE = "import.bundle";

exports.startup = function() {
	$tw.hooks.addHook("th-saver-presave",function(options, wiki) {
		if($tw.wiki.checkTiddlerText(ENABLE_IMPORT_HEADER,"yes")) {
		}
		return options;
	});
};

})();
