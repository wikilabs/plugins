/*\
title: $:/plugins/wikilabs/uuid7/filters/uuid7link.js
type: application/javascript
module-type: filteroperator

Filter operator that generates a single phrase link opening all input tiddlers.

Usage:
  [[TiddlerA]] [[TiddlerB]] [[TiddlerC]] +[uuid7link[]]

Output: a single phrase link string like "metal+dog,lake;hawk;pine"
  - The shared timestamp prefix is stated once
  - Each tiddler gets a minimal discriminator after ;
  - The link opens exactly the input tiddlers when used as a URL hash

\*/

"use strict";

exports.uuid7link = function(source, operator, options) {
	var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");

	// Collect input titles and their word arrays
	var inputTitles = [];
	var inputWords = {};
	var inputPhrases = {};
	source(function(tiddler, title) {
		var t = options.wiki.getTiddler(title);
		if(!t || !t.fields.c7) { return; }
		var enc = phraselib.encodeUUID(t.fields.c7);
		if(!enc.phrase) { return; }
		inputTitles.push(title);
		inputPhrases[title] = enc.phrase;
		var words = [];
		for(var p = 0; p < enc.phrase.length; p++) {
			var tw = enc.phrase[p].toLowerCase().split(/\s+/);
			for(var w = 0; w < tw.length; w++) {
				words.push(tw[w]);
			}
		}
		inputWords[title] = words;
	});

	if(inputTitles.length === 0) { return []; }

	// Build word arrays for ALL tiddlers with c7 (for uniqueness checks)
	var allTitles = options.wiki.filterTiddlers("[has[c7]!is[system]]");
	var allWords = {};
	var allPhrases = {};
	for(var a = 0; a < allTitles.length; a++) {
		var t = options.wiki.getTiddler(allTitles[a]);
		if(!t || !t.fields.c7) { continue; }
		var enc = phraselib.encodeUUID(t.fields.c7);
		if(!enc.phrase) { continue; }
		allPhrases[allTitles[a]] = enc.phrase;
		var words = [];
		for(var p = 0; p < enc.phrase.length; p++) {
			var tw = enc.phrase[p].toLowerCase().split(/\s+/);
			for(var w = 0; w < tw.length; w++) {
				words.push(tw[w]);
			}
		}
		allWords[allTitles[a]] = words;
	}

	// Find shared prefix + per-tiddler discriminators
	// Step 1: Find the longest common word prefix across all input tiddlers
	// Cap at timestamp triplets (words 0-8) — random triplets are for discrimination
	var firstWords = inputWords[inputTitles[0]];
	var commonLen = 0;
	// For single tiddler, cap prefix at triplet 1 (3 words) — only the most
	// stable timestamp bits. For multiple, find actual common prefix.
	var maxPrefix = inputTitles.length === 1 ? 3 : firstWords.length;
	for(var pos = 0; pos < maxPrefix; pos++) {
		var allMatch = true;
		for(var t = 1; t < inputTitles.length; t++) {
			var tw = inputWords[inputTitles[t]];
			if(pos >= tw.length || tw[pos] !== firstWords[pos]) {
				allMatch = false;
				break;
			}
		}
		if(!allMatch) { break; }
		commonLen = pos + 1;
	}

	// Step 2: Check if the common prefix alone uniquely identifies exactly our set
	// Skip for single tiddler — always want prefix + random discriminator for stability
	if(commonLen > 0 && inputTitles.length > 1) {
		var prefix = firstWords.slice(0, commonLen);
		var prefixMatches = [];
		for(var tt in allWords) {
			if(consecutiveMatch(allWords[tt], prefix)) { prefixMatches.push(tt); }
		}
		if(prefixMatches.length === inputTitles.length) {
			// Prefix alone is sufficient
			return [formatLink(prefix)];
		}
	}

	// Step 3: Discriminator search
	// Discriminators MUST come from random triplets (4-8) to survive imports.
	// With 128 words and 10k+ tiddlers, single words (~18% collision rate)
	// and pairs (~0.5%) are not reliable. Start with full triplets (16 bits
	// = 65536 combos, ~15% collision at 10k) which are the minimum reliable
	// discriminator. Fall back to two full triplets (32 bits) if needed.
	var sharedPrefixWords = commonLen > 0 ? firstWords.slice(0, commonLen) : [];
	var prefixPatterns = [];
	for(var p = 0; p < sharedPrefixWords.length; p += 3) {
		var end = Math.min(p + 3, sharedPrefixWords.length);
		prefixPatterns.push(sharedPrefixWords.slice(p, end));
	}
	var discriminators = [];
	// Random triplet indices: 3=T4, 4=T5, 5=T6, 6=T7, 7=T8
	var RANDOM_TRIPLET_START = 3;
	var RANDOM_TRIPLET_END = 6; // T7 (index 6) is last full triplet; T8 has only 2 words

	for(var i = 0; i < inputTitles.length; i++) {
		var title = inputTitles[i];
		var myPhrase = allPhrases[title];
		var discrim = null;

		// Pass 1: Full random triplet (last first = most random)
		for(var t = RANDOM_TRIPLET_END; t >= RANDOM_TRIPLET_START && !discrim; t--) {
			var tw = myPhrase[t].toLowerCase().split(/\s+/);
			var candidate = prefixPatterns.concat([tw]);
			var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
			if(matches.length === 1 && matches[0] === title) {
				discrim = tw.join("+");
			}
		}

		// Pass 2: Two full random triplets (last pair first)
		if(!discrim) {
			for(var t1 = RANDOM_TRIPLET_END; t1 >= RANDOM_TRIPLET_START && !discrim; t1--) {
				for(var t2 = t1 - 1; t2 >= RANDOM_TRIPLET_START && !discrim; t2--) {
					var tw1 = myPhrase[t2].toLowerCase().split(/\s+/);
					var tw2 = myPhrase[t1].toLowerCase().split(/\s+/);
					var candidate = prefixPatterns.concat([tw1, tw2]);
					var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
					if(matches.length === 1 && matches[0] === title) {
						discrim = tw1.join("+") + "," + tw2.join("+");
					}
				}
			}
		}

		// Last resort: triplets 7 + 8 (28 bits, unique among ~268M)
		if(!discrim) {
			var t7 = myPhrase[6].toLowerCase().split(/\s+/);
			var t8 = myPhrase[7].toLowerCase().split(/\s+/);
			discrim = t7.join("+") + "," + t8.join("+");
		}

		discriminators.push(discrim);
	}

	// Step 4: Build the smart link
	// First group: shared prefix + first tiddler's discriminator
	// Subsequent groups: just the discriminator (prefix inherited via ;)
	var parts = [];
	for(var i = 0; i < discriminators.length; i++) {
		if(i === 0) {
			var prefix = formatLink(sharedPrefixWords);
			parts.push(prefix ? prefix + "," + discriminators[i] : discriminators[i]);
		} else {
			parts.push(discriminators[i]);
		}
	}
	return [parts.join(";")];
};


// Check if candidate words appear as consecutive sequence in words
function consecutiveMatch(words, candidate) {
	for(var s = 0; s <= words.length - candidate.length; s++) {
		var match = true;
		for(var j = 0; j < candidate.length; j++) {
			if(words[s + j] !== candidate[j]) {
				match = false;
				break;
			}
		}
		if(match) { return true; }
	}
	return false;
}

// Count titles where candidate appears as consecutive words
// Count titles matching a set of AND patterns (array of word arrays)
// Each pattern must match consecutive words in some triplet
function countMatchingTitlesByPatterns(patterns, allPhrases) {
	var matches = [];
	for(var title in allPhrases) {
		var phrase = allPhrases[title];
		var used = [];
		var allMatch = true;
		for(var p = 0; p < patterns.length; p++) {
			var pattern = Array.isArray(patterns[p]) ? patterns[p] : [patterns[p]];
			var found = false;
			for(var t = 0; t < phrase.length; t++) {
				if(used.indexOf(t) >= 0) { continue; }
				var tripletWords = phrase[t].toLowerCase().split(/\s+/);
				for(var s = 0; s <= tripletWords.length - pattern.length; s++) {
					var match = true;
					for(var j = 0; j < pattern.length; j++) {
						if(tripletWords[s + j] !== pattern[j]) {
							match = false;
							break;
						}
					}
					if(match) {
						found = true;
						used.push(t);
						break;
					}
				}
				if(found) { break; }
			}
			if(!found) {
				allMatch = false;
				break;
			}
		}
		if(allMatch) {
			matches.push(title);
		}
	}
	return matches;
}

// Format a word array as a phrase link with triplet grouping
function formatLink(words) {
	if(words.length === 0) { return ""; }
	var parts = [];
	var i = 0;
	while(i < words.length) {
		var tripletIdx = Math.floor(i / 3);
		var tripletSize = (tripletIdx === 7) ? 2 : 3;
		var tripletStart = tripletIdx * 3;
		var chunk = [];
		while(i < words.length && i < tripletStart + tripletSize) {
			chunk.push(words[i]);
			i++;
		}
		parts.push(chunk.join("+"));
	}
	return parts.join(",");
}
