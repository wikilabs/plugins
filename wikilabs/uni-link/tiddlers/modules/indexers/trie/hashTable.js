/*\
title: $:/plugins/wikilabs/uni-link/indexers/hashtable.js
type: application/javascript
module-type: library

Using a JS object as hashtable
Wrapper to get "get, set..."

\*/
"use strict";

function HashTable()  {
	this.keys = Object.create(null);
}

/**
 * @param {string} key
 * @param {*} value
 */
HashTable.prototype.set = function(key, value) {
	this.keys[key] = value || undefined;
}

/**
 * @param {string} key
 * @return {*}
 */
HashTable.prototype.get = function(key) {
    return this.keys[key];
}

/**
 * @param {string} key
 * @return null
 */
HashTable.prototype.delete = function(key) {
	delete this.keys[key];
	return null;
}

/**
 * @param {string} key
 * @return {boolean}
 */
HashTable.prototype.has = function(key) {
	return Object.hasOwnProperty.call(this.keys, key);
}

/**
 * @return {string[]}
 */
HashTable.prototype.getKeys = function() {
	return Object.keys(this.keys);
}

/**
 * Gets the list of all the stored values in the hash table.
 *
 * @return {*[]}
 */
HashTable.prototype.getValues = function() {
	return "";
// return this.buckets.reduce((values, bucket) => {
// 	const bucketValues = bucket.toArray()
// 	.map((linkedListNode) => linkedListNode.value.value);
// 	return values.concat(bucketValues);
}

exports.HashTable = HashTable;
