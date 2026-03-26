/*
 * Tests for $:/plugins/wikilabs/uuid7/filters/c32.js
 *
 * Run: node --test plugins/wikilabs/uuid7/tests/test-c32-filter.js
 *
 * Mocks $tw and TiddlyWiki require() for "$:/..." module paths.
 */

"use strict";

var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fs = require("node:fs");
var Module = require("node:module");

// ---------------------------------------------------------------------------
// Setup: mock $tw and TiddlyWiki module resolution
// ---------------------------------------------------------------------------

function readTiddlerBody(filename) {
	var raw = fs.readFileSync(path.resolve(__dirname, "../wordlist/" + filename), "utf8");
	var bodyStart = raw.indexOf("\n\n");
	return bodyStart >= 0 ? raw.slice(bodyStart + 2) : raw;
}
var adjBody = readTiddlerBody("adjectives.tid");
var nounBody = readTiddlerBody("nouns.tid");
var verbBody = readTiddlerBody("verbs.tid");

global.$tw = {
	wiki: {
		getTiddlerText: function(title) {
			if(title === "$:/plugins/wikilabs/uuid7/wordlist/adjectives") { return adjBody; }
			if(title === "$:/plugins/wikilabs/uuid7/wordlist/nouns") { return nounBody; }
			if(title === "$:/plugins/wikilabs/uuid7/wordlist/verbs") { return verbBody; }
			return null;
		}
	}
};

var moduleMap = {
	"$:/plugins/wikilabs/uuid7/crockford32.js": "../modules/libs/crockford32.js",
	"$:/plugins/wikilabs/uuid7/creator.js": "../modules/libs/creator.js",
	"$:/plugins/wikilabs/uuid7/phraselib.js": "../modules/libs/phrase-lib.js"
};

var originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
	if(moduleMap[request]) {
		return path.resolve(__dirname, moduleMap[request]);
	}
	return originalResolveFilename.call(this, request, parent, isMain, options);
};

var c32Filter = require(path.resolve(__dirname, "../modules/filters/c32.js"));
var uuid7Filter = require(path.resolve(__dirname, "../modules/filters/uuid7.js"));
var creator = require(path.resolve(__dirname, "../modules/libs/creator.js"));
var c32lib = require(path.resolve(__dirname, "../modules/libs/crockford32.js"));
var phraselib = require(path.resolve(__dirname, "../modules/libs/phrase-lib.js"));

// ---------------------------------------------------------------------------
// Helper: invoke the filter operator with a single input value
// ---------------------------------------------------------------------------

function runFilter(input, operands) {
	var source = function(cb) { cb(null, input); };
	var operator = { operands: operands || [""], suffix: "" };
	return c32Filter.c32(source, operator, {});
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test("c32[check] returns check symbol", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["check"]);
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0].length, 1);
	var validChars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ*~$=U";
	assert.ok(validChars.indexOf(result[0]) >= 0);
});

test("c32[c7] converts to UUID hex", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["c7"]);
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0], uuid.toLowerCase());
});

test("c32[ms] extracts timestamp", function() {
	var ms = 1710340000000;
	var uuid = creator.generateUUIDv7(ms);
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["ms"]);
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0], String(ms));
});

test("c32[valid] returns yes for valid c32", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["valid"]);
	assert.deepStrictEqual(result, ["yes"]);
});

test("c32[valid] returns no for invalid input", function() {
	var result = runFilter("not-valid-c32", ["valid"]);
	assert.deepStrictEqual(result, ["no"]);
});

test("c32[phrase] returns 8 comma-separated triplets", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["phrase"]);
	assert.strictEqual(result.length, 1);
	var triplets = result[0].split(", ");
	assert.strictEqual(triplets.length, 8);
});

test("c32[phrase] matches uuid7[phrase] for same UUID", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var c32result = runFilter(c32val, ["phrase"]);
	var directResult = phraselib.encodeUUID(uuid);
	assert.strictEqual(c32result[0], directResult.phrase.join(", "));
});

test("c32[phrase] roundtrips 50 UUIDs", function() {
	for(var i = 0; i < 50; i++) {
		var uuid = creator.generateUUIDv7();
		var c32val = c32lib.fromUUID(uuid);
		var c32result = runFilter(c32val, ["phrase"]);
		var directResult = phraselib.encodeUUID(uuid);
		assert.strictEqual(c32result[0], directResult.phrase.join(", "),
			"phrase mismatch for " + uuid);
	}
});

test("c32[phrase] returns empty for invalid input", function() {
	var result = runFilter("not-valid", ["phrase"]);
	assert.strictEqual(result.length, 0);
});

test("c32:+[phrase] uses + as word separator within triplets", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var source = function(cb) { cb(null, c32val); };
	var operator = { operands: ["phrase"], suffix: "+" };
	var result = c32Filter.c32(source, operator, {});
	assert.strictEqual(result.length, 1);
	// Triplets joined by ", " but words within triplets joined by "+"
	var triplets = result[0].split(", ");
	assert.strictEqual(triplets.length, 8);
	assert.ok(triplets[0].indexOf("+") >= 0, "words should be joined by +");
});

test("c32[phrase],[1],[2] returns first 2 triplets", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["phrase", "1", "2"]);
	assert.strictEqual(result.length, 1);
	var triplets = result[0].split(", ");
	assert.strictEqual(triplets.length, 2);
});

test("c32[phrase],[3] returns single triplet", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["phrase", "3"]);
	assert.strictEqual(result.length, 1);
	var words = result[0].split(" ");
	assert.strictEqual(words.length, 3, "triplet should have 3 words");
});

test("c32[rnd] returns random hex in 4-4-12 format", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["rnd"]);
	assert.strictEqual(result.length, 1);
	assert.match(result[0], /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test("c32[version] returns 7", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["version"]);
	assert.deepStrictEqual(result, ["7"]);
});

test("c32[variant] returns 2", function() {
	var uuid = creator.generateUUIDv7();
	var c32val = c32lib.fromUUID(uuid);
	var result = runFilter(c32val, ["variant"]);
	assert.deepStrictEqual(result, ["2"]);
});

test("default (normalize) uppercases and substitutes aliases", function() {
	var result = runFilter("01kmnh", [""]);
	assert.deepStrictEqual(result, ["01KMNH"]);
});

test("normalize handles O→0, I→1, L→1", function() {
	var result = runFilter("OIL", [""]);
	assert.deepStrictEqual(result, ["011"]);
});

test("normalize preserves hyphens", function() {
	var result = runFilter("01kmnh-a", [""]);
	assert.deepStrictEqual(result, ["01KMNH-A"]);
});

test("normalize returns empty for invalid chars", function() {
	var result = runFilter("!!!!", [""]);
	assert.strictEqual(result.length, 0);
});

// ---------------------------------------------------------------------------
// uuid7 filter: c32 and check operands
// ---------------------------------------------------------------------------

function runUuid7Filter(input, operands) {
	var source = function(cb) { cb(null, input); };
	var operator = { operands: operands || [""], suffix: "" };
	return uuid7Filter.uuid7(source, operator, {});
}

test("uuid7[c32] converts UUID to formatted c32", function() {
	var uuid = creator.generateUUIDv7();
	var result = runUuid7Filter(uuid, ["c32"]);
	assert.strictEqual(result.length, 1);
	assert.ok(c32lib.isValidC32(result[0]));
	assert.strictEqual(c32lib.toUUID(result[0]), uuid.toLowerCase());
});

test("uuid7[check] returns check symbol", function() {
	var uuid = creator.generateUUIDv7();
	var result = runUuid7Filter(uuid, ["check"]);
	assert.strictEqual(result.length, 1);
	assert.strictEqual(result[0].length, 1);
	// Should match the c32 filter check for same UUID
	var c32val = c32lib.fromUUID(uuid);
	var c32check = runFilter(c32val, ["check"]);
	assert.strictEqual(result[0], c32check[0]);
});

test("uuid7[c32] returns empty for invalid UUID", function() {
	var result = runUuid7Filter("not-a-uuid", ["c32"]);
	assert.strictEqual(result.length, 0);
});
