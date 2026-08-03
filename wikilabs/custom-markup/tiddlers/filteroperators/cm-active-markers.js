/*\
title: $:/plugins/wikilabs/custom-markup/filteroperators/cm-active-markers.js
type: application/javascript
module-type: filteroperator

Filter operator returning marker tiddler titles active in the source
tiddler's vocabulary. Usage: `[<currentTiddler>cm-active-markers[block]]`.

Operand selects marker kinds:
  block       glyph + glyph-level (line-prefix markers)
  inline      inline-pair
  word        word markers only
  glyph       glyph + glyph-level (alias of block)
  (empty)     all kinds

Vocabularies come from the source tiddler's `type` field, parsed for
`text/vnd.tiddlywiki;vocab=A,B`. With no `;vocab=` parameter, falls back
to `Default`.

\*/

"use strict";

exports["cm-active-markers"] = function(source, operator, options) {
	var wiki = options.wiki;
	var kindOperand = operator.operand || "";
	var results = [];
	var seen = Object.create(null);
	var hadInput = false;

	var collect = function(typeStr) {
		var markerTags = activeMarkerTags(wiki, typeStr);
		if(markerTags.length === 0) { return; }
		var markers = wiki.filterTiddlers(
			"[all[shadows+tiddlers]tag[$:/tags/CustomMarkup/Marker]]"
		);
		markers.forEach(function(mt) {
			if(seen[mt]) { return; }
			var m = wiki.getTiddler(mt);
			if(!m) { return; }
			if(!matchesKind(m.fields.kind, kindOperand)) { return; }
			var mTags = m.fields.tags || [];
			var isActive = mTags.some(function(tg) {
				return markerTags.indexOf(tg) !== -1;
			});
			if(isActive) {
				seen[mt] = true;
				results.push(mt);
			}
		});
	};

	source(function(tiddler) {
		hadInput = true;
		collect((tiddler && tiddler.fields && tiddler.fields.type) || "");
	});

	// Empty source (e.g. $:/HistoryList not yet populated) falls back to
	// Default vocab so the editor toolbar still shows usable markers.
	if(!hadInput) {
		collect("");
	}
	return results;
};

function activeMarkerTags(wiki, typeStr) {
	var match = /;\s*vocab\s*=\s*([^;]+)/.exec(typeStr);
	var vocabNames = match
		? match[1].split(",").map(function(s) { return s.trim(); }).filter(Boolean)
		: ["Default"];
	var tags = [];
	vocabNames.forEach(function(name) {
		var vocabTitle = "vocab/" + name.toLowerCase();
		var meta = wiki.getTiddler(vocabTitle);
		if(!meta) { return; }
		var metaTags = meta.fields.tags;
		if(!metaTags || metaTags.indexOf("$:/tags/CustomMarkup/Vocabulary") === -1) { return; }
		tags.push(vocabTitle);
	});
	return tags;
}

function matchesKind(kind, operand) {
	switch(operand) {
		case "":
			return true;
		case "block":
		case "glyph":
			return kind === "glyph" || kind === "glyph-level";
		case "inline":
			return kind === "inline-pair";
		case "word":
			return kind === "word";
		default:
			return kind === operand;
	}
}
