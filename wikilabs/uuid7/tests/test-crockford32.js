/*
 * Tests for $:/plugins/wikilabs/uuid7/crockford32.js
 *
 * Run: node --test plugins/wikilabs/uuid7/tests/test-crockford32.js
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");

var c32 = require(path.resolve(__dirname, "../modules/libs/crockford32.js"));
var creator = require(path.resolve(__dirname, "../modules/libs/creator.js"));

// ---------------------------------------------------------------------------
// encode / decode roundtrip
// ---------------------------------------------------------------------------

test("encode returns a 26-character string", function() {
	var bytes = new Uint8Array(16);
	assert.strictEqual(c32.encode(bytes).length, 26);
});

test("encode uses only valid Crockford characters", function() {
	var bytes = new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
		0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
	var encoded = c32.encode(bytes);
	assert.match(encoded, /^[0-9A-TV-Z]+$/);
});

test("encode/decode roundtrip — all zeros", function() {
	var bytes = new Uint8Array(16);
	var decoded = c32.decode(c32.encode(bytes));
	assert.deepStrictEqual(decoded, bytes);
});

test("encode/decode roundtrip — all ones", function() {
	var bytes = new Uint8Array(16).fill(0xff);
	var decoded = c32.decode(c32.encode(bytes));
	assert.deepStrictEqual(decoded, bytes);
});

test("encode/decode roundtrip — random UUIDs", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		var c32str = c32.fromUUID(uuid);
		var back = c32.toUUID(c32str);
		assert.strictEqual(back, uuid.toLowerCase(),
			"roundtrip failed for: " + uuid);
	}
});

test("encode all zeros produces all '0' characters", function() {
	var bytes = new Uint8Array(16);
	assert.strictEqual(c32.encode(bytes), "00000000000000000000000000");
});

test("encode all 0xff produces 7ZZZ...Z", function() {
	var bytes = new Uint8Array(16).fill(0xff);
	// 128 bits all 1 → 130 bits with 2 padding zeros → first char = 00111 = 7
	// remaining 25 chars all = 11111 = Z
	assert.strictEqual(c32.encode(bytes), "7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
});

test("decode throws on wrong length", function() {
	assert.throws(function() { c32.decode("ABC"); });
});

test("decode throws on invalid character", function() {
	assert.throws(function() { c32.decode("UUUUUUUUUUUUUUUUUUUUUUUUUU"); });
});

test("encode throws on wrong byte length", function() {
	assert.throws(function() { c32.encode(new Uint8Array(15)); });
	assert.throws(function() { c32.encode(new Uint8Array(17)); });
});

// ---------------------------------------------------------------------------
// Case-insensitive decoding with aliases
// ---------------------------------------------------------------------------

test("decode is case-insensitive", function() {
	var bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
	var encoded = c32.encode(bytes);
	var lower = c32.decode(encoded.toLowerCase());
	var upper = c32.decode(encoded.toUpperCase());
	assert.deepStrictEqual(lower, upper);
	assert.deepStrictEqual(lower, bytes);
});

test("decode accepts I/i as 1", function() {
	// Replace all '1' with 'I' and decode should give same result
	var bytes = new Uint8Array([0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10,
		0x84, 0x21, 0x08, 0x42, 0x10, 0x84, 0x21, 0x00]);
	var encoded = c32.encode(bytes);
	if(encoded.indexOf("1") >= 0) {
		var aliased = encoded.replace(/1/g, "I");
		assert.deepStrictEqual(c32.decode(aliased), bytes);
	}
});

test("decode accepts L/l as 1", function() {
	var bytes = new Uint8Array([0x08, 0x42, 0x10, 0x84, 0x21, 0x08, 0x42, 0x10,
		0x84, 0x21, 0x08, 0x42, 0x10, 0x84, 0x21, 0x00]);
	var encoded = c32.encode(bytes);
	if(encoded.indexOf("1") >= 0) {
		var aliased = encoded.replace(/1/g, "L");
		assert.deepStrictEqual(c32.decode(aliased), bytes);
	}
});

test("decode accepts O/o as 0", function() {
	var bytes = new Uint8Array(16);
	var encoded = c32.encode(bytes); // all zeros
	var aliased = encoded.replace(/0/g, "O");
	assert.deepStrictEqual(c32.decode(aliased), bytes);
});

// ---------------------------------------------------------------------------
// format / unformat
// ---------------------------------------------------------------------------

test("format produces 6-4-12-4 layout", function() {
	var raw = "0CA4MA4C7YFW2DN1TR3S7J14DB";
	var formatted = c32.format(raw);
	assert.strictEqual(formatted, "0CA4MA-4C7Y-FW2DN1TR3S7J-14DB");
});

test("format output is 29 characters (6-4-12-4 + 3 hyphens)", function() {
	var bytes = new Uint8Array(16);
	var formatted = c32.format(c32.encode(bytes));
	assert.strictEqual(formatted.length, 29);
});

test("unformat strips hyphens", function() {
	assert.strictEqual(c32.unformat("0CA4MA-4C7Y-FW2DN1TR3S7J-14DB"), "0CA4MA4C7YFW2DN1TR3S7J14DB");
});

test("unformat on raw string is a no-op", function() {
	var raw = "0CA4MA4C7YFW2DN1TR3S7J14DB";
	assert.strictEqual(c32.unformat(raw), raw);
});

test("format/unformat roundtrip", function() {
	var raw = "0CA4MA4C7YFW2DN1TR3S7J14DB";
	assert.strictEqual(c32.unformat(c32.format(raw)), raw);
});

test("decode accepts formatted input (with hyphens)", function() {
	var bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
	var raw = c32.encode(bytes);
	var formatted = c32.format(raw);
	assert.deepStrictEqual(c32.decode(formatted), bytes);
});

// ---------------------------------------------------------------------------
// Sortability
// ---------------------------------------------------------------------------

test("lexicographic sort of c32 matches chronological order", function() {
	var timestamps = [];
	var encoded = [];
	for(var i = 0; i < 100; i++) {
		var ms = 1700000000000 + i * 1000; // 1 second apart
		timestamps.push(ms);
		var uuid = creator.generateUUIDv7(ms);
		encoded.push(c32.fromUUID(uuid));
	}
	var sorted = encoded.slice().sort();
	for(var j = 0; j < encoded.length; j++) {
		assert.strictEqual(sorted[j], encoded[j],
			"sort mismatch at index " + j + ": expected " + encoded[j] + ", got " + sorted[j]);
	}
});

test("formatted c32 sort matches raw c32 sort", function() {
	var items = [];
	for(var i = 0; i < 50; i++) {
		var ms = 1700000000000 + i * 60000;
		var uuid = creator.generateUUIDv7(ms);
		items.push(c32.fromUUID(uuid));
	}
	var sortedFormatted = items.slice().sort();
	var sortedRaw = items.map(c32.unformat).sort().map(c32.format);
	assert.deepStrictEqual(sortedFormatted, sortedRaw);
});

// ---------------------------------------------------------------------------
// Check symbol
// ---------------------------------------------------------------------------

test("checkSymbol returns a single character", function() {
	var raw = c32.encode(new Uint8Array(16));
	var sym = c32.checkSymbol(raw);
	assert.strictEqual(sym.length, 1);
});

test("checkSymbol is from the extended alphabet (0-9 A-Z * ~ $ = U)", function() {
	var validChars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U";
	for(var i = 0; i < 50; i++) {
		var uuid = creator.generateUUIDv7();
		var raw = c32.unformat(c32.fromUUID(uuid));
		var sym = c32.checkSymbol(raw);
		assert.ok(validChars.indexOf(sym) >= 0,
			"check symbol '" + sym + "' not in valid set");
	}
});

test("checkSymbol for all zeros is '0'", function() {
	var raw = c32.encode(new Uint8Array(16));
	// value is 0, 0 mod 37 = 0, CHECK_ALPHABET[0] = '0'
	assert.strictEqual(c32.checkSymbol(raw), "0");
});

test("checkSymbol changes when input changes", function() {
	var bytes1 = new Uint8Array(16);
	var bytes2 = new Uint8Array(16);
	bytes2[15] = 1;
	var sym1 = c32.checkSymbol(c32.encode(bytes1));
	var sym2 = c32.checkSymbol(c32.encode(bytes2));
	assert.notStrictEqual(sym1, sym2);
});

test("checkSymbol accepts formatted input", function() {
	var uuid = creator.generateUUIDv7();
	var formatted = c32.fromUUID(uuid);
	var raw = c32.unformat(formatted);
	assert.strictEqual(c32.checkSymbol(formatted), c32.checkSymbol(raw));
});

// ---------------------------------------------------------------------------
// fromUUID / toUUID
// ---------------------------------------------------------------------------

test("fromUUID produces valid c32", function() {
	var uuid = creator.generateUUIDv7();
	var result = c32.fromUUID(uuid);
	assert.ok(c32.isValidC32(result), "fromUUID output should be valid c32: " + result);
});

test("fromUUID returns formatted (6-4-12-4)", function() {
	var uuid = creator.generateUUIDv7();
	var result = c32.fromUUID(uuid);
	assert.match(result, /^[0-9A-TV-Z]{6}-[0-9A-TV-Z]{4}-[0-9A-TV-Z]{12}-[0-9A-TV-Z]{4}$/);
});

test("toUUID returns valid UUID v7", function() {
	var uuid = creator.generateUUIDv7();
	var c32str = c32.fromUUID(uuid);
	var back = c32.toUUID(c32str);
	assert.ok(creator.isValidV7(back), "toUUID should return valid UUID: " + back);
});

test("fromUUID/toUUID roundtrip", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		assert.strictEqual(c32.toUUID(c32.fromUUID(uuid)), uuid.toLowerCase());
	}
});

test("fromUUID throws on invalid hex", function() {
	assert.throws(function() { c32.fromUUID("not-a-uuid"); });
	assert.throws(function() { c32.fromUUID("zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz"); });
});

test("toUUID accepts raw c32", function() {
	var uuid = creator.generateUUIDv7();
	var raw = c32.unformat(c32.fromUUID(uuid));
	assert.strictEqual(c32.toUUID(raw), uuid.toLowerCase());
});

// ---------------------------------------------------------------------------
// isValidC32
// ---------------------------------------------------------------------------

test("isValidC32 accepts raw 26-char string", function() {
	assert.ok(c32.isValidC32("0CA4MA4C7YFW2DN1TR3S7J14DB"));
});

test("isValidC32 accepts formatted 6-4-12-4 string", function() {
	assert.ok(c32.isValidC32("0CA4MA-4C7Y-FW2DN1TR3S7J-14DB"));
});

test("isValidC32 accepts forgiving aliases (I→1, L→1, O→0)", function() {
	// Crockford spec: I, L, O are accepted as aliases during decoding
	assert.ok(c32.isValidC32("IIIIIIIIIIIIIIIIIIIIIIIIII"), "I should be accepted (alias for 1)");
	assert.ok(c32.isValidC32("LLLLLLLLLLLLLLLLLLLLLLLLLL"), "L should be accepted (alias for 1)");
	assert.ok(c32.isValidC32("OOOOOOOOOOOOOOOOOOOOOOOOOO"), "O should be accepted (alias for 0)");
});

test("isValidC32 rejects U (check symbol only)", function() {
	assert.ok(!c32.isValidC32("UUUUUUUUUUUUUUUUUUUUUUUUUU"), "U should be rejected");
});

test("isValidC32 rejects wrong length", function() {
	assert.ok(!c32.isValidC32("0CA4MA"));
	assert.ok(!c32.isValidC32(""));
	assert.ok(!c32.isValidC32("0CA4MA4C7YFW2DN1TR3S7J14DB00"));
});

test("isValidC32 rejects null/undefined", function() {
	assert.ok(!c32.isValidC32(null));
	assert.ok(!c32.isValidC32(undefined));
	assert.ok(!c32.isValidC32(123));
});

test("isValidC32 accepts generated c32 values", function() {
	for(var i = 0; i < 50; i++) {
		var uuid = creator.generateUUIDv7();
		var result = c32.fromUUID(uuid);
		assert.ok(c32.isValidC32(result), "should be valid: " + result);
	}
});

// ---------------------------------------------------------------------------
// extractTimestampMs
// ---------------------------------------------------------------------------

test("extractTimestampMs matches creator.extractTimestampMs", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		var expected = creator.extractTimestampMs(uuid);
		var c32str = c32.fromUUID(uuid);
		var actual = c32.extractTimestampMs(c32str);
		assert.strictEqual(actual, expected,
			"timestamp mismatch for " + uuid + " → " + c32str);
	}
});

test("extractTimestampMs with known timestamp", function() {
	var ms = 1710340000000; // 2024-03-13T...
	var uuid = creator.generateUUIDv7(ms);
	var c32str = c32.fromUUID(uuid);
	assert.strictEqual(c32.extractTimestampMs(c32str), ms);
});

test("extractTimestampMs accepts raw c32", function() {
	var uuid = creator.generateUUIDv7();
	var formatted = c32.fromUUID(uuid);
	var raw = c32.unformat(formatted);
	assert.strictEqual(c32.extractTimestampMs(raw), c32.extractTimestampMs(formatted));
});

test("extractTimestampMs returns null for invalid input", function() {
	assert.strictEqual(c32.extractTimestampMs("not-valid"), null);
	assert.strictEqual(c32.extractTimestampMs(""), null);
	assert.strictEqual(c32.extractTimestampMs(null), null);
});

// ---------------------------------------------------------------------------
// Known test vector: all zeros
// ---------------------------------------------------------------------------

test("known vector — all-zero UUID", function() {
	var uuid = "00000000-0000-0000-0000-000000000000";
	var hex = uuid.replace(/-/g, "");
	var bytes = new Uint8Array(16);
	for(var i = 0; i < 16; i++) {
		bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
	}
	var raw = c32.encode(bytes);
	assert.strictEqual(raw, "00000000000000000000000000");
	assert.strictEqual(c32.format(raw), "000000-0000-000000000000-0000");
});

// ---------------------------------------------------------------------------
// Known test vector: max value (all 0xff)
// ---------------------------------------------------------------------------

test("known vector — all-0xff bytes", function() {
	var bytes = new Uint8Array(16).fill(0xff);
	var raw = c32.encode(bytes);
	assert.strictEqual(raw, "7ZZZZZZZZZZZZZZZZZZZZZZZZZ");
	var decoded = c32.decode(raw);
	assert.deepStrictEqual(decoded, bytes);
});

// ---------------------------------------------------------------------------
// Byte value 1 — verify bit alignment
// ---------------------------------------------------------------------------

test("known vector — single byte value 1 at last position", function() {
	var bytes = new Uint8Array(16);
	bytes[15] = 1;
	var raw = c32.encode(bytes);
	var decoded = c32.decode(raw);
	assert.deepStrictEqual(decoded, bytes);
});

test("known vector — single byte value 1 at first position", function() {
	var bytes = new Uint8Array(16);
	bytes[0] = 1;
	var raw = c32.encode(bytes);
	var decoded = c32.decode(raw);
	assert.deepStrictEqual(decoded, bytes);
});
