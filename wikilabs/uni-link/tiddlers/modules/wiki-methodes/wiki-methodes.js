/*\
title: $:/plugins/wikilabs/uni-link/wiki-methodes.js
type: application/javascript
module-type: wikimethod

OVERWRITES core methods for the $tw.Wiki object:

exports.extractLinks = function(parseTreeRoot) {
exports.getTiddlerLinks = function(title) {

\*/
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";


/*
Return an array of tiddler titles that are directly linked within the given parse tree
 */
exports.extractLinks = function(parseTreeRoot) {
	// Count up the links
	var links = [],
		checkParseTree = function(parseTree) {
			for(var t=0; t<parseTree.length; t++) {
				var parseTreeNode = parseTree[t];
				if(parseTreeNode.type === "link" && parseTreeNode.attributes.to && parseTreeNode.attributes.to.type === "string") {
					var value = parseTreeNode.attributes.to.value;
					if(links.indexOf(value) === -1) {
						links.push(value);
					}
				} else if (parseTreeNode.type === "macrocall" && parseTreeNode.name === "uni-link" && parseTreeNode.params && parseTreeNode.params[0].value) {
					var value = parseTreeNode.params[0].value;
					if(links.indexOf(value) === -1) {
						links.push(value);
					}
				} // else if type==="macrocall"

				if(parseTreeNode.children) {
					checkParseTree(parseTreeNode.children);
				}
			}
		};
	checkParseTree(parseTreeRoot);
	return links;
};

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
		var links = [],
			checkParseTree = function(parseTree) {
				for(var t=0; t<parseTree.length; t++) {
					var parseTreeNode = parseTree[t];
					if(parseTreeNode.type === "link" && parseTreeNode.attributes.to && parseTreeNode.attributes.to.type === "string") {
						var value = parseTreeNode.attributes.to.value;
						if(links.indexOf(value) === -1) {
							links.push(value);
						}
					} else if (parseTreeNode.type === "macrocall" && parseTreeNode.name === "uni-link" && parseTreeNode.params && parseTreeNode.params[0].value) {
						var value = parseTreeNode.params[0].value;
						if(links.indexOf(value) === -1) {
							links.push(value);
						}
					} // else if type==="macrocall"

					if(parseTreeNode.children) {
						checkParseTree(parseTreeNode.children);
					}
				}
			};
		if(parser) {
			checkParseTree(parser.tree);
		}
		return links;
	});
};
