/*\
title: $:/plugins/wikilabs/custom-markup/editor/operations/text/remove-custom-markers.js
type: application/javascript
module-type: texteditoroperation

Strip Custom-Markup line prefixes from selected lines. The regex is
rebuilt at operation time from every block-position marker tiddler
(kind glyph or glyph-level) tagged $:/tags/CustomMarkup/Marker. Word
markers are excluded because their open literals are full words and
not appropriate to strip character-by-character.

\*/

"use strict";

exports["remove-custom-markers"] = function(event, operation) {
	var regExp = buildMarkerStripRegex();
	operation.cutStart = $tw.utils.findPrecedingLineBreak(operation.text, operation.selStart);
	operation.cutEnd = $tw.utils.findFollowingLineBreak(operation.text, operation.selEnd);
	var lines = operation.text.substring(operation.cutStart, operation.cutEnd).split(/\r?\n/mg);

	$tw.utils.each(lines, function(line, index) {
		var fragments = line.split(" ");
		var match = fragments[0].match(regExp);
		if(match && fragments[0] === match[0]) {
			line = fragments.slice(1).join(" ");
		} else {
			line = fragments.join(" ");
		}
		while(line.charAt(0) === " ") {
			line = line.substring(1);
		}
		lines[index] = line;
	});

	operation.replacement = lines.join("\n");
	if(lines.length === 1) {
		operation.newSelStart = operation.cutStart + operation.replacement.length;
		operation.newSelEnd = operation.newSelStart;
	} else {
		operation.newSelStart = operation.cutStart;
		operation.newSelEnd = operation.newSelStart + operation.replacement.length;
	}
};

function buildMarkerStripRegex() {
	var titles = $tw.wiki.filterTiddlers(
		"[all[shadows+tiddlers]tag[$:/tags/CustomMarkup/Marker]!field:kind[inline-pair]!field:kind[word]]"
	);
	var markers = [];
	titles.forEach(function(title) {
		var tid = $tw.wiki.getTiddler(title);
		if(tid && tid.fields.open) {
			markers.push({open: tid.fields.open, kind: tid.fields.kind});
		}
	});
	if(markers.length === 0) {
		return /(?!)/;
	}
	var openArm = buildOpenArm(markers);
	var symbolArm = buildSymbolArm(markers);
	var classChainArm = String.raw`(?:\.[^.\r\n\s]+)*`;
	return new RegExp(String.raw`(${openArm})${symbolArm}${classChainArm}`, "mg");
}

// One regex alternative per marker. Glyph-level markers (», ›) may repeat
// up to 4 times (»» for level 2, »»» for level 3, and so on).
function buildOpenArm(markers) {
	return markers.map(function(m) {
		var open = $tw.utils.escapeRegExp(m.open);
		return m.kind === "glyph-level"
			? String.raw`(?:${open}){1,4}`
			: open;
	}).join("|");
}

// The symbol char-class excludes every marker's first char so the symbol
// doesn't eat into a following marker's open literal.
function buildSymbolArm(markers) {
	var firstChars = markers.map(function(m) {
		return $tw.utils.escapeRegExp(m.open.charAt(0));
	}).join("");
	return String.raw`(?:[^.\r\n\s${firstChars}]+)?`;
}
