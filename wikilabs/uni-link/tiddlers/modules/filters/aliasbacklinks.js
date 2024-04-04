/*\
title: $:/plugins/wikilabs/uni-link/filters/aliasbacklinks.js
type: application/javascript
module-type: filteroperator

Filter operator for returning all the backlinks from an alias

\*/
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.aliasbacklinks = function(source,operator,options) {
	var results = [];
	var backlinks = $tw.wiki.getIndexer("AliasBacklinkIndexer");

	source(function(tiddler,title) {
		var x = backlinks.lookup(title);
		// old: $tw.utils.pushTop(results,options.wiki.getAliasBacklinks(title));
		if (x.details) {
			$tw.utils.pushTop(results, x.details.getValues());
		}
	});
	return results;
};
