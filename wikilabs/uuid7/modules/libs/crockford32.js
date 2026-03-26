/*\
title: $:/plugins/wikilabs/uuid7/crockford32.js
type: application/javascript
module-type: library

Crockford Base32 Encoder / Decoder
====================================
Encodes and decodes 128-bit values (UUID v7) using Douglas Crockford's
Base32 alphabet.  The encoded string is 26 characters long (5 bits each).

Display format: 6-4-12-4  (31 chars with hyphens)
Storage format: same as display (hyphens at fixed positions preserve sort)

Public API:
	encode(bytes)             → string  (26-char raw Crockford)
	decode(str)               → Uint8Array(16)
	format(raw)               → string  (6-4-12-4 with hyphens, 31 chars)
	unformat(formatted)       → string  (26-char raw, strips hyphens)
	checkSymbol(raw)          → string  (single check character, mod 37)
	fromUUID(uuidHex)         → string  (formatted c32 from UUID hex string)
	toUUID(c32)               → string  (UUID hex string from c32)
	isValidC32(str)           → boolean (accepts raw or formatted)
	extractTimestampMs(c32)   → number | null

Standalone — no TiddlyWiki dependencies.

\*/

"use strict";

// ---------------------------------------------------------------------------
// Crockford Base32 alphabet
// ---------------------------------------------------------------------------

var ENCODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Decoding map: case-insensitive, with I→1, L→1, O→0 aliases
var DECODE_MAP = Object.create(null);
(function() {
	for(var i = 0; i < ENCODE_ALPHABET.length; i++) {
		var ch = ENCODE_ALPHABET[i];
		DECODE_MAP[ch] = i;
		DECODE_MAP[ch.toLowerCase()] = i;
	}
	// Aliases for commonly confused characters
	DECODE_MAP["I"] = 1;  DECODE_MAP["i"] = 1;
	DECODE_MAP["L"] = 1;  DECODE_MAP["l"] = 1;
	DECODE_MAP["O"] = 0;  DECODE_MAP["o"] = 0;
})();

// Check symbol alphabet (values 0–36)
var CHECK_ALPHABET = ENCODE_ALPHABET + "*~$=U";

// ---------------------------------------------------------------------------
// Encode: 16-byte Uint8Array → 26-char Crockford string
// ---------------------------------------------------------------------------

function encode(bytes) {
	if(!bytes || bytes.length !== 16) {
		throw new Error("encode expects a 16-byte Uint8Array");
	}
	// Convert 128 bits to 26 × 5-bit groups (130 bits, 2 padding bits at MSB)
	// We treat the 16 bytes as a big-endian 128-bit integer and extract
	// 5-bit groups from the most significant end.
	//
	// 26 × 5 = 130 bits. The top 2 bits of the first character are always 0
	// for a 128-bit value (max first char value = 3).
	var result = new Array(26);
	// Work with the bytes as an array of bits, extracting 5-bit chunks.
	// Strategy: maintain a bit buffer fed from the byte array.
	var bitBuffer = 0;
	var bitsInBuffer = 0;
	var byteIndex = 0;
	var charIndex = 0;

	// We need to output 26 chars. First char uses only 3 bits from the data
	// (since 128 = 2 + 25×5 + 3, i.e., first group has 2 padding + 3 data bits).
	// Simpler approach: convert to a flat bit array, left-pad to 130 bits.

	// Extract all 128 bits
	var bits = new Array(130);
	bits[0] = 0;  // padding
	bits[1] = 0;  // padding
	for(var i = 0; i < 16; i++) {
		for(var j = 7; j >= 0; j--) {
			bits[2 + i * 8 + (7 - j)] = (bytes[i] >> j) & 1;
		}
	}

	// Group into 26 × 5-bit values
	for(var c = 0; c < 26; c++) {
		var offset = c * 5;
		var value = (bits[offset] << 4) |
					(bits[offset + 1] << 3) |
					(bits[offset + 2] << 2) |
					(bits[offset + 3] << 1) |
					bits[offset + 4];
		result[c] = ENCODE_ALPHABET[value];
	}

	return result.join("");
}

// ---------------------------------------------------------------------------
// Decode: Crockford string → 16-byte Uint8Array
// ---------------------------------------------------------------------------

function decode(str) {
	str = unformat(str);
	if(str.length !== 26) {
		throw new Error("decode expects a 26-character Crockford string");
	}

	// Convert 26 × 5-bit values → 130 bits → discard top 2 → 128 bits → 16 bytes
	var bits = new Array(130);
	for(var c = 0; c < 26; c++) {
		var val = DECODE_MAP[str[c]];
		if(val === undefined) {
			throw new Error("invalid Crockford character: " + str[c]);
		}
		var offset = c * 5;
		bits[offset]     = (val >> 4) & 1;
		bits[offset + 1] = (val >> 3) & 1;
		bits[offset + 2] = (val >> 2) & 1;
		bits[offset + 3] = (val >> 1) & 1;
		bits[offset + 4] = val & 1;
	}

	// Skip first 2 padding bits, take 128 bits → 16 bytes
	var bytes = new Uint8Array(16);
	for(var i = 0; i < 16; i++) {
		var b = 0;
		for(var j = 0; j < 8; j++) {
			b = (b << 1) | bits[2 + i * 8 + j];
		}
		bytes[i] = b;
	}

	return bytes;
}

// ---------------------------------------------------------------------------
// Format: raw 26 chars → 6-4-12-4 with hyphens (31 chars)
// ---------------------------------------------------------------------------

function format(raw) {
	raw = unformat(raw);
	return raw.slice(0, 6) + "-" + raw.slice(6, 10) + "-" +
		   raw.slice(10, 22) + "-" + raw.slice(22, 26);
}

// ---------------------------------------------------------------------------
// Unformat: strip hyphens (accepts raw, formatted, or mixed)
// ---------------------------------------------------------------------------

function unformat(str) {
	return str.replace(/-/g, "");
}

// ---------------------------------------------------------------------------
// Check symbol: mod 37 over the full 128-bit value
// ---------------------------------------------------------------------------

function checkSymbol(str) {
	str = unformat(str);
	if(str.length !== 26) {
		throw new Error("checkSymbol expects a 26-character Crockford string");
	}

	// Compute the 128-bit integer mod 37 using iterative modular arithmetic.
	// Process character by character: accum = (accum × 32 + charValue) mod 37
	var remainder = 0;
	for(var i = 0; i < 26; i++) {
		var val = DECODE_MAP[str[i]];
		if(val === undefined) {
			throw new Error("invalid Crockford character: " + str[i]);
		}
		remainder = (remainder * 32 + val) % 37;
	}

	return CHECK_ALPHABET[remainder];
}

// ---------------------------------------------------------------------------
// Convert: UUID hex string ↔ formatted c32
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
	return format(encode(bytes));
}

function toUUID(c32) {
	var bytes = decode(c32);
	var hex = Array.from(bytes).map(function(x) {
		return ("0" + x.toString(16)).slice(-2);
	}).join("");
	return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" +
		   hex.slice(16, 20) + "-" + hex.slice(20);
}

// ---------------------------------------------------------------------------
// Normalize: canonical uppercase with alias substitution (works on partials)
// ---------------------------------------------------------------------------

function normalize(str) {
	var result = [];
	for(var i = 0; i < str.length; i++) {
		var ch = str[i];
		if(ch === "-") {
			result.push("-");
			continue;
		}
		var val = DECODE_MAP[ch];
		if(val === undefined) { return null; }
		result.push(ENCODE_ALPHABET[val]);
	}
	return result.join("");
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Accept all letters that Crockford decoding allows (including I, L, O aliases).
// Only U is excluded (check-symbol only). Case-insensitive.
var C32_RAW_RE = /^[0-9a-tv-zA-TV-Z]{26}$/;
var C32_FMT_RE = /^[0-9a-tv-zA-TV-Z]{6}-[0-9a-tv-zA-TV-Z]{4}-[0-9a-tv-zA-TV-Z]{12}-[0-9a-tv-zA-TV-Z]{4}$/;

function isValidC32(str) {
	if(!str || typeof str !== "string") { return false; }
	return C32_RAW_RE.test(str) || C32_FMT_RE.test(str);
}

// ---------------------------------------------------------------------------
// Timestamp extraction from c32
// ---------------------------------------------------------------------------

function extractTimestampMs(c32) {
	if(!isValidC32(c32)) { return null; }
	var raw = unformat(c32);
	// First 10 Crockford chars = 50 bits. Top 48 bits are the timestamp.
	// Decode first 10 chars to get bits 0–49, then take bits 0–47.
	// Use iterative approach: accum = accum × 32 + charValue
	var accum = 0;
	for(var i = 0; i < 10; i++) {
		var val = DECODE_MAP[raw[i]];
		if(val === undefined) { return null; }
		accum = accum * 32 + val;
	}
	// accum holds the 50-bit value: 2 padding zeros (MSB) + 48 timestamp bits.
	// Since padding is always 0, accum IS the timestamp directly.
	return accum;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

exports.encode             = encode;
exports.decode             = decode;
exports.format             = format;
exports.unformat           = unformat;
exports.normalize          = normalize;
exports.checkSymbol        = checkSymbol;
exports.fromUUID           = fromUUID;
exports.toUUID             = toUUID;
exports.isValidC32         = isValidC32;
exports.extractTimestampMs = extractTimestampMs;
