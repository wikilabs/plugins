/*\
title: $:/plugins/wikilabs/uuid7/creator.js
type: application/javascript
module-type: library

UUID v7 Creator
===============
Standalone UUID v7 generator library. Does NOT depend on the phrase library —
it can be used independently.

Public API:
	generateUUIDv7([ms])      → string (new UUID v7; optional ms timestamp)
	generateUUIDv7Bytes([ms]) → Uint8Array(16) (raw bytes)
	isValidV7(uuidStr)       → boolean
	extractTimestampMs(uuid)  → number | null (Unix ms)
	msToISO(ms)               → string (ISO 8601 UTC)
	toUUIDString(bytes)       → string (UUID from 16-byte array)

\*/

"use strict";

// ---------------------------------------------------------------------------
// Core UUID v7 generation
// ---------------------------------------------------------------------------

/**
 * Generate UUID v7 raw bytes (16-byte Uint8Array).
 * Uses crypto.getRandomValues when available, falls back to Math.random.
 * @param {number} [ms] - Optional Unix ms timestamp. Defaults to Date.now().
 */
function generateUUIDv7Bytes(ms) {
	if(ms === undefined) { ms = Date.now(); }
	var b = new Uint8Array(16);

	// bytes 0-5: 48-bit Unix ms timestamp, big-endian
	b[0] = (ms / 0x10000000000) & 0xff;
	b[1] = (ms / 0x100000000)   & 0xff;
	b[2] = (ms / 0x1000000)     & 0xff;
	b[3] = (ms / 0x10000)       & 0xff;
	b[4] = (ms / 0x100)         & 0xff;
	b[5] =  ms                  & 0xff;

	// bytes 6-15: random
	if(typeof crypto !== "undefined" && crypto.getRandomValues) {
		var rnd = new Uint8Array(10);
		crypto.getRandomValues(rnd);
		for(var i = 0; i < 10; i++) { b[6 + i] = rnd[i]; }
	} else {
		for(var j = 6; j < 16; j++) { b[j] = Math.floor(Math.random() * 256); }
	}

	// byte 6: version nibble 0x7 in high 4 bits
	b[6] = 0x70 | (b[6] & 0x0f);

	// byte 8: variant bits 0b10 in high 2 bits
	b[8] = 0x80 | (b[8] & 0x3f);

	return b;
}

/**
 * Generate a UUID v7 string.
 * @param {number} [ms] - Optional Unix ms timestamp. Defaults to Date.now().
 */
function generateUUIDv7(ms) {
	return toUUIDString(generateUUIDv7Bytes(ms));
}

/**
 * Format a 16-byte Uint8Array as a UUID string.
 */
function toUUIDString(b) {
	var h = Array.from(b).map(function(x) {
		return ("0" + x.toString(16)).slice(-2);
	}).join("");
	return h.slice(0,8) + "-" + h.slice(8,12) + "-" + h.slice(12,16) + "-" +
				h.slice(16,20) + "-" + h.slice(20);
}

// ---------------------------------------------------------------------------
// Timestamp extraction
// ---------------------------------------------------------------------------

var UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Returns true if uuidStr is a structurally valid UUID v7.
 */
function isValidV7(uuidStr) {
	return UUID_V7_RE.test(uuidStr);
}

/**
 * Extract the 48-bit Unix timestamp (ms) from a UUID v7 string.
 * Returns a number, or null if the input is not a valid UUID v7.
 *
 * NOTE: JavaScript's number type can represent integers exactly up to 2^53,
 * which comfortably covers 48-bit timestamps (max ~281 trillion ms ≈ year 10889).
 */
function extractTimestampMs(uuidStr) {
	if(!isValidV7(uuidStr)) { return null; }
	var hex = uuidStr.replace(/-/g, "").slice(0, 12); // first 48 bits = 12 hex chars
	// Parse as two 32-bit halves to avoid precision loss
	var hi = parseInt(hex.slice(0, 8), 16); // upper 32 bits
	var lo = parseInt(hex.slice(8, 12), 16); // lower 16 bits
	return hi * 0x10000 + lo;
}

/**
 * Format a Unix ms timestamp as ISO 8601 UTC string.
 * Returns "YYYY-MM-DDTHH:mm:ss.sssZ"
 */
function msToISO(ms) {
	return new Date(ms).toISOString();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

exports.generateUUIDv7 = generateUUIDv7;
exports.generateUUIDv7Bytes = generateUUIDv7Bytes;
exports.toUUIDString = toUUIDString;
exports.isValidV7 = isValidV7;
exports.extractTimestampMs = extractTimestampMs;
exports.msToISO = msToISO;
