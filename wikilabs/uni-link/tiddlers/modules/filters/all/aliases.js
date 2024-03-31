/*\
title: $:/plugins/wikilabs/uni-link/filters/all/aliases.js
type: application/javascript
module-type: allfilteroperator

Filter function for [all[aliases]]

\*/
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.aliases = function(source,prefix,options) {
	var index = $tw.wiki.getIndexer("AliasIndexer");
	return index.trie.suggestPossibleWords("").strings;
};
