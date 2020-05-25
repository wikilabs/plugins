/*\
title: $:/plugins/wikilabs/uni-link/wiki-ext.js
type: application/javascript
module-type: wikimethod

Extension methods for the $tw.Wiki object

Adds the following properties to the wiki object:

exports.getTiddlerAliasLinks = function(title) {
exports.getTiddlerAliasBacklinks = function(targetTitle) {

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

//var widget = require("$:/core/modules/widgets/widget.js");


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
exports.getTiddlerLinksXXX = function(title) {
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

/*
Alias backlink handling
*/
function aliasInit(title) {
	// Parse the tiddler
	var parser = this.parseTiddler(title);
	// Count up the links
	var links = [],
		checkParseTree = function(parseTree) {
			for(var t=0; t<parseTree.length; t++) {
				var parseTreeNode = parseTree[t];
				if(parseTreeNode.type === "macrocall" && parseTreeNode.name === "aka") {
					var value = parseTreeNode.params[0].value;
					if(links.indexOf(value) === -1) {
						links.push(value);
					}
				}
				if(parseTreeNode.children) {
					checkParseTree(parseTreeNode.children);
				}
			}
		};
	if(parser) {
		checkParseTree(parser.tree);
	}
	/*
	For every tiddler invoke a callback(title,tiddler) with `this` set to the wiki object. Options include:
	sortField: field to sort by
	excludeTag: tag to exclude
	includeSystem: whether to include system tiddlers (defaults to false)
	*/
	var backlinks = []
	this.forEachTiddler({includeSystem:true}, function(ttl,tiddler) {
		if (tiddler.fields["aliases"]) {
			// var fields = tiddler.fields["aliases"];
			var fields = $tw.utils.parseStringArray(tiddler.fields["aliases"]);
			fields = fields.map(function (el){
				return el.toLowerCase();
			});
			links.map( function (el) {
				if (fields.indexOf(el.toLowerCase()) != -1) backlinks.push(ttl);
			})
		} // if tiddler aliases
	});

	if ((backlinks.length === 0) && (links.length > 0)) {
		backlinks[0] = "?";
	}

	return backlinks;
}

exports.getAllAliases = function() {
	var self = this,
		aliases = "";
	/*
	For every tiddler invoke a callback(title,tiddler) with `this` set to the wiki object. Options include:
	sortField: field to sort by
	excludeTag: tag to exclude
	includeSystem: whether to include system tiddlers (defaults to false)
	*/
	self.forEachTiddler({includeSystem:true}, function(title,tiddler) {
		if (tiddler.fields["aliases"]) {
//			$tw.utils.pushTop(aliases, this.getCacheForTiddler(title,"alias",aliasInit.bind(this, title)));
			aliases = aliases + ` ${tiddler.fields.aliases}`;
		} // if tiddler aliases
	});
	aliases = aliases.toLowerCase();
	return $tw.utils.parseStringArray(aliases);
};


/*
Return an array of tiddler titles that are alias linked from the specified tiddler
*/
exports.getTiddlerAliasLinks = function(title) {
	var self = this;

	// We'll cache the links so they only get computed if the tiddler changes
	return this.getCacheForTiddler(title,"alias",aliasInit.bind(this, title));
};

/*
Return an array of tiddler titles that link to the specified tiddler
*/
exports.getTiddlerAliasBacklinks = function(targetTitle) {
	var self = this,
		backlinks = [];
	this.forEachTiddler(function(title,tiddler) {
		var links = self.getTiddlerAliasLinks(title);
		if(links.indexOf(targetTitle) !== -1) {
			backlinks.push(title);
		}
	});
	return backlinks;
};

})();

