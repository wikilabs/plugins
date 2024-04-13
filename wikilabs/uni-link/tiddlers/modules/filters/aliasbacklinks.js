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
		var node = backlinks.lookup(title);
		// old: $tw.utils.pushTop(results,options.wiki.getAliasBacklinks(title));
		if (node.details) {
			if (operator?.suffixes?.length > 0) {
				$tw.utils.each(operator.suffixes, function(suffix) {
					switch (suffix[0]) {
						case "keys":
							if (operator.operand) {
								$tw.utils.pushTop(results, node.details.has(operator.operand) ? [operator.operand] : []);
							} else {
								$tw.utils.each(node.details.getKeys(), function(key) {
									$tw.utils.pushTop(results, key);
								});
							}
						break;
						case "augmented":
							if (operator.operand) {
								$tw.utils.each(node.details.get(operator.operand), function(val) {
									$tw.utils.pushTop(results, val + " || " + [operator.operand]);
								})
							} else {
								$tw.utils.each(node.details.getKeys(), function(key) {
									$tw.utils.each(node.details.get(key), function(val) {
										$tw.utils.pushTop(results, val + " || " + key);
									});
								});
							}
						break;
					}
				});
			}
			else if (operator.operand) {
				$tw.utils.pushTop(results, node.details.get(operator.operand) || []);
			} else {
				$tw.utils.pushTop(results, node.details.getValues());
			}
		}
	});
	return results;
};
