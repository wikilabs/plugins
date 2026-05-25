/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/fountain-page-break.js
type: application/javascript
module-type: wikirule

Fountain page break: a line of three or more `=` characters, preceded
by a blank line (or start of input) and followed by a blank line (or
end of input). Emits `<div class="wltc-fountain-page-break"></div>`;
print CSS turns it into a `page-break-after: always` so PDF / paper
output respects the author's hard breaks.

The title-page terminator is also `===`, but the front-matter rule
fires first (only at `parser.pos === 0`) and consumes its own
separator. By the time this rule sees source after position 0, any
title-page `===` is already gone.

Gated on `page-break: yes` on an active vocab (e.g. vocab/fountain).

\*/

"use strict";

// Blank-before, indent (captured but ignored), 3+ `=`, trailing
// whitespace, newline, then blank-after (a second newline or end of
// input). Same shape as fountain-transition's auto rule.
var PB_RE = /(?<=^|\n\n)([ \t]*)={3,}[ \t]*\n(?=\n|(?![\s\S]))/g;

exports.name = "fountain-page-break";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = PB_RE;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
	}
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("page-break")) {
		return undefined;
	}
	var regex = new RegExp(PB_RE.source, "g");
	regex.lastIndex = startPos;
	var match = regex.exec(this.parser.source);
	if(!match) { return undefined; }
	this.match = match;
	return match.index;
};

exports.parse = function() {
	this.parser.pos = this.match.index + this.match[0].length;
	return [{
		type: "element",
		tag: "div",
		attributes: {
			"class": {type: "string", value: "wltc-fountain-page-break"}
		}
	}];
};
