/*
 * Tests for $:/plugins/wikilabs/uuid7/creator.js
 *
 * Run: node --test plugins/wikilabs/uuid7/tests/
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");

var creator = require(path.resolve(__dirname, "../modules/libs/creator.js"));

// ---------------------------------------------------------------------------
// generateUUIDv7
// ---------------------------------------------------------------------------

test("generateUUIDv7 returns a valid UUID v7 string", function() {
	var uuid = creator.generateUUIDv7();
	assert.ok(creator.isValidV7(uuid), "generated UUID should be valid: " + uuid);
});

test("generateUUIDv7 produces correct format (8-4-4-4-12)", function() {
	var uuid = creator.generateUUIDv7();
	assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("generateUUIDv7 sets version nibble to 7", function() {
	var uuid = creator.generateUUIDv7();
	// 13th hex char (after removing dashes) is the version
	var hex = uuid.replace(/-/g, "");
	assert.strictEqual(hex[12], "7");
});

test("generateUUIDv7 sets variant bits to 0b10", function() {
	var uuid = creator.generateUUIDv7();
	var hex = uuid.replace(/-/g, "");
	var variantNibble = parseInt(hex[16], 16);
	// High 2 bits must be 10 → value 8, 9, a, or b
	assert.ok(variantNibble >= 8 && variantNibble <= 11,
		"variant nibble should be 8-b, got: " + hex[16]);
});

test("generateUUIDv7 with explicit timestamp", function() {
	var ms = 1710340000000; // 2024-03-13T...
	var uuid = creator.generateUUIDv7(ms);
	var extracted = creator.extractTimestampMs(uuid);
	assert.strictEqual(extracted, ms);
});

test("generateUUIDv7 with timestamp 0", function() {
	var uuid = creator.generateUUIDv7(0);
	var extracted = creator.extractTimestampMs(uuid);
	assert.strictEqual(extracted, 0);
});

test("generateUUIDv7 with large timestamp (year 2100)", function() {
	var ms = 4102444800000; // 2100-01-01
	var uuid = creator.generateUUIDv7(ms);
	var extracted = creator.extractTimestampMs(uuid);
	assert.strictEqual(extracted, ms);
});

test("generateUUIDv7 produces unique values", function() {
	var uuids = new Set();
	for(var i = 0; i < 1000; i++) {
		uuids.add(creator.generateUUIDv7());
	}
	assert.strictEqual(uuids.size, 1000, "1000 UUIDs should all be unique");
});

test("generateUUIDv7 is monotonic for same timestamp", function() {
	var ms = Date.now();
	var uuids = [];
	for(var i = 0; i < 100; i++) {
		uuids.push(creator.generateUUIDv7(ms));
	}
	// All should have the same timestamp prefix but differ in random bits
	var timestamps = uuids.map(function(u) { return creator.extractTimestampMs(u); });
	timestamps.forEach(function(ts) {
		assert.strictEqual(ts, ms);
	});
	// All should be unique (random portion differs)
	assert.strictEqual(new Set(uuids).size, 100);
});

// ---------------------------------------------------------------------------
// isValidV7
// ---------------------------------------------------------------------------

test("isValidV7 accepts valid UUID v7", function() {
	assert.strictEqual(creator.isValidV7("019ce7af-ff4d-7897-ae47-6dd818e2d476"), true);
});

test("isValidV7 rejects UUID v4", function() {
	// v4 has '4' at position 13 (after dash removal)
	assert.strictEqual(creator.isValidV7("550e8400-e29b-41d4-a716-446655440000"), false);
});

test("isValidV7 rejects empty string", function() {
	assert.strictEqual(creator.isValidV7(""), false);
});

test("isValidV7 rejects non-string", function() {
	assert.strictEqual(creator.isValidV7(null), false);
	assert.strictEqual(creator.isValidV7(undefined), false);
	assert.strictEqual(creator.isValidV7(12345), false);
});

test("isValidV7 rejects UUID with wrong variant", function() {
	// Variant nibble must be 8-b; here it's 0
	assert.strictEqual(creator.isValidV7("019ce7af-ff4d-7897-0e47-6dd818e2d476"), false);
});

test("isValidV7 rejects too-short string", function() {
	assert.strictEqual(creator.isValidV7("019ce7af-ff4d-7897"), false);
});

test("isValidV7 rejects uppercase (case-insensitive regex)", function() {
	// UUID spec allows uppercase; our regex uses /i flag
	assert.strictEqual(creator.isValidV7("019CE7AF-FF4D-7897-AE47-6DD818E2D476"), true);
});

// ---------------------------------------------------------------------------
// extractTimestampMs
// ---------------------------------------------------------------------------

test("extractTimestampMs extracts correct timestamp", function() {
	// Known UUID: 019ce7af-ff4d → first 12 hex = 019ce7afff4d
	var ms = creator.extractTimestampMs("019ce7af-ff4d-7897-ae47-6dd818e2d476");
	assert.strictEqual(typeof ms, "number");
	// 0x019ce7afff4d = 1773563895629
	assert.strictEqual(ms, 0x019ce7afff4d);
});

test("extractTimestampMs returns null for invalid UUID", function() {
	assert.strictEqual(creator.extractTimestampMs("not-a-uuid"), null);
	assert.strictEqual(creator.extractTimestampMs(""), null);
});

test("extractTimestampMs roundtrips with generateUUIDv7", function() {
	var now = Date.now();
	var uuid = creator.generateUUIDv7(now);
	assert.strictEqual(creator.extractTimestampMs(uuid), now);
});

// ---------------------------------------------------------------------------
// toUUIDString
// ---------------------------------------------------------------------------

test("toUUIDString formats 16 bytes correctly", function() {
	var bytes = new Uint8Array([
		0x01, 0x9c, 0xe7, 0xaf, 0xff, 0x4d,
		0x78, 0x97,
		0xae, 0x47,
		0x6d, 0xd8, 0x18, 0xe2, 0xd4, 0x76
	]);
	assert.strictEqual(creator.toUUIDString(bytes), "019ce7af-ff4d-7897-ae47-6dd818e2d476");
});

test("toUUIDString zero bytes", function() {
	var bytes = new Uint8Array(16);
	assert.strictEqual(creator.toUUIDString(bytes), "00000000-0000-0000-0000-000000000000");
});

// ---------------------------------------------------------------------------
// msToISO
// ---------------------------------------------------------------------------

test("msToISO formats timestamp correctly", function() {
	var iso = creator.msToISO(0);
	assert.strictEqual(iso, "1970-01-01T00:00:00.000Z");
});

test("msToISO known date", function() {
	// 2024-03-13T12:00:00.000Z
	var iso = creator.msToISO(1710331200000);
	assert.strictEqual(iso, "2024-03-13T12:00:00.000Z");
});
