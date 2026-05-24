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

var NL_RE = /\r?\n/g;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = NL_RE;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
	}
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("preserve-newlines")) {
		return undefined;
	}
	var regex = new RegExp(NL_RE.source, "g");
	regex.lastIndex = startPos;
	var match = regex.exec(this.parser.source);
	if(!match) { return undefined; }
	this.match = match;
	return match.index;
};

exports.parse = function() {
	this.parser.pos = this.match.index + this.match[0].length;
	return [{type: "element", tag: "br"}];
};
