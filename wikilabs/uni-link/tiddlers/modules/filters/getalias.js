/*\
title: $:/plugins/wikilabs/uni-link/filters/aliasbacklinks.js
type: application/javascript
module-type: filteroperator

Read the input value and get the tiddler title, which matches value in aliases field
Blank if the variable is missing

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Export our filter function
*/
exports.getvariable = function(source,operator,options) {
	var results = [];
	source(function(tiddler,title) {
		results.push(options.widget.getVariable(title) || "");
	});
	return results;
};

})();
