/*\
title: $:/core/modules/getTiddlerLinks.js
type: application/javascript
module-type: wikimethod

We need to overwrite the $tw.wiki.getTiddlerLinks() function to detect the "uni-link" macro.
This is needed, to get backlinks and missing tiddlers.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Return an array of tiddler titles that are directly linked from the specified tiddler
*/
exports.getTiddlerLinks = function(title) {
	var self = this;
	// We'll cache the links so they only get computed if the tiddler changes
	return this.getCacheForTiddler(title,"links",function() {
		// Parse the tiddler
		var parser = self.parseTiddler(title);
		// Count up the links
		var links = [];
		var checkParseTree = function(parseTree) {
				for(var t=0; t<parseTree.length; t++) {
					var value,
						parseTreeNode = parseTree[t];
					if(parseTreeNode.type === "link" && parseTreeNode.attributes.to && parseTreeNode.attributes.to.type === "string") {
						value = parseTreeNode.attributes.to.value;
						if(links.indexOf(value) === -1) {
							links.push(value);
						}
					} else if(parseTreeNode.type === "macrocall" && parseTreeNode.name === "uni-link"){
						// this section is new to detect uni-links
						var i = 0; // params ia an array, so we need to search for the "tid" name.
						while(i<parseTreeNode.params.length) {
							if (parseTreeNode.params[i].name === "tid") {
								value = parseTreeNode.params[i].value;
								if(links.indexOf(value) === -1) {
									links.push(value);
								}
								break; // since we found it
							}
							i = i+1;
						} // while
					} // else if
					if(parseTreeNode.children) {
						checkParseTree(parseTreeNode.children);
					}
				} // for t=0
			}; // function()
		if(parser) {
			checkParseTree(parser.tree);
		}
		return links;
	});
};

})();
