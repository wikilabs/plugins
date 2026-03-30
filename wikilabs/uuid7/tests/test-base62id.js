/*
 * Tests for $:/plugins/wikilabs/uuid7/base62id.js
 *
 * Run: node --test plugins/wikilabs/uuid7/tests/test-base62id.js
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");

var b62 = require(path.resolve(__dirname, "../modules/libs/base62id.js"));
var creator = require(path.resolve(__dirname, "../modules/libs/creator.js"));
var c32lib = require(path.resolve(__dirname, "../modules/libs/crockford32.js"));

// ---------------------------------------------------------------------------
// encode / decode roundtrip
// ---------------------------------------------------------------------------

test("encode returns a 22-character string", function() {
	var bytes = new Uint8Array(16);
	assert.strictEqual(b62.encode(bytes).length, 22);
});

test("encode uses only valid Base62id characters", function() {
	var bytes = new Uint8Array(16).fill(0xff);
	var encoded = b62.encode(bytes);
	assert.match(encoded, /^[0-9A-Za-z]+$/);
});

test("encode/decode roundtrip — all zeros", function() {
	var bytes = new Uint8Array(16);
	var decoded = b62.decode(b62.encode(bytes));
	assert.deepStrictEqual(decoded, bytes);
});

test("encode/decode roundtrip — all ones", function() {
	var bytes = new Uint8Array(16).fill(0xff);
	var decoded = b62.decode(b62.encode(bytes));
	assert.deepStrictEqual(decoded, bytes);
});

test("encode/decode roundtrip — random UUIDs", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		var b62str = b62.fromUUID(uuid);
		var back = b62.toUUID(b62str);
		assert.strictEqual(back, uuid.toLowerCase(),
			"roundtrip failed for: " + uuid);
	}
});

test("first character is always uppercase letter (A-L)", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		var b62str = b62.fromUUID(uuid);
		assert.match(b62str[0], /[A-L]/,
			"first char should be A-L, got: " + b62str[0] + " for " + b62str);
	}
});

test("all zeros produces 22-char string with uppercase first char", function() {
	var bytes = new Uint8Array(16);
	var encoded = b62.encode(bytes);
	assert.strictEqual(encoded.length, 22);
	assert.match(encoded[0], /[A-Z]/, "first char should be uppercase");
});

// ---------------------------------------------------------------------------
// Sortability
// ---------------------------------------------------------------------------

test("lexicographic sort matches chronological order", function() {
	var encoded = [];
	for(var i = 0; i < 100; i++) {
		var ms = 1700000000000 + i * 1000;
		var uuid = creator.generateUUIDv7(ms);
		encoded.push(b62.fromUUID(uuid));
	}
	var sorted = encoded.slice().sort();
	for(var j = 0; j < encoded.length; j++) {
		assert.strictEqual(sorted[j], encoded[j],
			"sort mismatch at index " + j);
	}
});

// ---------------------------------------------------------------------------
// fromUUID / toUUID
// ---------------------------------------------------------------------------

test("fromUUID produces valid Base62id", function() {
	var uuid = creator.generateUUIDv7();
	var result = b62.fromUUID(uuid);
	assert.ok(b62.isValidB62(result));
});

test("toUUID returns valid UUID v7", function() {
	var uuid = creator.generateUUIDv7();
	var b62str = b62.fromUUID(uuid);
	var back = b62.toUUID(b62str);
	assert.ok(creator.isValidV7(back));
});

test("fromUUID/toUUID roundtrip 100 UUIDs", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		assert.strictEqual(b62.toUUID(b62.fromUUID(uuid)), uuid.toLowerCase());
	}
});

test("fromUUID throws on invalid hex", function() {
	assert.throws(function() { b62.fromUUID("not-a-uuid"); });
});

// ---------------------------------------------------------------------------
// Cross-format consistency
// ---------------------------------------------------------------------------

test("Base62id and Crockford32 decode to same bytes", function() {
	for(var i = 0; i < 50; i++) {
		var uuid = creator.generateUUIDv7();
		var b62str = b62.fromUUID(uuid);
		var c32str = c32lib.fromUUID(uuid);
		var b62bytes = b62.decode(b62str);
		var c32bytes = c32lib.decode(c32str);
		assert.deepStrictEqual(b62bytes, c32bytes,
			"byte mismatch for " + uuid);
	}
});

// ---------------------------------------------------------------------------
// isValidB62
// ---------------------------------------------------------------------------

test("isValidB62 accepts valid 22-char string", function() {
	var uuid = creator.generateUUIDv7();
	assert.ok(b62.isValidB62(b62.fromUUID(uuid)));
});

test("isValidB62 rejects wrong length", function() {
	assert.ok(!b62.isValidB62("ABC"));
	assert.ok(!b62.isValidB62(""));
	assert.ok(!b62.isValidB62("A234567890123456789012345"));
});

test("isValidB62 rejects special characters", function() {
	assert.ok(!b62.isValidB62("A234567890123456789-+!"));
});

test("isValidB62 rejects null/undefined", function() {
	assert.ok(!b62.isValidB62(null));
	assert.ok(!b62.isValidB62(undefined));
});

// ---------------------------------------------------------------------------
// extractTimestampMs
// ---------------------------------------------------------------------------

test("extractTimestampMs matches creator.extractTimestampMs", function() {
	for(var i = 0; i < 50; i++) {
		var uuid = creator.generateUUIDv7();
		var expected = creator.extractTimestampMs(uuid);
		var b62str = b62.fromUUID(uuid);
		var actual = b62.extractTimestampMs(b62str);
		assert.strictEqual(actual, expected,
			"timestamp mismatch for " + uuid);
	}
});

test("extractTimestampMs with known timestamp", function() {
	var ms = 1710340000000;
	var uuid = creator.generateUUIDv7(ms);
	var b62str = b62.fromUUID(uuid);
	assert.strictEqual(b62.extractTimestampMs(b62str), ms);
});

test("extractTimestampMs returns null for invalid input", function() {
	assert.strictEqual(b62.extractTimestampMs("not-valid"), null);
	assert.strictEqual(b62.extractTimestampMs(""), null);
	assert.strictEqual(b62.extractTimestampMs(null), null);
});

// ---------------------------------------------------------------------------
// Decode error handling
// ---------------------------------------------------------------------------

test("decode throws on wrong length", function() {
	assert.throws(function() { b62.decode("ABC"); });
});

test("decode throws on invalid character", function() {
	assert.throws(function() { b62.decode("!@#$%^&*()_+!@#$%^&*()"); });
});

// ---------------------------------------------------------------------------
// Known vector: single byte values
// ---------------------------------------------------------------------------

test("roundtrip single byte value 1 at last position", function() {
	var bytes = new Uint8Array(16);
	bytes[15] = 1;
	assert.deepStrictEqual(b62.decode(b62.encode(bytes)), bytes);
});

test("roundtrip single byte value 1 at first position", function() {
	var bytes = new Uint8Array(16);
	bytes[0] = 1;
	assert.deepStrictEqual(b62.decode(b62.encode(bytes)), bytes);
});
