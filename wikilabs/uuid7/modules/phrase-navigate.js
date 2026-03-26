/*\
title: $:/plugins/wikilabs/uuid7/phrase-navigate.js
type: application/javascript
module-type: startup

Phrase-based URL navigation
============================
Runs BEFORE the story module. If the URL hash contains phrase words,
rewrite $tw.locationHash to open all matching tiddlers.

URL format:
  #adj+noun+verb          — words within a triplet pattern
  #pattern1,pattern2      — AND: all patterns must match (different triplets)
  #group1;group2;group3   — OR: tiddlers matching ANY group are opened

  Separators:  + (words)  , (AND)  ; (OR)

  Example: #metal+dog,lake;metal+dog,hawk;metal+dog,pine
  Smart:   #metal+dog,lake;hawk;pine
    (groups without , inherit the shared prefix from the first group)

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

// Parse a single AND group: commas separate triplet patterns, + separates words
function parseSearchPatterns(groupText) {
	var parts = groupText.split(",");
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

// Match all AND patterns against a phrase
function matchAllPatterns(phrase, patterns) {
	var indices = [];
	var used = [];
	for(var p = 0; p < patterns.length; p++) {
		var idx = matchTriplet(phrase, patterns[p], used);
		if(idx === -1) { return null; }
		indices.push(idx);
		used.push(idx);
	}
	var inOrder = true;
	for(var i = 1; i < indices.length; i++) {
		if(indices[i] <= indices[i - 1]) {
			inOrder = false;
			break;
		}
	}
	return { inOrder: inOrder, indices: indices };
}

// Parse full search string with OR (;) and AND (,) groups.
// Smart mode: groups without , inherit the shared prefix from the first group.
function parseOrGroups(searchStr) {
	var orParts = searchStr.split(";");
	var groups = [];
	var sharedPrefix = null;
	for(var g = 0; g < orParts.length; g++) {
		var groupText = orParts[g].trim();
		if(!groupText) { continue; }
		var patterns = parseSearchPatterns(groupText);
		if(patterns.length === 0) { continue; }
		if(g === 0) {
			// First group defines the shared prefix (all patterns except last)
			if(patterns.length > 1) {
				sharedPrefix = patterns.slice(0, patterns.length - 1);
			}
			groups.push(patterns);
		} else {
			// Subsequent groups: if they have no comma (single pattern),
			// prepend the shared prefix from group 1
			if(sharedPrefix && groupText.indexOf(",") === -1) {
				groups.push(sharedPrefix.concat(patterns));
			} else {
				groups.push(patterns);
			}
		}
	}
	return groups;
}

// Find all tiddlers matching any OR group. Results ordered:
// in-order matches first, then out-of-order, deduplicated, preserving first-seen order.
function findAllByPhrase(searchStr) {
	var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
	var groups = parseOrGroups(searchStr);
	if(groups.length === 0) { return []; }
	var titles = $tw.wiki.filterTiddlers("[has[c7]!is[system]]");
	var ordered = [];
	var unordered = [];
	var seen = {};
	for(var g = 0; g < groups.length; g++) {
		for(var i = 0; i < titles.length; i++) {
			if(seen[titles[i]]) { continue; }
			var tiddler = $tw.wiki.getTiddler(titles[i]);
			if(!tiddler || !tiddler.fields.c7) { continue; }
			var enc = phraselib.encodeUUID(tiddler.fields.c7);
			if(!enc.phrase) { continue; }
			var result = matchAllPatterns(enc.phrase, groups[g]);
			if(result) {
				seen[titles[i]] = true;
				if(result.inOrder) {
					ordered.push(titles[i]);
				} else {
					unordered.push(titles[i]);
				}
			}
		}
	}
	return ordered.concat(unordered);
}

// Check if a string looks like a phrase search
function isPhraseSearch(str) {
	if(str.indexOf("+") === -1 && str.indexOf(",") === -1 && str.indexOf(";") === -1) {
		return false;
	}
	var cleaned = str.replace(/[+,;]/g, " ").trim();
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

	// Hook th-navigating for in-wiki navigation
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
