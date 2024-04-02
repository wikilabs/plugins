/*\
title: $:/plugins/wikilabs/uni-link/indexers/aliasIndexerBacklinks.js
type: application/javascript
module-type: indexer

Indexes the aliases field values and manages the tiddler titles that have the alias
Implemented as a trie: https://en.wikipedia.org/wiki/Trie

[[title with spaces]] ... will be stored as key: [[title with spaces]]

\*/
/*jslint node: true, browser: true */
/*global modules: false */
"use strict";

var Trie = require("$:/plugins/wikilabs/uni-link/indexers/trie.js").Trie;
var BACKLINK_HEAD = "b";	// "a" .. for alias (b)acklinks

function AliasBacklinkIndexer(wiki) {
	this.wiki = wiki;
	this.aliases = $tw.wiki.getIndexer("AliasIndexer");
}

AliasBacklinkIndexer.prototype.init = function() {
	this.trie = new Trie(BACKLINK_HEAD);
}

AliasBacklinkIndexer.prototype.rebuild = function() {
	var self = this;
	// this.wiki.eachShadowPlusTiddlers(function(tiddler,title) {
	this.wiki.forEachTiddler(function(title,tiddler) {
		var aliasBacklinks = self._getAliasBacklinks(tiddler);
		if (aliasBacklinks.length > 0) {
			$tw.utils.each(aliasBacklinks, function(backlink) {
				var x = self.aliases.lookup(backlink.toLowerCase());
				if (x.details) {
					$tw.utils.each(x.details.getKeys(), function(key) {
						// var alias = x.details.get(key);
						var node = self.trie.addWord(key);
						node.details.set(backlink, title);
					})
				}
			})
		}
	});
}

AliasBacklinkIndexer.prototype._getAliasBacklinks = function(tiddler) {
	var self = this;
	var links = [];

	// Alias backlink handling
	function findAliases(title) {
		var checkParseTree = function(parseTree) {
			// Count up the links
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
		var parser = self.wiki.parseTiddler(title);
		if(parser) {
			checkParseTree(parser.tree);
		}
	};

	if (tiddler.fields["draft.of"]) {
		return [];
	} else {
		findAliases(tiddler.fields.title);
		return links;
	}
}

AliasBacklinkIndexer.prototype.update = function(updateDescriptor) {
	var self = this;
	if(!this.trie) {
		// This should never happen
		throw new Error("Alias BACKLINKS trie not initialized!");
	}

	// TODO !!!!!!!!!!!!!1

	var newAliases = [],
		oldAliases = [],
		self = this;
	if(updateDescriptor.old.exists) {
		oldAliases = this._getAliasBacklinks(updateDescriptor.old.tiddler);
		if (oldAliases.length > 0) {
			$tw.utils.each(oldAliases, function(alias){
				self.trie.deleteWord(alias, updateDescriptor.old.tiddler.fields.title);
			})
		}
	}
	if(updateDescriptor.new.exists) {
		newAliases = this._getAliasBacklinks(updateDescriptor.new.tiddler);
		if (newAliases.length > 0) {
			$tw.utils.each(newAliases, function(alias){
				var node = self.trie.addWord(alias);
				node.details.set(alias, updateDescriptor.new.tiddler.fields.title)
			})
		}
	}
}

AliasBacklinkIndexer.prototype.lookup = function(title) {
	return this.trie.getNodeMap(title)[title] || [];
}

exports.AliasBacklinkIndexer = AliasBacklinkIndexer;
