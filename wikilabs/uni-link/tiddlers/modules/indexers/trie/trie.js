/*\
title: $:/plugins/wikilabs/uni-link/indexers/trie.js
type: application/javascript
module-type: library

trie base class

\*/
(function(){
"use strict";

var TrieNode = require("$:/plugins/wikilabs/uni-link/indexers/trie-node.js").TrieNode;

// Character that we will use for trie tree root.
var HEAD_CHARACTER = '*';

function Trie()  {
	this.head = new TrieNode(HEAD_CHARACTER);
}

/**
 * @param {string} key
 * @param {string} value
 * @return {Trie}
 */
Trie.prototype.addWord = function(key, value) {
	var characters = Array.from(key);
	var currentNode = this.head;

	for (var charIndex = 0; charIndex < characters.length; charIndex += 1) {
		var isComplete = charIndex === characters.length - 1;
		currentNode = currentNode.addChild(characters[charIndex], isComplete, value);
	}

	return this;
}

/**
 * @param {string} key
 * @param {string} value		// eg tiddler title
 * @return {Trie}
 */
Trie.prototype.deleteWord = function(key, value) {
	var depthFirstDelete = function(currentNode) {
		var charIndex = 0;
		if (charIndex >= key.length) {
			// Return if we're trying to delete the character that is out of key's scope.
			return;
		}

		var character = key[charIndex];
		var nextNode = currentNode.getChild(character);

		if (nextNode == null) {
			// Return if we're trying to delete a key that has not been added to the Trie.
			return;
		}

		// Go deeper.
		depthFirstDelete(nextNode, charIndex + 1);

		// Since we're going to delete a key let's un-mark its last character isCompleteWord flag.
		if (charIndex === (key.length - 1)) {
			nextNode.isCompleteWord = false;
		}

		// childNode is deleted only if:
		// - childNode has NO children
		// - childNode.isCompleteWord === false
		currentNode.removeChild(character);				//TODO: It's possible that 2 aliases 
	};

	// Start depth-first deletion from the head node.
	depthFirstDelete(this.head);

	return this;
}

/**
 * @param {string} key
 * @return {string[]}
 */
Trie.prototype.suggestNextCharacters = function(key) {
	var lastCharacter = this.getLastCharacterNode(key);

	if (!lastCharacter) {
		return null;
	}

	return lastCharacter.suggestChildren();
}

/**
 * Check if complete key exists in Trie.
 *
 * @param {string} key
 * @return {boolean}
 */
Trie.prototype.doesWordExist = function(key) {
	var lastCharacter = this.getLastCharacterNode(key);

	return !!lastCharacter && lastCharacter.isCompleteWord;
}

/**
 * @param {string} key
 * @return {TrieNode}
 */
Trie.prototype.getLastCharacterNode = function(key) {
	var characters = Array.from(key);
	var currentNode = this.head;

	for (var charIndex = 0; charIndex < characters.length; charIndex += 1) {
		if (!currentNode.hasChild(characters[charIndex])) {
			return null;
		}

		currentNode = currentNode.getChild(characters[charIndex]);
	}

	return currentNode;
}

exports.Trie = Trie;

})();
