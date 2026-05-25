/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/fountain-transition.js
type: application/javascript
module-type: wikirule

Fountain transitions outside the named-keyword marker set:

1. ''Auto-detected.'' An uppercase line ending with `TO:`, preceded by
   a blank line and followed by a blank line (or end of input). Covers
   generic transitions like `JUMP TO:` or `ROLL TO:`. Gated on
   `auto-transition: yes` on an active vocab.

2. ''Forced.'' A line starting with `>` (no trailing `<`, which would
   make it a centered line). Any text — uppercase or mixed case —
   becomes the transition body. Gated on `forced-transition: yes` on an
   active vocab. The `>` and any leading space after it are stripped.

If a candidate auto line matches the open of an active word marker
(e.g. `CUT TO:`), this rule yields so the specific marker fires
instead.

\*/

"use strict";

// Auto-detected: blank-before, uppercase ... TO:, blank-after.
var AUTO_RE = /(?<=^|\n\n)([ \t]*)([A-Z][A-Z0-9 .'\-]*TO:)[ \t]*\n(?=\n|(?![\s\S]))/g;

// Forced: blank-before, `>` then optional space then a non-empty body
// whose last non-whitespace char is not `<` (which would mean centered).
// Trailing whitespace + newline.
var FORCED_RE = /(?<=^|\n\n)([ \t]*)>[ \t]*(\S[^\n]*?)(?<!<)[ \t]*\n/g;

exports.name = "fountain-transition";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	// matchRegExp is informational; we re-derive per-call below.
	this.matchRegExp = AUTO_RE;
	$tw.utils.CmRegistry.ensureRegistry(parser);
};

exports.findNextMatch = function(startPos) {
	var registry = this.parser.cmRegistry;
	if(!registry) { return undefined; }
	var wantAuto = registry.hasVocabFlag("auto-transition");
	var wantForced = registry.hasVocabFlag("forced-transition");
	if(!wantAuto && !wantForced) { return undefined; }

	var autoMatch = wantAuto ? nextAutoMatch(this.parser.source, startPos, registry) : null;
	var forcedMatch = wantForced ? nextForcedMatch(this.parser.source, startPos) : null;

	var pick = pickEarlier(autoMatch, forcedMatch);
	if(!pick) { return undefined; }
	this.match = pick.match;
	this.mode = pick.mode;
	return pick.match.index;
};

exports.parse = function() {
	var match = this.match;
	var label = this.mode === "forced" ? match[2] : match[2];
	this.parser.pos = match.index + match[0].length;
	return [{
		type: "element",
		tag: "p",
		attributes: {
			"class": {type: "string", value: "wltc-fountain-transition"}
		},
		children: [{type: "text", text: label}]
	}];
};

function nextAutoMatch(source, startPos, registry) {
	var regex = new RegExp(AUTO_RE.source, "g");
	regex.lastIndex = startPos;
	while(true) {
		var m = regex.exec(source);
		if(!m) { return null; }
		if(specificMarkerWins(m[2], registry)) {
			regex.lastIndex = m.index + 1;
			continue;
		}
		return m;
	}
}

function nextForcedMatch(source, startPos) {
	var regex = new RegExp(FORCED_RE.source, "g");
	regex.lastIndex = startPos;
	var m = regex.exec(source);
	return m || null;
}

function pickEarlier(a, b) {
	if(a && b) { return a.index <= b.index ? {match: a, mode: "auto"} : {match: b, mode: "forced"}; }
	if(a) { return {match: a, mode: "auto"}; }
	if(b) { return {match: b, mode: "forced"}; }
	return null;
}

// Returns true if the candidate line text matches an active word
// marker's open literal (case-insensitive when the marker opts in).
// When true the marker engine will fire its specific marker and we
// should yield.
function specificMarkerWins(lineText, registry) {
	var markers = registry.list();
	for(var i = 0; i < markers.length; i++) {
		var m = markers[i];
		if(m.kind !== "word") { continue; }
		if(!registry.isActive(m.open)) { continue; }
		if(m.caseInsensitive) {
			var head = lineText.substring(0, m.open.length);
			if(head.toLowerCase() === m.open.toLowerCase()) { return true; }
		} else if(lineText.indexOf(m.open) === 0) {
			return true;
		}
	}
	return false;
}
