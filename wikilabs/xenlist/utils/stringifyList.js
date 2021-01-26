/*\
title: $:/core/modules/utils/stringifyList.js
type: application/javascript
module-type: utils

Parse a string field and return a filter-array. For example "OneTiddler [[Another Tiddler]] [subfilter{$:/DefaultTiddlers}]]"
It will return a filter in results["OneTiddler", "[[Another Tiddler]]" "[subfilter{$:/DefaultTiddlers}]]"]

\*/

(function(){
	/*jslint node: true, browser: true */
	/*global $tw: false */
	"use strict";

// Stringify an array of tiddler titles into a list string
exports.stringifyList = function(value) {
	var filterStart = "[+-~=";
	if($tw.utils.isArray(value)) {
		var result = new Array(value.length);
		for(var t=0, l=value.length; t<l; t++) {
			var entry = value[t] || "";
			if(filterStart.indexOf(entry[0]) !== -1) {
				result[t] = entry;
			} else if(entry.indexOf(" ") !== -1) {
				result[t] = "[[" + entry + "]]";
			} else {
				result[t] = entry;
			}
		}
		return result.join(" ");
	} else {
		return value || "";
	}
};

})();