/*\
title: $:/plugins/wikilabs/uni-link/filters/aliassource.js
type: application/javascript
module-type: filteroperator

Read the input value and get the tiddler title, which matches value in aliases field
Blank if the variable is missing

\*/
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.aliassource = function(source,operator,options) {
	var results = [],
		index = $tw.wiki.getIndexer("AliasIndexer");

	source(function(tiddler,title) {
		var aliasMap = index.trie.getAliasMap(title);
		if (aliasMap) {
			$tw.utils.each(aliasMap, function(alias) {
				$tw.utils.each(alias.tiddlers, function(title) {
					results.push(title)
				});
			});
		}
	});
	return results;
};
