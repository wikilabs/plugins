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

/**
 * The index of which tiddlers link to which alias, built when it is first looked up.
 * @param {object} wiki the wiki
 */
function AliasBacklinkIndexer(wiki) {
	this.wiki = wiki;
	this.aliases = $tw.wiki.getIndexer("AliasIndexer");
}

/**
 * Starts with nothing built.
 * @returns {void}
 */
AliasBacklinkIndexer.prototype.init = function() {
	this.trie = null;
}

/**
 * Drops the index for the next lookup to build, as building parses every tiddler and any plugin change rebuilds the indexes.
 * @returns {void}
 */
AliasBacklinkIndexer.prototype.rebuild = function() {
	this.trie = null;
}

/**
 * Builds the index from every tiddler and shadow.
 * @returns {void}
 */
AliasBacklinkIndexer.prototype._build = function() {
	var self = this;
	this.trie = new Trie(BACKLINK_HEAD);
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

/**
 * The aliases a tiddler or a text links to.
 * @param {object} tiddler the tiddler
 * @param {string} [text] the text, in place of parsing the tiddler
 * @returns {string[]|undefined}
 */
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

/**
 * Follows a changed tiddler, if the index is built; the next lookup sees the change otherwise.
 * @param {{old: {exists: boolean, tiddler: object}, new: {exists: boolean, tiddler: object}}} updateDescriptor the change
 * @returns {void}
 */
AliasBacklinkIndexer.prototype.update = function(updateDescriptor) {
	var self = this;
	if(!this.trie) return;
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
	if(updateDescriptor.new.exists && !(updateDescriptor.new.tiddler.fields["plugin-type"])) {
		newAliases = this._getAliasLinks(updateDescriptor.new.tiddler, updateDescriptor.new.tiddler.fields.text);
		if (newAliases?.length > 0) {
			$tw.utils.each(newAliases, function(alias){
				var aliasSources = self.aliases.lookup(alias)?.details?.getKeys();
				if (aliasSources) {
					// alias does not registered yet
					$tw.utils.each(aliasSources, function(aSource){
						// get trie node, so we can manipulate it. If it does not exist, create it
						var node = self.trie.getLastCharacterNode(aSource) || self.trie.addWord(aSource);
						var backlinks = node?.details?.get(alias) || [];
						$tw.utils.pushTop(backlinks, updateDescriptor.new.tiddler.fields.title);
						node.details.set(alias, backlinks);
					})
				} else {
					// register new alias backlink
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
		// tiddler may contain a new alias, so remove it from "undefined" backlinks
		newAliases = this.aliases._getAliases(updateDescriptor.new.tiddler, updateDescriptor.new.tiddler.fields.text);
		if (newAliases?.length > 0) {
			$tw.utils.each(newAliases, function(alias){
				var x = self.lookup("?");
				$tw.utils.each (x?.details?.getKeys(), function(key){
					if (key.toLowerCase() === alias.toLowerCase()) {
						x.details.delete(key);
					}
				});
			});
			// update backlinks, if a new alias is created
			this.rebuild();
		}
	}
}

/**
 * The node of a title, with its aliases' backlinks in `details`.
 * @param {string} title the title
 * @returns {object}
 */
AliasBacklinkIndexer.prototype.lookup = function(title) {
	if(!this.trie) this._build();
	return this.trie.getNodeMap(title)[title] || {};
}

exports.AliasBacklinkIndexer = AliasBacklinkIndexer;
