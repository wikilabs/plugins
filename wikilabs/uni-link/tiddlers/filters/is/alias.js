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
		aliases = options.wiki.getAllAliases();

	if(prefix === "!") {
		source(function(tiddler,title) {
			if (aliases.indexOf(title) === -1) results.push(title);
		});
	} else {
		source(function(tiddler,title) {
			if (aliases.indexOf(title) !== -1) results.push(title);
		});
	}
	return results;
};

})();
