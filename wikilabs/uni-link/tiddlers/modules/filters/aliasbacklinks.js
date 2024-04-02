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
		var a = backlinks.lookup(title);
		var b = backlinks.trie.getLastCharacterNode(title);
		// $tw.utils.pushTop(results,options.wiki.getAliasBacklinks(title));
		if (b) {
			$tw.utils.pushTop(results, b.details.getValues());
		}
	});
	return results;
};
