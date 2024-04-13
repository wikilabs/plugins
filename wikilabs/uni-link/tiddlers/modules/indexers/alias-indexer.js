/*\
title: $:/plugins/wikilabs/uni-link/indexers/aliasindexer.js
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
var ALIAS_HEAD = 'a';	// "a" .. for alias

function AliasIndexer(wiki) {
	this.wiki = wiki;
}

AliasIndexer.prototype.init = function() {
	this.trie = new Trie(ALIAS_HEAD);
}

AliasIndexer.prototype.rebuild = function() {
	var self = this;
	this.wiki.eachShadowPlusTiddlers(function(tiddler,title) {
		if (tiddler.fields.aliases) {
			var aliases = self._getAliases(tiddler);
			$tw.utils.each(aliases, function(alias) {
				var node = self.trie.addWord(alias.toLowerCase());
				node.details.set(title, alias/*.toLowerCase()*/)
			});
		}
	});
}

AliasIndexer.prototype._getAliases = function(tiddler) {
	if (tiddler.fields["draft.of"]) {
		return [];
	} else {
		return tiddler.getFieldList("aliases");
	}
}

AliasIndexer.prototype.update = function(updateDescriptor) {
	var self = this;
	if(!this.trie) {
		// This should never happen
		throw new Error("Alias trie not initialized!");
	}
	var newAliases = [],
		oldAliases = [],
		self = this;
	if(updateDescriptor.old.exists) {
		oldAliases = this._getAliases(updateDescriptor.old.tiddler);
		if (oldAliases.length > 0) {
			$tw.utils.each(oldAliases, function(alias){
				self.trie.deleteWord(alias.toLowerCase(), updateDescriptor.old.tiddler.fields.title);
			})
		}
	}
	if(updateDescriptor.new.exists) {
		newAliases = this._getAliases(updateDescriptor.new.tiddler);
		if (newAliases.length > 0) {
			$tw.utils.each(newAliases, function(alias){
				var node = self.trie.addWord(alias.toLowerCase());
				node.details.set(updateDescriptor.new.tiddler.fields.title, alias);
			})
		}
	}
}

AliasIndexer.prototype.lookup = function(title) {
	return this.trie.getNodeMap(title)[title] || [];
}

exports.AliasIndexer = AliasIndexer;
