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
 */
function TrieNode(character, isCompleteWord, value) {
	this.character = character || "";
	this.isCompleteWord = isCompleteWord || false;
	this.values=value || [];
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
 * @param {string} value
 * @return {TrieNode}
 */
TrieNode.prototype.addChild = function(character, isCompleteWord, value) {
	isCompleteWord = isCompleteWord || false;
	if (!this.children.has(character)) {
		this.children.set(character, new TrieNode(character, isCompleteWord));
	}

	var childNode = this.children.get(character);

	// In cases similar to adding "car" after "carpet" we need to mark "r" character as complete.
	childNode.isCompleteWord = childNode.isCompleteWord || isCompleteWord;

	if (childNode.isCompleteWord) {
		$tw.utils.pushTop(childNode.values, value);
	}

	return childNode;
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