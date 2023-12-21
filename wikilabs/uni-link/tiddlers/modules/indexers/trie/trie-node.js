/*\
title: $:/plugins/wikilabs/uni-link/indexers/trie-node.js
type: application/javascript
module-type: library

trie-node class

\*/

(function(){
"use strict";

var HashTable = require("$:/plugins/wikilabs/uni-link/indexers/hashtable.js").HashTable;

/**
 * @param {string} character
 * @param {boolean} isCompleteWord
 * @param {Tiddler} tiddler
 */
function TrieNode(character, isCompleteWord, tiddler) {
	this.character = character || "";
	this.isCompleteWord = isCompleteWord || false;
	this.tiddlers = (tiddler) ? {tiddler} : {};	// hashmap of source tiddlers
	this.backlinks = {};						// hashmap of backlink tiddlers
	this.children = new HashTable();
}

/**
 * @param {string} character
 * @return {TrieNode}
 */
TrieNode.prototype.getChild = function(character) {
	return this.children.get(character);
}

/**
 * @param {string} character
 * @param {boolean} isCompleteWord
 * @param {Tiddler} tiddler
 * @return {TrieNode}
 */
TrieNode.prototype.addChild = function(character, isCompleteWord, tiddler) {
	isCompleteWord = isCompleteWord || false;
	if (!this.children.has(character)) {
		this.children.set(character, new TrieNode(character, isCompleteWord));
	}

	var childNode = this.children.get(character);

	if (isCompleteWord) {
		// $tw.utils.pushTop(childNode.tiddlers, tiddler);
		childNode.tiddlers[tiddler.fields.title] = tiddler;
	}

	// In cases similar to adding "car" after "carpet" we need to mark "r" character as complete.
	childNode.isCompleteWord = childNode.isCompleteWord || isCompleteWord;

	return childNode;
}

/**
 * @param {TrieNode} node
 * @param {Tiddler} tiddler
 * @return {TrieNode}
 */
TrieNode.prototype.addBacklink = function(node, tiddler) {
	if (node.isCompleteWord) {
		node.backlinks[tiddler.fields.title] = tiddler;
	}
	return node;
}

/**
 * @param {string} character
 * @return {TrieNode}
 */
TrieNode.prototype.removeChild = function(character) {
	var childNode = this.getChild(character);

	// Delete childNode only if:
	// - childNode has NO children,
	// - childNode.isCompleteWord === false.
	if ( childNode && !childNode.isCompleteWord && !childNode.hasChildren()	) {
		this.children.delete(character);
	}

	return this;	// TODO check for self
}

/**
 * @param {string} character
 * @return {boolean}
 */
TrieNode.prototype.hasChild = function(character) {
	return this.children.has(character);
}

/**
 * Check whether current TrieNode has children or not.
 * @return {boolean}
 */
TrieNode.prototype.hasChildren = function() {
	return this.children.getKeys().length !== 0;
}

/**
 * @return {string[]}
 */
TrieNode.prototype.suggestChildren = function() {
	return this.children.getKeys();
}

/**
 * @return {string}
 */
TrieNode.prototype.toString = function() {
	let childrenAsString = this.suggestChildren().toString();
	childrenAsString = childrenAsString ? ":" + childrenAsString : "";
	var isCompleteString = this.isCompleteWord ? "*" : "";

	return this.character + isCompleteString + childrenAsString;
}

exports.TrieNode = TrieNode;

})();