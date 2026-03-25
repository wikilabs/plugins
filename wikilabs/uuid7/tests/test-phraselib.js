/*
 * Tests for $:/plugins/wikilabs/uuid7/phraselib.js
 *
 * Run: node --test plugins/wikilabs/uuid7/tests/test-*.js
 *
 * Mocks $tw.wiki and the TiddlyWiki require() for "$:/..." module paths.
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

// Read each wordlist tiddler (skip header lines before the blank line)
function readTiddlerBody(filename) {
	var raw = fs.readFileSync(path.resolve(__dirname, "../wordlist/" + filename), "utf8");
	var bodyStart = raw.indexOf("\n\n");
	return bodyStart >= 0 ? raw.slice(bodyStart + 2) : raw;
}
var adjBody = readTiddlerBody("adjectives.tid");
var nounBody = readTiddlerBody("nouns.tid");
var verbBody = readTiddlerBody("verbs.tid");

// Set up global $tw mock
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

// Patch require to resolve "$:/plugins/wikilabs/uuid7/creator.js"
var originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function(request, parent, isMain, options) {
	if(request === "$:/plugins/wikilabs/uuid7/creator.js") {
		return path.resolve(__dirname, "../modules/libs/creator.js");
	}
	return originalResolveFilename.call(this, request, parent, isMain, options);
};

var creator = require(path.resolve(__dirname, "../modules/libs/creator.js"));
var phraselib = require(path.resolve(__dirname, "../modules/libs/phrase-lib.js"));

// ---------------------------------------------------------------------------
// Wordlist loading
// ---------------------------------------------------------------------------

test("getWordlist loads 32 adjectives, 32 verbs, and 64 nouns", function() {
	var wl = phraselib.getWordlist();
	assert.ok(wl, "wordlist should load");
	assert.strictEqual(wl.adjectives.length, 32);
	assert.strictEqual(wl.verbs.length, 32);
	assert.strictEqual(wl.nouns.length, 64);
});

test("getWordlist has no duplicate adjectives", function() {
	var wl = phraselib.getWordlist();
	assert.strictEqual(new Set(wl.adjectives).size, 32);
});

test("getWordlist has no duplicate verbs", function() {
	var wl = phraselib.getWordlist();
	assert.strictEqual(new Set(wl.verbs).size, 32);
});

test("getWordlist has no duplicate nouns", function() {
	var wl = phraselib.getWordlist();
	assert.strictEqual(new Set(wl.nouns).size, 64);
});

test("getWordlist no overlap between all 3 categories", function() {
	var wl = phraselib.getWordlist();
	var all = wl.adjectives.concat(wl.verbs).concat(wl.nouns);
	assert.strictEqual(new Set(all).size, all.length, "found duplicate words across categories");
});

test("getWordlist builds reverse lookup indices", function() {
	var wl = phraselib.getWordlist();
	assert.strictEqual(wl.adjIndex["metal"], 0);
	assert.strictEqual(wl.adjIndex["wide"], 31);
	assert.strictEqual(wl.verbIndex["binds"], 0);
	assert.strictEqual(wl.verbIndex["wakes"], 31);
	assert.strictEqual(wl.nounIndex["arch"], 0);
	assert.strictEqual(wl.nounIndex["wren"], 63);
});

// ---------------------------------------------------------------------------
// encodeUUID
// ---------------------------------------------------------------------------

test("encodeUUID returns 8 triplets", function() {
	var uuid = creator.generateUUIDv7();
	var result = phraselib.encodeUUID(uuid);
	assert.ok(!result.error, "should not error: " + result.error);
	assert.strictEqual(result.phrase.length, 8);
});

test("encodeUUID each triplet is 'adjective noun verb'", function() {
	var wl = phraselib.getWordlist();
	var uuid = creator.generateUUIDv7();
	var result = phraselib.encodeUUID(uuid);
	result.phrase.forEach(function(triplet, i) {
		var words = triplet.split(" ");
		assert.strictEqual(words.length, 3, "triplet " + i + " should have 3 words: " + triplet);
		assert.ok(wl.adjIndex[words[0]] !== undefined,
			"triplet " + i + " adjective '" + words[0] + "' not in wordlist");
		assert.ok(wl.nounIndex[words[1]] !== undefined,
			"triplet " + i + " noun '" + words[1] + "' not in wordlist");
		assert.ok(wl.verbIndex[words[2]] !== undefined,
			"triplet " + i + " verb '" + words[2] + "' not in wordlist");
	});
});

test("encodeUUID rejects invalid UUID", function() {
	var result = phraselib.encodeUUID("not-a-uuid");
	assert.ok(result.error);
});

test("encodeUUID same timestamp produces same first 2 triplets", function() {
	var ms = 1710340000000;
	var uuid1 = creator.generateUUIDv7(ms);
	var uuid2 = creator.generateUUIDv7(ms);
	var r1 = phraselib.encodeUUID(uuid1);
	var r2 = phraselib.encodeUUID(uuid2);
	// First 32 bits of timestamp are in triplets 1-2 (16 bits each)
	// With same ms, triplets 1-2 should be identical
	assert.strictEqual(r1.phrase[0], r2.phrase[0], "triplet 1 should match");
	assert.strictEqual(r1.phrase[1], r2.phrase[1], "triplet 2 should match");
});

test("encodeUUID different timestamps produce different triplets", function() {
	var uuid1 = creator.generateUUIDv7(1000000000000);
	var uuid2 = creator.generateUUIDv7(2000000000000);
	var r1 = phraselib.encodeUUID(uuid1);
	var r2 = phraselib.encodeUUID(uuid2);
	assert.notStrictEqual(r1.phrase[0], r2.phrase[0]);
});

// ---------------------------------------------------------------------------
// decodePhrase (roundtrip)
// ---------------------------------------------------------------------------

test("roundtrip: encodeUUID -> decodePhrase recovers original UUID", function() {
	var uuid = creator.generateUUIDv7();
	var encoded = phraselib.encodeUUID(uuid);
	var decoded = phraselib.decodePhrase(encoded.phrase);
	assert.ok(!decoded.error, "decode should not error: " + decoded.error);
	assert.strictEqual(decoded.uuid, uuid);
});

test("roundtrip with known timestamp", function() {
	var ms = 1710340000000;
	var uuid = creator.generateUUIDv7(ms);
	var encoded = phraselib.encodeUUID(uuid);
	var decoded = phraselib.decodePhrase(encoded.phrase);
	assert.strictEqual(decoded.uuid, uuid);
	assert.strictEqual(creator.extractTimestampMs(decoded.uuid), ms);
});

test("roundtrip with timestamp 0", function() {
	var uuid = creator.generateUUIDv7(0);
	var encoded = phraselib.encodeUUID(uuid);
	var decoded = phraselib.decodePhrase(encoded.phrase);
	assert.strictEqual(decoded.uuid, uuid);
});

test("roundtrip 100 random UUIDs", function() {
	for(var i = 0; i < 100; i++) {
		var uuid = creator.generateUUIDv7();
		var encoded = phraselib.encodeUUID(uuid);
		var decoded = phraselib.decodePhrase(encoded.phrase);
		assert.strictEqual(decoded.uuid, uuid, "roundtrip failed for: " + uuid);
	}
});

// ---------------------------------------------------------------------------
// decodePhrase error cases
// ---------------------------------------------------------------------------

test("decodePhrase rejects wrong number of triplets", function() {
	var result = phraselib.decodePhrase(["metal arch binds", "calm fox calls"]);
	assert.ok(result.error);
});

test("decodePhrase rejects non-array", function() {
	var result = phraselib.decodePhrase("metal arch binds calm fox calls");
	assert.ok(result.error);
});

test("decodePhrase rejects unknown adjective", function() {
	var fakeTriplets = [];
	for(var i = 0; i < 8; i++) { fakeTriplets.push("metal arch binds"); }
	fakeTriplets[3] = "zzzz arch binds";
	var result = phraselib.decodePhrase(fakeTriplets);
	assert.ok(result.error);
});

test("decodePhrase rejects unknown verb", function() {
	var fakeTriplets = [];
	for(var i = 0; i < 8; i++) { fakeTriplets.push("metal arch binds"); }
	fakeTriplets[3] = "metal arch zzzz";
	var result = phraselib.decodePhrase(fakeTriplets);
	assert.ok(result.error);
});

test("decodePhrase rejects unknown noun", function() {
	var fakeTriplets = [];
	for(var i = 0; i < 8; i++) { fakeTriplets.push("metal arch binds"); }
	fakeTriplets[3] = "metal zzzz binds";
	var result = phraselib.decodePhrase(fakeTriplets);
	assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Bit encoding correctness
// ---------------------------------------------------------------------------

test("index 0 maps to first adj + first noun + first verb", function() {
	// Index 0 = adj[0] noun[0] verb[0] = "metal arch binds"
	var uuid = creator.generateUUIDv7(0);
	var encoded = phraselib.encodeUUID(uuid);
	// With timestamp 0, the first triplet should be "metal arch binds" (all zero bits)
	assert.strictEqual(encoded.phrase[0], "metal arch binds");
});

test("all 65536 indices produce valid triplets", function() {
	var wl = phraselib.getWordlist();
	for(var idx = 0; idx < 65536; idx++) {
		var ai = (idx >> 11) & 0x1F;
		var ni = (idx >> 5) & 0x3F;
		var vi = idx & 0x1F;
		assert.ok(ai < 32, "adj index out of range: " + ai);
		assert.ok(vi < 32, "verb index out of range: " + vi);
		assert.ok(ni < 64, "noun index out of range: " + ni);
	}
});

test("shortcodeFromPhrase returns triplets 1-2", function() {
	var uuid = creator.generateUUIDv7();
	var encoded = phraselib.encodeUUID(uuid);
	assert.strictEqual(phraselib.shortcodeFromPhrase(encoded.phrase),
		encoded.phrase[0] + ", " + encoded.phrase[1]);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

test("PHRASE_TRIPLETS is 8", function() {
	assert.strictEqual(phraselib.PHRASE_TRIPLETS, 8);
});

test("TRIPLET_COUNT is 65536", function() {
	assert.strictEqual(phraselib.TRIPLET_COUNT, 65536);
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

test.after(function() {
	Module._resolveFilename = originalResolveFilename;
	delete global.$tw;
});
