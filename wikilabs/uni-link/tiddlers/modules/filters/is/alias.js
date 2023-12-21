/*\
title: $:/plugins/wikilabs/uni-link/filters/is/alias.js
type: application/javascript
module-type: isfilteroperator

Filter function for [is[alias]]

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.alias = function(source,prefix,options) {
	var results = [],
		index = $tw.wiki.getIndexer("AliasIndexer");

	if(prefix === "!") {
		source(function(tiddler,title) {
			title = title.toLowerCase();
			index.trie.doesWordExist(title) ? "" : results.push(title);
		});
	} else {
		source(function(tiddler,title) {
			title = title.toLowerCase();
			index.trie.doesWordExist(title) ? results.push(title) : "";
		});
	}
	return results;
};

})();
