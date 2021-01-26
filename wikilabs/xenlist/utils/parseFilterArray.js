/*\
title: $:/core/modules/utils/parseFilterArray.js
type: application/javascript
module-type: utils

Parse a string field and return a filter-array. For example "OneTiddler [[Another Tiddler]] [subfilter{$:/DefaultTiddlers}]]"
It will return a filter in results["OneTiddler", "[[Another Tiddler]]" "[subfilter{$:/DefaultTiddlers}]]"]

\*/

(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.parseFilterArray = function(value, allowDuplicate, mode) {
	var item;
	if(typeof value === "string") {
		var memberRegExp = /\[\[((?:[^\]])*)\]\]|["']((?:[^\]"'])*)["']|(\[?\[.*?[\]|\>|}]\])|([+|\-|~|=]\[(?:[^\]])*[\]]+)|([+|\-|~|=]\S*)|([^[\s]?\S+)/mg,
			results = [], names = {},
			match;
		do {
			match = memberRegExp.exec(value);
			if(match) {
				if ((match[1] || match[2]) && mode==="stringify") {
					item = match[1] || match[2];
					item = "[[" + item + "]]";
				} else { // "filter mode is active""
					item = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
				}
				if(item !== undefined && (!$tw.utils.hop(names,item) || allowDuplicate)) {
					results.push(item);
					names[item] = true;
				}
			}
		} while(match);
		return results;
	} else if($tw.utils.isArray(value)) {
		return value;
	} else {
		return null;
	}
};

})();