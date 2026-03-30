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

// ---------------------------------------------------------------------------
// Phrase cache: UUID string → { phrase: string[], words: string[][] }
// phrase = raw triplet strings, words = pre-split lowercase word arrays per triplet
// TODO: Entries for deleted tiddlers are never removed (~220 bytes each).
//       If memory becomes a concern, add a wiki "change" listener that
//       evicts entries whose UUID is no longer referenced by any tiddler.
// ---------------------------------------------------------------------------
var _phraseCache = Object.create(null);

function getCachedPhrase(c7) {
	if(_phraseCache[c7]) { return _phraseCache[c7]; }
	var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
	var enc = phraselib.encodeUUID(c7);
	if(!enc.phrase) { return null; }
	var words = [];
	for(var t = 0; t < enc.phrase.length; t++) {
		words.push(enc.phrase[t].toLowerCase().split(/\s+/));
	}
	_phraseCache[c7] = { phrase: enc.phrase, words: words };
	return _phraseCache[c7];
}

// Check if searchWords match consecutive words within a single triplet.
// Returns the triplet index (0-7) or -1 if no match.
// If position >= 0, only check that specific triplet (1-based in URL, 0-based here).
function matchTriplet(phraseWords, searchWords, excludeIndices, position) {
	var start = (position >= 0) ? position : 0;
	var end = (position >= 0) ? position + 1 : phraseWords.length;
	for(var t = start; t < end; t++) {
		if(excludeIndices && excludeIndices.indexOf(t) >= 0) { continue; }
		var tw = phraseWords[t];
		for(var s = 0; s <= tw.length - searchWords.length; s++) {
			var match = true;
			for(var j = 0; j < searchWords.length; j++) {
				if(tw[s + j] !== searchWords[j]) {
					match = false;
					break;
				}
			}
			if(match) { return t; }
		}
	}
	return -1;
}

// Parse a single AND group: commas separate triplet patterns, + separates words.
// A leading digit specifies the triplet position (1-based): "4cool+dune+casts"
// Returns array of { words: string[], position: number } (position = -1 for any)
function parseSearchPatterns(groupText) {
	var parts = groupText.split(",");
	var patterns = [];
	for(var i = 0; i < parts.length; i++) {
		var part = parts[i].trim();
		var position = -1;
		// Check for leading digit (triplet position, 1-based)
		if(part.length > 1 && part[0] >= "1" && part[0] <= "8") {
			position = parseInt(part[0], 10) - 1; // convert to 0-based
			part = part.substr(1);
		}
		var words = part.replace(/\+/g, " ").toLowerCase()
			.split(/\s+/).filter(function(w) { return w.length > 0; });
		if(words.length > 0) {
			patterns.push({ words: words, position: position });
		}
	}
	return patterns;
}

// Match all AND patterns against pre-split phrase word arrays
function matchAllPatterns(phraseWords, patterns) {
	var indices = [];
	var used = [];
	for(var p = 0; p < patterns.length; p++) {
		var idx = matchTriplet(phraseWords, patterns[p].words, used, patterns[p].position);
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
			var cached = getCachedPhrase(tiddler.fields.c7);
			if(!cached) { continue; }
			var result = matchAllPatterns(cached.words, groups[g]);
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

// Check if a string looks like a UUID hex search (hex chars + hyphens, min 4 chars)
// Also accepts prefix+suffix pattern like "019d2c+0770"
function isUUIDSearch(str) {
	return /^[0-9a-fA-F-]{2,}\+[0-9a-fA-F-]{2,}$/.test(str) ||
		/^[0-9a-fA-F]{4,}$/.test(str) ||
		/^[0-9a-fA-F]{8}-[0-9a-fA-F-]*$/.test(str);
}

// Find tiddlers by UUID hex (exact, partial, or prefix+suffix)
function findByUUID(searchStr) {
	var creator = require("$:/plugins/wikilabs/uuid7/creator.js");
	// Exact match (full valid UUID)
	if(creator.isValidV7(searchStr)) {
		var titles = $tw.wiki.filterTiddlers("[has[c7]!is[system]]");
		for(var i = 0; i < titles.length; i++) {
			var tiddler = $tw.wiki.getTiddler(titles[i]);
			if(tiddler && tiddler.fields.c7 === searchStr.toLowerCase()) {
				return [titles[i]];
			}
		}
		return [];
	}
	// Partial or prefix+suffix
	var prefix = null;
	var suffix = null;
	var plusIdx = searchStr.indexOf("+");
	if(plusIdx > 0 && plusIdx < searchStr.length - 1) {
		prefix = searchStr.substr(0, plusIdx).toLowerCase().replace(/-/g, "");
		suffix = searchStr.substr(plusIdx + 1).toLowerCase().replace(/-/g, "");
	}
	var needle = searchStr.toLowerCase().replace(/-/g, "");
	var titles2 = $tw.wiki.filterTiddlers("[has[c7]!is[system]]");
	var results = [];
	for(var j = 0; j < titles2.length; j++) {
		var t = $tw.wiki.getTiddler(titles2[j]);
		if(!t || !t.fields.c7) { continue; }
		var c7raw = t.fields.c7.replace(/-/g, "");
		if(prefix && suffix) {
			if(c7raw.indexOf(prefix) === 0 && c7raw.indexOf(suffix, c7raw.length - suffix.length) >= 0) {
				results.push(titles2[j]);
			}
		} else if(c7raw.indexOf(needle) >= 0) {
			results.push(titles2[j]);
		}
	}
	return results;
}

// Check if a string looks like a c32 value (full or partial)
// Also accepts prefix+suffix pattern like "01KMP4+01VG"
function isC32Search(str) {
	var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
	// Check for prefix+suffix pattern
	var plusIdx = str.indexOf("+");
	if(plusIdx > 0 && plusIdx < str.length - 1) {
		var left = c32lib.normalize(str.substr(0, plusIdx));
		var right = c32lib.normalize(str.substr(plusIdx + 1));
		return left && left.length >= 2 && right && right.length >= 2;
	}
	var normalized = c32lib.normalize(str);
	if(!normalized || normalized.length < 4) { return false; }
	return true;
}

// Find tiddlers by c32 value (full, partial, or prefix+suffix)
function findByC32(searchStr) {
	var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
	var prefix = null;
	var suffix = null;
	var plusIdx = searchStr.indexOf("+");
	if(plusIdx > 0 && plusIdx < searchStr.length - 1) {
		prefix = c32lib.normalize(searchStr.substr(0, plusIdx));
		suffix = c32lib.normalize(searchStr.substr(plusIdx + 1));
		if(!prefix || !suffix) { return []; }
	}
	var normalized = prefix ? null : c32lib.normalize(searchStr);
	if(!prefix && !normalized) { return []; }
	var titles = $tw.wiki.filterTiddlers("[has[c32]!is[system]]");
	var exact = [];
	var partial = [];
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler || !tiddler.fields.c32) { continue; }
		var c32val = tiddler.fields.c32;
		var c32raw = c32val.replace(/-/g, "");
		if(prefix && suffix) {
			var prefixRaw = prefix.replace(/-/g, "");
			var suffixRaw = suffix.replace(/-/g, "");
			if(c32raw.indexOf(prefixRaw) === 0 && c32raw.indexOf(suffixRaw, c32raw.length - suffixRaw.length) >= 0) {
				partial.push(titles[i]);
			}
		} else if(c32val === normalized) {
			exact.push(titles[i]);
		} else if(c32val.indexOf(normalized) >= 0 || c32raw.indexOf(normalized.replace(/-/g, "")) >= 0) {
			partial.push(titles[i]);
		}
	}
	return exact.concat(partial);
}

// Check if a string looks like a Base62id search (mixed case alphanumeric, min 4 chars)
// Also accepts prefix+suffix pattern like "FdAvK+P887i"
function isB62Search(str) {
	// Must contain at least one uppercase AND one lowercase letter (distinguishes from c32/hex)
	if(!/[A-Z]/.test(str) || !/[a-z]/.test(str)) { return false; }
	// Alphanumeric with optional single + separator, min 4 chars total
	return /^[0-9A-Za-z]{2,}\+[0-9A-Za-z]{2,}$/.test(str) ||
		/^[0-9A-Za-z]{4,}$/.test(str);
}

// Find tiddlers by Base62id value (exact, prefix, suffix, or substring match)
// Supports prefix+suffix pattern: "FdAvK+P887i"
function findByB62(searchStr) {
	var prefix = null;
	var suffix = null;
	var plusIdx = searchStr.indexOf("+");
	if(plusIdx > 0 && plusIdx < searchStr.length - 1) {
		prefix = searchStr.substr(0, plusIdx);
		suffix = searchStr.substr(plusIdx + 1);
	}
	var titles = $tw.wiki.filterTiddlers("[has[c62]!is[system]]");
	var exact = [];
	var partial = [];
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler || !tiddler.fields.c62) { continue; }
		var c62val = tiddler.fields.c62;
		if(prefix && suffix) {
			// prefix+suffix mode: both must match
			if(c62val.indexOf(prefix) === 0 && c62val.indexOf(suffix, c62val.length - suffix.length) >= 0) {
				partial.push(titles[i]);
			}
		} else if(c62val === searchStr) {
			exact.push(titles[i]);
		} else if(c62val.indexOf(searchStr) >= 0) {
			partial.push(titles[i]);
		}
	}
	return exact.concat(partial);
}

// Check if a string looks like a phrase search
function isPhraseSearch(str) {
	if(str.indexOf("+") === -1 && str.indexOf(",") === -1 && str.indexOf(";") === -1) {
		return false;
	}
	var cleaned = str.replace(/[+,;0-9]/g, " ").trim();
	return cleaned.length > 0 && /^[a-z\s]+$/.test(cleaned);
}

// Rewrite a location hash, resolving UUID/c32/phrase to tiddler title(s).
// Returns the rewritten hash string, or null if no match.
function rewriteHash(hash) {
	if(!hash || hash.length < 2) { return null; }
	var raw = hash.substr(1);
	var split = raw.indexOf(":");
	var target = split === -1 ? raw.trim() : raw.substr(0, split).trim();
	var decoded = $tw.utils.decodeURIComponentSafe(target);
	if($tw.wiki.tiddlerExists(decoded)) { return null; }
	// Try UUID lookup (exact, partial, or prefix+suffix)
	if(isUUIDSearch(decoded)) {
		var uuidMatches = findByUUID(decoded);
		if(uuidMatches.length === 1) {
			return "#" + encodeURIComponent(uuidMatches[0]);
		} else if(uuidMatches.length > 1) {
			var uuidStoryList = $tw.utils.stringifyList(uuidMatches);
			return "#" + encodeURIComponent(uuidMatches[0]) + ":" + encodeURIComponent(uuidStoryList);
		}
	}
	// Try Base62id lookup (full, partial, or prefix+suffix)
	if(isB62Search(decoded)) {
		var b62matches = findByB62(decoded);
		if(b62matches.length === 1) {
			return "#" + encodeURIComponent(b62matches[0]);
		} else if(b62matches.length > 1) {
			var b62storyList = $tw.utils.stringifyList(b62matches);
			return "#" + encodeURIComponent(b62matches[0]) + ":" + encodeURIComponent(b62storyList);
		}
	}
	// Try c32 lookup (full or partial)
	if(isC32Search(decoded)) {
		var c32matches = findByC32(decoded);
		if(c32matches.length === 1) {
			return "#" + encodeURIComponent(c32matches[0]);
		} else if(c32matches.length > 1) {
			var c32storyList = $tw.utils.stringifyList(c32matches);
			return "#" + encodeURIComponent(c32matches[0]) + ":" + encodeURIComponent(c32storyList);
		}
	}
	// Try phrase search
	if(isPhraseSearch(decoded)) {
		var matches = findAllByPhrase(decoded);
		if(matches.length > 0) {
			var storyList = $tw.utils.stringifyList(matches);
			return "#" + encodeURIComponent(matches[0]) + ":" + encodeURIComponent(storyList);
		}
	}
	return null;
}

exports.startup = function() {
	// Rewrite the location hash before the story module reads it
	if($tw.browser && $tw.locationHash) {
		var rewritten = rewriteHash($tw.locationHash);
		if(rewritten) {
			$tw.locationHash = rewritten;
		}
	}

	// Listen for hashchange to handle URL bar edits in existing windows.
	// TW's handler checks (hash !== $tw.locationHash) before processing.
	// We set $tw.locationHash = hash to make TW skip this event, then
	// replace the URL with the resolved title, triggering a new hashchange
	// that TW processes normally.
	if($tw.browser) {
		window.addEventListener("hashchange",function() {
			var hash = $tw.utils.getLocationHash();
			var rewritten = rewriteHash(hash);
			if(rewritten) {
				$tw.locationHash = hash;
				window.location.replace(
					window.location.toString().split("#")[0] + rewritten
				);
			}
		},false);
	}

	// Hook th-navigating for in-wiki navigation
	$tw.hooks.addHook("th-navigating",function(event) {
		var target = event.navigateTo;
		if(!target || $tw.wiki.tiddlerExists(target)) {
			return event;
		}
		// Try UUID lookup (exact, partial, or prefix+suffix)
		if(isUUIDSearch(target)) {
			var uuidMatches = findByUUID(target);
			if(uuidMatches.length === 1) {
				event.navigateTo = uuidMatches[0];
				return event;
			} else if(uuidMatches.length > 1) {
				event.navigateTo = uuidMatches[0];
				var uuidStoryTitle = event.navigateFromNode
					? event.navigateFromNode.getVariable("tv-story-list")
					: null;
				uuidStoryTitle = uuidStoryTitle || "$:/StoryList";
				var uuidStoryList = $tw.wiki.getTiddlerList(uuidStoryTitle);
				for(var u = uuidMatches.length - 1; u >= 0; u--) {
					if(uuidStoryList.indexOf(uuidMatches[u]) === -1) {
						uuidStoryList.unshift(uuidMatches[u]);
					}
				}
				$tw.wiki.addTiddler({
					title: uuidStoryTitle,
					text: "",
					list: uuidStoryList
				}, $tw.wiki.getModificationFields());
				return event;
			}
		}
		// Try Base62id lookup (full, partial, or prefix+suffix)
		if(isB62Search(target)) {
			var b62matches = findByB62(target);
			if(b62matches.length === 1) {
				event.navigateTo = b62matches[0];
				return event;
			} else if(b62matches.length > 1) {
				event.navigateTo = b62matches[0];
				var b62storyTitle = event.navigateFromNode
					? event.navigateFromNode.getVariable("tv-story-list")
					: null;
				b62storyTitle = b62storyTitle || "$:/StoryList";
				var b62storyList = $tw.wiki.getTiddlerList(b62storyTitle);
				for(var k = b62matches.length - 1; k >= 0; k--) {
					if(b62storyList.indexOf(b62matches[k]) === -1) {
						b62storyList.unshift(b62matches[k]);
					}
				}
				$tw.wiki.addTiddler({
					title: b62storyTitle,
					text: "",
					list: b62storyList
				}, $tw.wiki.getModificationFields());
				return event;
			}
		}
		// Try c32 lookup (full or partial)
		if(isC32Search(target)) {
			var c32matches = findByC32(target);
			if(c32matches.length === 1) {
				event.navigateTo = c32matches[0];
				return event;
			} else if(c32matches.length > 1) {
				event.navigateTo = c32matches[0];
				var storyTitle = event.navigateFromNode
					? event.navigateFromNode.getVariable("tv-story-list")
					: null;
				storyTitle = storyTitle || "$:/StoryList";
				var storyList = $tw.wiki.getTiddlerList(storyTitle);
				for(var j = c32matches.length - 1; j >= 0; j--) {
					if(storyList.indexOf(c32matches[j]) === -1) {
						storyList.unshift(c32matches[j]);
					}
				}
				$tw.wiki.addTiddler({
					title: storyTitle,
					text: "",
					list: storyList
				}, $tw.wiki.getModificationFields());
				return event;
			}
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
