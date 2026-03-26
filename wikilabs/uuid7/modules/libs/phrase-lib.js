/*\
title: $:/plugins/wikilabs/uuid7/phraselib.js
type: application/javascript
module-type: library

UUID v7 <-> Mnemonic Phrase Library
===================================
Encodes/decodes UUID v7 values to/from human-memorable adjective-noun-verb triplets.
Depends on: $:/plugins/wikilabs/uuid7/creator.js

UUID v7 layout (128 bits total):
	bits  0-47:  48-bit Unix timestamp in milliseconds        (variable)
	bits 48-51:  4-bit version = 0x7                         (fixed)
	bits 52-63:  12-bit random data                          (variable)
	bits 64-65:  2-bit variant = 0b10                        (fixed)
	bits 66-127: 62-bit random data                          (variable)

Total variable bits: 122
Fixed bits (version nibble + variant): 6

Encoding:
	- Uses a triplet wordlist: 32 adjectives x 32 verbs x 64 nouns = 65536 triplets.
	- Each triplet encodes 16 bits: 5 bits (adj) + 6 bits (noun) + 5 bits (verb).
	- 122 variable bits -> ceil(122/16) = 8 triplets (covers 128 bits, 6 padding bits).
	- The 6 fixed bits are NOT encoded (they are restored on decode).
	- Triplet index = adj_index << 11 | noun_index << 5 | verb_index.
	- Bit significance matches display order (left = most stable).

Display format:
	- "adjective noun verb" for natural English SVO order (e.g. "bold lion lurks").

Shortcode:
	- Triplets 1-2 of the phrase (index 0-1), the timestamp-based triplets.
	- Adjective of triplet 1 is stable for ~278 years, verb for ~8.7 years.
	- Provides a human-readable "when" grouping for tiddlers.

Wordlist:
	- Read from three tiddlers: $:/plugins/wikilabs/uuid7/wordlist/adjectives, nouns, verbs
	- One word per line in each tiddler.

Public API (exports):
	encodeUUID(uuidString)         -> { phrase: string[] } | { error }
	decodePhrase(phraseArray)      -> { uuid: string } | { error }
	shortcodeFromPhrase(phrase[])  -> string (triplets 1-2, comma-separated)
	getWordlist()                  -> { adjectives, verbs, nouns, ... } | null

\*/

"use strict";

/* global $tw */

var creator = require("$:/plugins/wikilabs/uuid7/creator.js");

// ---------------------------------------------------------------------------
// Wordlist loader
// ---------------------------------------------------------------------------

var _wordlist = null;
var ADJ_TIDDLER  = "$:/plugins/wikilabs/uuid7/wordlist/adjectives";
var NOUN_TIDDLER = "$:/plugins/wikilabs/uuid7/wordlist/nouns";
var VERB_TIDDLER = "$:/plugins/wikilabs/uuid7/wordlist/verbs";
var ADJ_COUNT = 32;    // 5 bits
var VERB_COUNT = 32;   // 5 bits
var NOUN_COUNT = 64;   // 6 bits
var TRIPLET_COUNT = 65536; // ADJ_COUNT * VERB_COUNT * NOUN_COUNT
var BITS_PER_TRIPLET = 16; // log2(65536)
var PHRASE_TRIPLETS = 8;   // ceil(122 / 16) = 8 (covers 128 bits; 6 padding bits)

/**
 * Load and cache the wordlist from the TiddlyWiki store.
 * Returns { adjectives, verbs, nouns, adjIndex, verbIndex, nounIndex } or null on failure.
 */
function getWordlist() {
	if(_wordlist !== null) {
		return _wordlist;
	}
	if(typeof $tw === "undefined" || !$tw.wiki) {
		return null;
	}
	function parseSection(str) {
		return str.split(/\r?\n/).map(function(w) { return w.trim().toLowerCase(); })
			.filter(function(w) { return w.length > 0; });
	}
	var adjText = $tw.wiki.getTiddlerText(ADJ_TIDDLER);
	var nounText = $tw.wiki.getTiddlerText(NOUN_TIDDLER);
	var verbText = $tw.wiki.getTiddlerText(VERB_TIDDLER);
	if(!adjText || !nounText || !verbText) {
		return null;
	}
	var adjectives = parseSection(adjText);
	var nouns = parseSection(nounText);
	var verbs = parseSection(verbText);
	if(adjectives.length !== ADJ_COUNT || verbs.length !== VERB_COUNT || nouns.length !== NOUN_COUNT) {
		return null;
	}
	function buildIndex(arr) {
		var idx = {};
		for(var i = 0; i < arr.length; i++) { idx[arr[i]] = i; }
		return idx;
	}
	_wordlist = {
		adjectives: adjectives,
		verbs: verbs,
		nouns: nouns,
		adjIndex: buildIndex(adjectives),
		verbIndex: buildIndex(verbs),
		nounIndex: buildIndex(nouns)
	};
	return _wordlist;
}

/**
 * Convert a 16-bit index to an "adjective noun verb" string.
 * Bit layout: [adj 5 bits] [noun 6 bits] [verb 5 bits]
 */
function indexToTriplet(idx, wl) {
	var ai = (idx >> 11) & 0x1F;  // bits 15-11
	var ni = (idx >> 5)  & 0x3F;  // bits 10-5
	var vi =  idx        & 0x1F;  // bits 4-0
	return wl.adjectives[ai] + " " + wl.nouns[ni] + " " + wl.verbs[vi];
}

/**
 * Convert an "adjective noun verb" string to a 16-bit index.
 * Returns -1 on failure.
 */
function tripletToIndex(triplet, wl) {
	var words = triplet.trim().toLowerCase().split(/\s+/);
	if(words.length === 2) {
		// Last triplet: adj + noun only (verb = 0)
		var ai = wl.adjIndex[words[0]];
		var ni = wl.nounIndex[words[1]];
		if(ai === undefined || ni === undefined) { return -1; }
		return (ai << 11) | (ni << 5);
	}
	if(words.length !== 3) {
		return -1;
	}
	var ai = wl.adjIndex[words[0]];
	var ni = wl.nounIndex[words[1]];
	var vi = wl.verbIndex[words[2]];
	if(ai === undefined || vi === undefined || ni === undefined) {
		return -1;
	}
	return (ai << 11) | (ni << 5) | vi;
}

// ---------------------------------------------------------------------------
// Bit manipulation helpers (pure JS, no BigInt required)
// ---------------------------------------------------------------------------

/**
 * Extract the 122 variable bits from a UUID v7 byte array.
 *
 * UUID bit layout:
 *   byte 0-5  -> bits 0-47   (timestamp, all variable)
 *   byte 6    -> bits 48-55  (high nibble = version 0x7, SKIP; low nibble = bits 52-55)
 *   byte 7    -> bits 56-63  (all variable, bits 56-63)
 *   byte 8    -> bits 64-71  (high 2 bits = variant 0b10, SKIP; low 6 bits = bits 66-71)
 *   bytes 9-15-> bits 72-127 (all variable)
 *
 * We extract: [ts48] [rand12] [rand62] = 122 bits total
 */
function extractVariableBits(bytes) {
	var bits = [];

	// Timestamp bits (bytes 0-5, 48 bits)
	for(var i = 0; i < 6; i++) {
		for(var b = 7; b >= 0; b--) {
			bits.push((bytes[i] >> b) & 1);
		}
	}

	// 12 random bits from bytes 6-7 (skip high nibble of byte 6 = version)
	for(var b2 = 3; b2 >= 0; b2--) {
		bits.push((bytes[6] >> b2) & 1);
	}
	for(var b3 = 7; b3 >= 0; b3--) {
		bits.push((bytes[7] >> b3) & 1);
	}

	// 62 random bits from bytes 8-15 (skip high 2 bits of byte 8 = variant)
	for(var b4 = 5; b4 >= 0; b4--) {
		bits.push((bytes[8] >> b4) & 1);
	}
	for(var i2 = 9; i2 < 16; i2++) {
		for(var b5 = 7; b5 >= 0; b5--) {
			bits.push((bytes[i2] >> b5) & 1);
		}
	}

	return bits;
}

/**
 * Restore a UUID v7 byte array from 122 variable bits.
 * Re-inserts the fixed version (0x7) and variant (0b10) bits.
 */
function restoreBytes(bits) {
	var bytes = new Array(16).fill(0);

	// Bytes 0-5: timestamp
	for(var i = 0; i < 6; i++) {
		var val = 0;
		for(var b = 0; b < 8; b++) {
			val = (val << 1) | bits[i * 8 + b];
		}
		bytes[i] = val;
	}

	// Byte 6: version nibble (0x7) + 4 random bits
	var b6rand = 0;
	for(var b2 = 0; b2 < 4; b2++) {
		b6rand = (b6rand << 1) | bits[48 + b2];
	}
	bytes[6] = 0x70 | b6rand;

	// Byte 7: 8 random bits
	var b7 = 0;
	for(var b3 = 0; b3 < 8; b3++) {
		b7 = (b7 << 1) | bits[52 + b3];
	}
	bytes[7] = b7;

	// Byte 8: variant bits (0b10) + 6 random bits
	var b8rand = 0;
	for(var b4 = 0; b4 < 6; b4++) {
		b8rand = (b8rand << 1) | bits[60 + b4];
	}
	bytes[8] = 0x80 | b8rand;

	// Bytes 9-15: 56 random bits
	for(var i2 = 9; i2 < 16; i2++) {
		var val2 = 0;
		for(var b5 = 0; b5 < 8; b5++) {
			val2 = (val2 << 1) | bits[66 + (i2 - 9) * 8 + b5];
		}
		bytes[i2] = val2;
	}

	return bytes;
}

/**
 * Convert UUID hex string to 16-byte array.
 */
function uuidToBytes(uuidStr) {
	var hex = uuidStr.replace(/-/g, "");
	var bytes = [];
	for(var i = 0; i < 16; i++) {
		bytes.push(parseInt(hex.slice(i * 2, i * 2 + 2), 16));
	}
	return bytes;
}

/**
 * Convert 16-byte array to UUID hex string.
 */
function bytesToUuid(bytes) {
	var h = bytes.map(function(x) {
		return ("0" + x.toString(16)).slice(-2);
	}).join("");
	return h.slice(0,8) + "-" + h.slice(8,12) + "-" + h.slice(12,16) + "-" +
				 h.slice(16,20) + "-" + h.slice(20);
}

/**
 * Pack 122 bits into 8 triplets (16 bits each = 128 bits; last 6 bits are padding zeros).
 */
function bitsToTriplets(bits, wl) {
	var padded = bits.slice();
	while(padded.length < PHRASE_TRIPLETS * BITS_PER_TRIPLET) {
		padded.push(0);
	}

	var triplets = [];
	for(var i = 0; i < PHRASE_TRIPLETS; i++) {
		var idx = 0;
		for(var b = 0; b < BITS_PER_TRIPLET; b++) {
			idx = (idx << 1) | padded[i * BITS_PER_TRIPLET + b];
		}
		if(i === PHRASE_TRIPLETS - 1) {
			// Last triplet: only adj + noun (verb is always padding zeros)
			var ai = (idx >> 11) & 0x1F;
			var ni = (idx >> 5)  & 0x3F;
			triplets.push(wl.adjectives[ai] + " " + wl.nouns[ni]);
		} else {
			triplets.push(indexToTriplet(idx, wl));
		}
	}
	return triplets;
}

/**
 * Unpack 8 triplets back to 122 bits (discarding 6 padding bits).
 */
function tripletsToBits(triplets, wl) {
	var bits = [];
	for(var t = 0; t < triplets.length; t++) {
		var idx = tripletToIndex(triplets[t], wl);
		if(idx < 0) {
			return { error: "Unknown triplet: '" + triplets[t] + "'" };
		}
		for(var b = BITS_PER_TRIPLET - 1; b >= 0; b--) {
			bits.push((idx >> b) & 1);
		}
	}

	return bits.slice(0, 122);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Encode a UUID v7 string to 8 adjective-noun-verb triplets.
 */
function encodeUUID(uuidStr) {
	if(!creator.isValidV7(uuidStr)) {
		return { error: "Not a valid UUID v7: " + uuidStr };
	}
	var wl = getWordlist();
	if(!wl) {
		return { error: "Wordlist not available. Check wordlist tiddlers." };
	}

	var bytes = uuidToBytes(uuidStr);
	var bits = extractVariableBits(bytes);
	var phrase = bitsToTriplets(bits, wl);

	return { phrase: phrase };
}

/**
 * Decode 8 adjective-noun-verb triplets back to a UUID v7 string.
 */
function decodePhrase(phraseArray) {
	if(!Array.isArray(phraseArray) || phraseArray.length !== PHRASE_TRIPLETS) {
		return { error: "Phrase must be exactly " + PHRASE_TRIPLETS + " triplets (got " +
						(Array.isArray(phraseArray) ? phraseArray.length : "non-array") + ")" };
	}
	var wl = getWordlist();
	if(!wl) {
		return { error: "Wordlist not available. Check wordlist tiddlers." };
	}

	var result = tripletsToBits(phraseArray, wl);
	if(result.error) {
		return result;
	}
	var bytes = restoreBytes(result);
	return { uuid: bytesToUuid(bytes) };
}

/**
 * Extract the shortcode (triplets 1-2, timestamp-based) from a full phrase.
 */
function shortcodeFromPhrase(phraseArray) {
	return phraseArray[0] + ", " + phraseArray[1];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

exports.encodeUUID       = encodeUUID;
exports.decodePhrase     = decodePhrase;
exports.shortcodeFromPhrase = shortcodeFromPhrase;
exports.getWordlist      = getWordlist;

exports.PHRASE_TRIPLETS  = PHRASE_TRIPLETS;
exports.TRIPLET_COUNT    = TRIPLET_COUNT;
exports.ADJ_TIDDLER  = ADJ_TIDDLER;
exports.NOUN_TIDDLER = NOUN_TIDDLER;
exports.VERB_TIDDLER = VERB_TIDDLER;
