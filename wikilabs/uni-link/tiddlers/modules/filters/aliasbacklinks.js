/*\
title: $:/plugins/wikilabs/uni-link/filters/aliasbacklinks.js
type: application/javascript
module-type: filteroperator

Filter operator for returning all the backlinks from an alias

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.aliasbacklinks = function(source,operator,options) {
	var index = $tw.wiki.getIndexer("AliasIndexer");

	var results = [];
	source(function(tiddler,title) {
		var a = 1;
		$tw.utils.pushTop(results,options.wiki.getAliasBacklinks(title));
	});
	return results;
};

})();
