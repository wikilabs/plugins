/*\
title: $:/plugins/wikilabs/uni-link/filters/all/aliases.js
type: application/javascript
module-type: allfilteroperator

Filter function for [all[aliases]]

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.aliases = function(source,prefix,options) {
	return options.wiki.getAllAliases();
};

})();
