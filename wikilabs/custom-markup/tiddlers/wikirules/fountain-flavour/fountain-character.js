/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/fountain-character.js
type: application/javascript
module-type: wikirule

Fountain-style automatic character cue detection. A line entirely in
uppercase (letters, digits, space, period, apostrophe, hyphen),
preceded by a blank line (or start of input) and followed immediately
by a non-blank line, renders as a Fountain character cue. An optional
same-line parenthetical extension (`MOM (O. S.)`, `HANS (on the
radio)`) is included in the rendered cue with its original case
preserved.

Character names must contain at least one alphabetical character per
the Fountain spec — the leading `[A-Z]` requirement satisfies this.

Dual dialogue: a trailing caret `^` on the cue line (any number of
spaces before it, ignored) marks the cue as the second speaker in a
simultaneous-dialogue pair. The caret is stripped from the rendered
cue and the wrapping div picks up `wltc-fountain-cue-block-dual` so
CSS can lay the pair out side-by-side.

The rule consumes both the cue line AND the following dialogue
paragraph (up to the next blank line) and wraps them in a single
`<div class="wltc-fountain-cue-block">`. Wrapping is required so dual
dialogue can be styled as adjacent columns; without a wrapper, the
flat sequence of cue/dialogue paragraphs can't be reliably grouped
via CSS sibling selectors.

Fires only when an activated vocabulary opts in via
`auto-character: yes` (e.g. vocab/fountain).

Disambiguation from scene headings: Fountain word markers in the same
vocab should set `trailing-blank: yes` on their marker tiddlers so that
`INT. KITCHEN\nJane enters.` (no trailing blank) falls through to
auto-character, while `INT. KITCHEN\n\nJane enters.` (with trailing
blank) fires as a scene heading.

\*/

"use strict";

exports.name = "fountain-character";
exports.types = {block: true};

// (?<=^|\n\n)  preceded by start-of-input or a blank line.
// ([ \t]*)     optional indent (captured but ignored on render).
// (            cue:
//   [A-Z]                          must start with an uppercase letter
//   [A-Z0-9 .'\-]*?                uppercase/digit/punctuation, lazy
//   (?:\s*\([^)\n]*\))?            optional same-line parenthetical
// )
// [ \t]*       trailing whitespace allowed before the dual marker
// (\^)?        optional caret = dual dialogue
// [ \t]*\n     trailing whitespace + cue-line newline
// (?=[ \t]*\S) next line is non-blank (allows indented dialogue)
var CHAR_RE = /(?<=^|\n\n)([ \t]*)([A-Z][A-Z0-9 .'\-]*?(?:\s*\([^)\n]*\))?)[ \t]*(\^)?[ \t]*\n(?=[ \t]*\S)/g;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = CHAR_RE;
	$tw.utils.CmRegistry.ensureRegistry(parser);
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("auto-character")) {
		return undefined;
	}
	var regex = new RegExp(CHAR_RE.source, "g");
	regex.lastIndex = startPos;
	var match = regex.exec(this.parser.source);
	if(!match) { return undefined; }
	this.match = match;
	return match.index;
};

exports.parse = function() {
	var match = this.match;
	var cueName = match[2];
	var isDual = !!match[3];

	// Advance past the cue line; parser.pos now points at the dialogue.
	this.parser.pos = match.index + match[0].length;

	// Consume the dialogue paragraph: inline content up to the next blank
	// line (or end of input). preserve-newlines (vocab-active) converts
	// intra-paragraph `\n` to `<br>`, so multi-line dialogue and
	// parentheticals on their own lines render with line breaks.
	var dialogueChildren = this.parser.parseInlineRun(/(\r?\n\r?\n)/mg, {eatTerminator: true});

	var classes = "wltc-fountain-cue-block";
	if(isDual) { classes += " wltc-fountain-cue-block-dual"; }

	return [{
		type: "element",
		tag: "div",
		attributes: {
			"class": {type: "string", value: classes}
		},
		children: [
			{
				type: "element",
				tag: "p",
				attributes: {
					"class": {type: "string", value: "wltc-fountain-character"}
				},
				children: [{type: "text", text: cueName}]
			},
			{
				type: "element",
				tag: "p",
				attributes: {
					"class": {type: "string", value: "wltc-fountain-dialogue"}
				},
				children: dialogueChildren
			}
		]
	}];
};
