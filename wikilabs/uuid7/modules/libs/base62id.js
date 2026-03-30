/*\
title: $:/plugins/wikilabs/uuid7/base62id.js
type: application/javascript
module-type: library

Base62id Encoder / Decoder
============================
Encodes and decodes 128-bit values (UUID v7) using Base62id encoding.
Based on https://github.com/sergeyprokhorenko/Base62id

The encoding adds a 2-bit prefix (binary 10) to the 128-bit value,
producing a 130-bit number that always encodes to exactly 22 characters.
The first character is always an uppercase letter (A-L).

Alphabet: 0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz
This is ASCII-sorted, so lexicographic order = numeric order.

Public API:
	encode(bytes)             → string  (22-char Base62id)
	decode(str)               → Uint8Array(16)
	fromUUID(uuidHex)         → string  (22-char Base62id)
	toUUID(b62)               → string  (UUID hex with hyphens)
	isValidB62(str)           → boolean
	extractTimestampMs(b62)   → number | null

Standalone — no TiddlyWiki dependencies.

\*/

"use strict";

// ---------------------------------------------------------------------------
// Base62id alphabet (ASCII-sorted: 0-9 A-Z a-z)
// ---------------------------------------------------------------------------

var ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
var BASE = 62;
var ENCODED_LENGTH = 22;

// Decoding map
var DECODE_MAP = Object.create(null);
(function() {
	for(var i = 0; i < ALPHABET.length; i++) {
		DECODE_MAP[ALPHABET[i]] = i;
	}
})();

// ---------------------------------------------------------------------------
// Big number arithmetic using arrays of 16-bit values (little-endian)
// ---------------------------------------------------------------------------

// Multiply big number by scalar, add carry
function bigMulAdd(num, mul, add) {
	var carry = add;
	for(var i = 0; i < num.length; i++) {
		var v = num[i] * mul + carry;
		num[i] = v & 0xFFFF;
		carry = (v >>> 16);
	}
	while(carry > 0) {
		num.push(carry & 0xFFFF);
		carry = carry >>> 16;
	}
}

// Divide big number by divisor, return remainder
function bigDivMod(num, divisor) {
	var remainder = 0;
	for(var i = num.length - 1; i >= 0; i--) {
		var v = (remainder << 16) | num[i];
		num[i] = (v / divisor) >>> 0;
		remainder = v % divisor;
	}
	// Trim leading zeros
	while(num.length > 1 && num[num.length - 1] === 0) {
		num.pop();
	}
	return remainder;
}

// Check if big number is zero
function bigIsZero(num) {
	return num.length === 1 && num[0] === 0;
}

// ---------------------------------------------------------------------------
// Encode: 16-byte Uint8Array → 22-char Base62id string
// ---------------------------------------------------------------------------

function encode(bytes) {
	if(!bytes || bytes.length !== 16) {
		throw new Error("encode expects a 16-byte Uint8Array");
	}

	// Build big number from bytes (big-endian) with 2-bit prefix (binary 10 = decimal 2)
	// N = (2 << 128) + D
	// Start with prefix value 2
	var num = [2];

	// Shift left by 128 bits and add each byte
	for(var i = 0; i < 16; i++) {
		bigMulAdd(num, 256, bytes[i]);
	}

	// Convert to base 62
	var chars = [];
	while(!bigIsZero(num)) {
		var rem = bigDivMod(num, BASE);
		chars.push(ALPHABET[rem]);
	}

	// Reverse (we built it LSB-first)
	chars.reverse();

	// Pad to 22 chars (should always be 22 with prefix, but safety)
	while(chars.length < ENCODED_LENGTH) {
		chars.unshift("0");
	}

	return chars.join("");
}

// ---------------------------------------------------------------------------
// Decode: 22-char Base62id string → 16-byte Uint8Array
// ---------------------------------------------------------------------------

function decode(str) {
	if(!str || str.length !== ENCODED_LENGTH) {
		throw new Error("decode expects a 22-character Base62id string");
	}

	// Convert from base 62 to big number
	var num = [0];
	for(var i = 0; i < str.length; i++) {
		var val = DECODE_MAP[str[i]];
		if(val === undefined) {
			throw new Error("invalid Base62id character: " + str[i]);
		}
		bigMulAdd(num, BASE, val);
	}

	// Extract 16 bytes (big-endian), discarding the 2-bit prefix
	// N mod 2^128 = D (the original 128-bit value)
	var bytes = new Uint8Array(16);
	for(var j = 15; j >= 0; j--) {
		var rem = bigDivMod(num, 256);
		bytes[j] = rem;
	}

	return bytes;
}

// ---------------------------------------------------------------------------
// Convert: UUID hex string ↔ Base62id
// ---------------------------------------------------------------------------

function fromUUID(uuidHex) {
	var hex = uuidHex.replace(/-/g, "");
	if(hex.length !== 32 || !/^[0-9a-fA-F]{32}$/.test(hex)) {
		throw new Error("fromUUID expects a 32-hex-char UUID string");
	}
	var bytes = new Uint8Array(16);
	for(var i = 0; i < 16; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	return encode(bytes);
}

function toUUID(b62) {
	var bytes = decode(b62);
	var hex = Array.from(bytes).map(function(x) {
		return ("0" + x.toString(16)).slice(-2);
	}).join("");
	return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
		hex.slice(16, 20) + "-" + hex.slice(20);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

var B62_RE = /^[0-9A-Za-z]{22}$/;

function isValidB62(str) {
	if(!str || typeof str !== "string") { return false; }
	return B62_RE.test(str);
}

// ---------------------------------------------------------------------------
// Timestamp extraction from Base62id
// ---------------------------------------------------------------------------

function extractTimestampMs(b62) {
	if(!isValidB62(b62)) { return null; }
	// Decode to bytes, extract timestamp from first 6 bytes (same as UUID v7)
	var bytes;
	try {
		bytes = decode(b62);
	} catch(e) {
		return null;
	}
	// 48-bit timestamp from bytes 0-5 (big-endian)
	var hi = (bytes[0] * 0x100000000 + bytes[1] * 0x1000000 +
		bytes[2] * 0x10000 + bytes[3] * 0x100 + bytes[4]);
	var lo = bytes[5];
	// Reconstruct: hi already has bytes 0-4, need to combine with byte 5
	var ms = bytes[0] * 0x10000000000 +
		bytes[1] * 0x100000000 +
		bytes[2] * 0x1000000 +
		bytes[3] * 0x10000 +
		bytes[4] * 0x100 +
		bytes[5];
	return ms;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

exports.encode = encode;
exports.decode = decode;
exports.fromUUID = fromUUID;
exports.toUUID = toUUID;
exports.isValidB62 = isValidB62;
exports.extractTimestampMs = extractTimestampMs;
