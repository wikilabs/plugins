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
	this.wiki.eachShadowPlusTiddlers(function(tiddler,title) {
		var aliasLinks = self._getAliasLinks(tiddler);
		if (aliasLinks.length > 0) {
			// check for alias sources
			$tw.utils.each(aliasLinks, function(alias) {
				var aliasSources = self.aliases.lookup(alias.toLowerCase());
				if (aliasSources.details) {
					$tw.utils.each(aliasSources.details.getKeys(), function(key) {
						var node = self.trie.addWord(key);
						var titles = node.details.get(alias) || [];
						$tw.utils.pushTop(titles, title);
						node.details.set(alias, titles);
					})
				} else {
					// It's an undefined alias
					var node = self.trie.addWord("?");
					var backlinks = [];
					$tw.utils.pushTop(backlinks, tiddler.fields.title);
					node.details.set(alias, backlinks);
				}
			})
		}
	});
}

AliasBacklinkIndexer.prototype._getAliasLinks = function(tiddler, text) {
	var self = this;
	var links = [];

	// Alias backlink handling
	function findAliases(title, text) {
		var parser;
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
		if (title) {
			parser = self.wiki.parseTiddler(title);
		} else if (text) {
			parser = self.wiki.parseText("text/vnd.tiddlywiki",text);
		}
		if(parser) {
			checkParseTree(parser.tree);
		}
	};

	if (tiddler && tiddler.fields["draft.of"]) {
		return [];
	} else if (text) {
		findAliases(null, text);
		return links;
	} else if (tiddler) {
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
	var newAliases = [],
		oldAliases = [],
		self = this;
	if(updateDescriptor.old.exists) {
		oldAliases = this._getAliasLinks(updateDescriptor.old.tiddler, updateDescriptor.old.tiddler.fields.text);
		if (oldAliases && oldAliases.length > 0) {
			$tw.utils.each(oldAliases, function(alias){
				var aliasSources = self.aliases.lookup(alias)?.details?.getKeys();
				if (aliasSources) {
					$tw.utils.each(aliasSources, function(aSource){
						// get trie node, so we can manipulate it
						var node = self.trie.getLastCharacterNode(aSource);
						var backlinks = [];
						// get existing backlinks and remove currentTiddler if it is there
						if (node) {
							$tw.utils.each(node.details.get(alias), function(backlink){
								if (backlink !== updateDescriptor.old.tiddler.fields.title) {
									backlinks.push(backlink);
								}
							});
							node.details.set(alias, backlinks);
						}
						if (backlinks.length === 0) {
							// .deleteWord only if there is no .details anymore
							// TODO remove backlinks if needed
							self.trie.deleteWord(aSource);
						}
					})
				} else {
					// There is an undefined backlink
					var node = self.trie.getLastCharacterNode("?");
					if (node) {
						node.details.delete(alias);
					}
				}
			})
		}
	}
	if(updateDescriptor.new.exists) {
		newAliases = this._getAliasLinks(updateDescriptor.new.tiddler, updateDescriptor.new.tiddler.fields.text);
		if (newAliases?.length > 0) {
			$tw.utils.each(newAliases, function(alias){
				var aliasSources = self.aliases.lookup(alias)?.details?.getKeys();
				if (aliasSources) {
					$tw.utils.each(aliasSources, function(aSource){
						// get trie node, so we can manipulate it. If it does not exist, create it
						var node = self.trie.getLastCharacterNode(aSource) || self.trie.addWord(aSource);
						var backlinks = node?.details?.get(alias) || [];
						$tw.utils.pushTop(backlinks, updateDescriptor.new.tiddler.fields.title);
						node.details.set(alias, backlinks);
					})
				} else {
					var aSource = self.aliases.lookup(alias.toLowerCase());
					if (aSource.length > 0) {
						$tw.utils.each(aSource.details.getKeys(), function(key) {
							var node = self.trie.addWord(key);
							var titles = node.details.get(aSource) || [];
							node.details.set(aSource, titles);
						})
					} else {
						// It's an undefined alias
						var node = self.trie.addWord("?");
						var backlinks = [];
						$tw.utils.pushTop(backlinks, updateDescriptor.new.tiddler.fields.title);
						node.details.set(alias, backlinks);
					}
				}
			})
		}
	}
}

AliasBacklinkIndexer.prototype.lookup = function(title) {
	return this.trie.getNodeMap(title)[title] || {};
}

exports.AliasBacklinkIndexer = AliasBacklinkIndexer;
