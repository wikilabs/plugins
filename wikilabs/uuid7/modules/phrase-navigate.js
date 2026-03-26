/*\
title: $:/plugins/wikilabs/uuid7/phrase-navigate.js
type: application/javascript
module-type: startup

Phrase-based URL navigation
============================
Runs BEFORE the story module. If the URL hash contains phrase words
separated by + (within triplets) and , (between triplets), and no
tiddler with that title exists, rewrite $tw.locationHash to open
all matching tiddlers.

URL format: #adj+noun+verb,adj+noun,word
  - commas separate search patterns (matched against individual triplets)
  - plus signs separate words within a pattern
  - each pattern is matched against every triplet in the tiddler's phrase
  - all patterns must match for a tiddler to be included
  - in-order matches (triplet indices ascending) are listed first

Also hooks th-navigating for in-wiki navigation.

\*/

"use strict";

exports.name = "uuid7-phrase-navigate";
exports.before = ["story"];
exports.after = ["startup"];
exports.synchronous = true;

// Check if searchWords match consecutive words within a single triplet.
// Returns the triplet index (0-7) or -1 if no match.
function matchTriplet(phrase, searchWords, excludeIndices) {
	for(var t = 0; t < phrase.length; t++) {
		if(excludeIndices && excludeIndices.indexOf(t) >= 0) { continue; }
		var tripletWords = phrase[t].toLowerCase().split(/\s+/);
		// Slide searchWords over tripletWords
		for(var s = 0; s <= tripletWords.length - searchWords.length; s++) {
			var match = true;
			for(var j = 0; j < searchWords.length; j++) {
				if(tripletWords[s + j] !== searchWords[j]) {
					match = false;
					break;
				}
			}
			if(match) { return t; }
		}
	}
	return -1;
}

// Parse search string: commas separate triplet patterns, + separates words
function parseSearchPatterns(searchText) {
	var parts = searchText.split(",");
	var patterns = [];
	for(var i = 0; i < parts.length; i++) {
		var words = parts[i].trim().replace(/\+/g, " ").toLowerCase()
			.split(/\s+/).filter(function(w) { return w.length > 0; });
		if(words.length > 0) {
			patterns.push(words);
		}
	}
	return patterns;
}

// Match all patterns against the phrase. Returns:
//   null if not all patterns match
//   { inOrder: true/false, indices: [...] } if all match
function matchAllPatterns(phrase, patterns) {
	var indices = [];
	var used = [];
	for(var p = 0; p < patterns.length; p++) {
		var idx = matchTriplet(phrase, patterns[p], used);
		if(idx === -1) { return null; }
		indices.push(idx);
		used.push(idx);
	}
	// Check if indices are in ascending order
	var inOrder = true;
	for(var i = 1; i < indices.length; i++) {
		if(indices[i] <= indices[i - 1]) {
			inOrder = false;
			break;
		}
	}
	return { inOrder: inOrder, indices: indices };
}

function findAllByPhrase(searchText) {
	var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
	var patterns = parseSearchPatterns(searchText);
	if(patterns.length === 0) { return []; }
	var titles = $tw.wiki.filterTiddlers("[has[c7]!is[system]]");
	var ordered = [];
	var unordered = [];
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler || !tiddler.fields.c7) { continue; }
		var enc = phraselib.encodeUUID(tiddler.fields.c7);
		if(!enc.phrase) { continue; }
		var result = matchAllPatterns(enc.phrase, patterns);
		if(result) {
			if(result.inOrder) {
				ordered.push(titles[i]);
			} else {
				unordered.push(titles[i]);
			}
		}
	}
	return ordered.concat(unordered);
}

// Check if a string looks like a phrase search (contains + or ,, only lowercase+separators)
function isPhraseSearch(str) {
	if(str.indexOf("+") === -1 && str.indexOf(",") === -1) { return false; }
	var cleaned = str.replace(/[+,]/g, " ").trim();
	return cleaned.length > 0 && /^[a-z\s]+$/.test(cleaned);
}

exports.startup = function() {
	// Rewrite the location hash before the story module reads it
	if($tw.browser && $tw.locationHash && $tw.locationHash.length > 1) {
		var hash = $tw.locationHash.substr(1);
		var split = hash.indexOf(":");
		var target = split === -1 ? hash.trim() : hash.substr(0, split).trim();
		var decoded = $tw.utils.decodeURIComponentSafe(target);
		if(isPhraseSearch(decoded) && !$tw.wiki.tiddlerExists(decoded)) {
			var matches = findAllByPhrase(decoded);
			if(matches.length > 0) {
				var storyList = $tw.utils.stringifyList(matches);
				$tw.locationHash = "#" + encodeURIComponent(matches[0]) + ":" + encodeURIComponent(storyList);
			}
		}
	}

	// Hook th-navigating for in-wiki navigation (links, search)
	$tw.hooks.addHook("th-navigating",function(event) {
		var target = event.navigateTo;
		if(!target || $tw.wiki.tiddlerExists(target)) {
			return event;
		}
		if(!isPhraseSearch(target)) { return event; }
		var matches = findAllByPhrase(target);
		if(matches.length > 0) {
			event.navigateTo = matches[0];
			if(matches.length > 1) {
				var storyTitle = event.navigateFromNode
					? event.navigateFromNode.getVariable("tv-story-list")
					: null;
				storyTitle = storyTitle || "$:/StoryList";
				var storyList = $tw.wiki.getTiddlerList(storyTitle);
				for(var i = matches.length - 1; i >= 0; i--) {
					if(storyList.indexOf(matches[i]) === -1) {
						storyList.unshift(matches[i]);
					}
				}
				$tw.wiki.addTiddler({
					title: storyTitle,
					text: "",
					list: storyList
				}, $tw.wiki.getModificationFields());
			}
		}
		return event;
	});
};
