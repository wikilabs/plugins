/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/markdown-newline.js
type: application/javascript
module-type: wikirule

Preserve intra-paragraph newlines: every single `\n` (or `\r\n`) emits
a `<br>`. Blank-line paragraph breaks already work via TW's block
parser, which terminates the inline run at `\n\n` before this rule can
see the second newline — so this rule only fires on single newlines
inside a paragraph, never on the boundary between paragraphs.

Fires when any activated vocab opts in via `preserve-newlines: yes`
(e.g. vocab/markdown, vocab/fountain).

\*/

"use strict";

exports.name = "markdown-newline";
exports.types = {inline: true};

// Kept for informational `matchRegExp` (some TW internals inspect it).
// The hot scan path below uses indexOf instead — `\n` is the most common
// character in multi-paragraph content and a regex allocation per call
// is wasteful for a fixed two-char pattern.
var NL_RE = /\r?\n/g;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = NL_RE;
	$tw.utils.CmRegistry.ensureRegistry(parser);
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("preserve-newlines")) {
		return undefined;
	}
	var source = this.parser.source;
	var nlIdx = source.indexOf("\n", startPos);
	if(nlIdx === -1) { return undefined; }
	// Mirror `\r?\n`: include a preceding `\r` in the match when present
	// AND within the current search window.
	var matchIdx = (nlIdx > startPos && source.charAt(nlIdx - 1) === "\r")
		? nlIdx - 1
		: nlIdx;
	this.matchEnd = nlIdx + 1;
	return matchIdx;
};

exports.parse = function() {
	this.parser.pos = this.matchEnd;
	return [{type: "element", tag: "br"}];
};
