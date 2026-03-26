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

	// Single tiddler: find shortest unique prefix
	if(inputTitles.length === 1) {
		var result = findShortestUnique(inputTitles[0], inputWords[inputTitles[0]], allWords);
		return [formatLink(result)];
	}

	// Multiple tiddlers: find shared prefix + per-tiddler discriminators
	// Step 1: Find the longest common word prefix across all input tiddlers
	var firstWords = inputWords[inputTitles[0]];
	var commonLen = 0;
	for(var pos = 0; pos < firstWords.length; pos++) {
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
	if(commonLen > 0) {
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

	// Step 3: Greedy minimum discriminator search
	// Discriminators MUST come from random triplets (4-8, word indices 9+)
	// to survive imports of tiddlers with matching timestamps.
	// Convert shared prefix words into triplet-aligned patterns
	var sharedPrefixWords = commonLen > 0 ? firstWords.slice(0, commonLen) : [];
	var prefixPatterns = [];
	for(var p = 0; p < sharedPrefixWords.length; p += 3) {
		var end = Math.min(p + 3, sharedPrefixWords.length);
		prefixPatterns.push(sharedPrefixWords.slice(p, end));
	}
	var discriminators = [];
	var RANDOM_START = 9; // word index where random triplets begin (triplet 4)

	for(var i = 0; i < inputTitles.length; i++) {
		var title = inputTitles[i];
		var myPhrase = allPhrases[title];
		var myWords = inputWords[title];
		var discrim = null;

		// Pass 1: Single word from random triplets (last first)
		for(var w = myWords.length - 1; w >= RANDOM_START && !discrim; w--) {
			var candidate = prefixPatterns.concat([[myWords[w]]]);
			var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
			if(matches.length === 1 && matches[0] === title) {
				discrim = [myWords[w]];
			}
		}

		// Pass 2: Pair within a random triplet (last first)
		if(!discrim) {
			for(var t = myPhrase.length - 1; t >= 3 && !discrim; t--) {
				var tw = myPhrase[t].toLowerCase().split(/\s+/);
				for(var s = 0; s < tw.length - 1 && !discrim; s++) {
					var pair = [tw[s], tw[s+1]];
					var candidate = prefixPatterns.concat([pair]);
					var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
					if(matches.length === 1 && matches[0] === title) {
						discrim = pair;
					}
				}
			}
		}

		// Pass 3: Full random triplet (last first)
		if(!discrim) {
			for(var t = myPhrase.length - 1; t >= 3 && !discrim; t--) {
				var tw = myPhrase[t].toLowerCase().split(/\s+/);
				var candidate = prefixPatterns.concat([tw]);
				var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
				if(matches.length === 1 && matches[0] === title) {
					discrim = tw;
				}
			}
		}

		// Pass 4: Two single words from different random triplets
		if(!discrim) {
			for(var w1 = myWords.length - 1; w1 >= RANDOM_START && !discrim; w1--) {
				for(var w2 = w1 - 1; w2 >= RANDOM_START && !discrim; w2--) {
					var candidate = prefixPatterns.concat([[myWords[w2]], [myWords[w1]]]);
					var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
					if(matches.length === 1 && matches[0] === title) {
						discrim = [myWords[w2] + "," + myWords[w1]];
					}
				}
			}
		}

		// Pass 5: Three single words from different random triplets
		if(!discrim) {
			for(var w1 = myWords.length - 1; w1 >= RANDOM_START && !discrim; w1--) {
				for(var w2 = w1 - 1; w2 >= RANDOM_START && !discrim; w2--) {
					for(var w3 = w2 - 1; w3 >= RANDOM_START && !discrim; w3--) {
						var candidate = prefixPatterns.concat([[myWords[w3]], [myWords[w2]], [myWords[w1]]]);
						var matches = countMatchingTitlesByPatterns(candidate, allPhrases);
						if(matches.length === 1 && matches[0] === title) {
							discrim = [myWords[w3] + "," + myWords[w2] + "," + myWords[w1]];
						}
					}
				}
			}
		}

		// Last resort: full random triplet 7 (most entropy before last)
		if(!discrim) {
			var fallbackTriplet = myPhrase[6].toLowerCase().split(/\s+/);
			discrim = fallbackTriplet;
		}

		discriminators.push(discrim);
	}

	// Step 4: Build the smart link
	// First group: shared prefix + first tiddler's discriminator
	// Subsequent groups: just the discriminator (prefix inherited via ;)
	var parts = [];
	for(var i = 0; i < discriminators.length; i++) {
		if(i === 0) {
			var firstGroup = formatLink(sharedPrefixWords) + "," + discriminators[i].join("+");
			parts.push(firstGroup);
		} else {
			parts.push(discriminators[i].join("+"));
		}
	}
	return [parts.join(";")];
};

// Find shortest prefix of myWords that uniquely identifies title
function findShortestUnique(title, myWords, allWords) {
	for(var len = 1; len <= myWords.length; len++) {
		var candidate = myWords.slice(0, len);
		var matchCount = 0;
		for(var t in allWords) {
			if(consecutiveMatch(allWords[t], candidate)) {
				matchCount++;
				if(matchCount > 1) { break; }
			}
		}
		if(matchCount === 1) {
			return candidate;
		}
	}
	return myWords;
}

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
