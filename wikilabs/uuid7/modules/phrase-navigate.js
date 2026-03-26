/*\
title: $:/plugins/wikilabs/uuid7/phrase-navigate.js
type: application/javascript
module-type: startup

Phrase-based URL navigation
============================
Runs BEFORE the story module. If the URL hash contains words separated
by + (e.g. #metal+dog+soars) and no tiddler with that title exists,
rewrite $tw.locationHash to open all matching tiddlers.

Also hooks th-navigating for in-wiki navigation.

\*/

"use strict";

exports.name = "uuid7-phrase-navigate";
exports.before = ["story"];
exports.after = ["startup"];
exports.synchronous = true;

function findAllByPhrase(searchText) {
	var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
	var titles = $tw.wiki.filterTiddlers("[has[c7]]");
	var matches = [];
	for(var i = 0; i < titles.length; i++) {
		var tiddler = $tw.wiki.getTiddler(titles[i]);
		if(!tiddler || !tiddler.fields.c7) { continue; }
		var enc = phraselib.encodeUUID(tiddler.fields.c7);
		if(enc.phrase) {
			var fullPhrase = enc.phrase.join(", ").toLowerCase();
			if(fullPhrase.indexOf(searchText) >= 0) {
				matches.push(titles[i]);
			}
		}
	}
	return matches;
}

exports.startup = function() {
	// Rewrite the location hash before the story module reads it
	if($tw.browser && $tw.locationHash && $tw.locationHash.length > 1) {
		var hash = $tw.locationHash.substr(1);
		var split = hash.indexOf(":");
		var target = split === -1 ? hash.trim() : hash.substr(0, split).trim();
		var decoded = $tw.utils.decodeURIComponentSafe(target);
		// Must contain + to be a phrase URL
		if(decoded.indexOf("+") >= 0) {
			var searchText = decoded.replace(/\+/g, " ").trim().toLowerCase();
			if(searchText && /^[a-z\s]+$/.test(searchText)) {
				if(!$tw.wiki.tiddlerExists(decoded)) {
					var matches = findAllByPhrase(searchText);
					if(matches.length > 0) {
						// Rewrite hash as permaview: first match is target, all matches in story
						var storyList = $tw.utils.stringifyList(matches);
						$tw.locationHash = "#" + encodeURIComponent(matches[0]) + ":" + encodeURIComponent(storyList);
					}
				}
			}
		}
	}

	// Hook th-navigating for in-wiki navigation (links, search)
	$tw.hooks.addHook("th-navigating",function(event) {
		var target = event.navigateTo;
		if(!target || $tw.wiki.tiddlerExists(target)) {
			return event;
		}
		if(target.indexOf("+") === -1) { return event; }
		var searchText = target.replace(/\+/g, " ").trim().toLowerCase();
		if(!searchText || !/^[a-z\s]+$/.test(searchText)) {
			return event;
		}
		var matches = findAllByPhrase(searchText);
		if(matches.length > 0) {
			// Navigate to first match
			event.navigateTo = matches[0];
			// Add all matches to the story
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
