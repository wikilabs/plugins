/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/markdown-flavour/markdown-ref-def.js
type: application/javascript
module-type: wikirule

CommonMark reference-link definitions: `[label]: target "optional title"`
at line start (up to 3 leading spaces). The target may be wrapped in
`<...>` to allow whitespace. Captures into `parser.cmRegistry.linkRefs`
so the `vocab/markdown/LINK-REF` marker can resolve `[text][label]` and
similar reference shapes at parse time. Defs must appear BEFORE their
usages in the source (single-pass; no pre-scan).

Emits nothing — ref-defs are invisible per CommonMark. Fires when any
active vocab opts in via `reference-links: yes` (vocab/markdown by
default).

\*/

"use strict";

exports.name = "markdown-ref-def";
exports.types = {block: true};

// 0-3 spaces of indent, then `[label]:`, optional whitespace, then the
// target either as `<wrapped>` (allows spaces inside) or as a bare
// non-whitespace run, then optional `"title"` / `'title'` / `(title)`,
// then optional trailing whitespace and EOL.
var REF_DEF_RE = /^[ ]{0,3}\[((?:\\[\\\[\]]|[^\]\\\r\n])+)\]:[ \t]*(?:<([^>\r\n]*)>|([^\s<>][^\s]*))(?:[ \t]+(?:"([^"\r\n]*)"|'([^'\r\n]*)'|\(([^)\r\n]*)\)))?[ \t]*(?:\r?\n|$)/mg;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = REF_DEF_RE;
	$tw.utils.CmRegistry.ensureRegistry(parser);
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("reference-links")) {
		return undefined;
	}
	this.matchRegExp.lastIndex = startPos;
	this.match = this.matchRegExp.exec(this.parser.source);
	return this.match ? this.match.index : undefined;
};

exports.parse = function() {
	this.parser.pos = this.matchRegExp.lastIndex;
	var label = $tw.utils.CmRegistry.normalizeRefLabel(this.match[1]);
	// Target is whichever capture group matched: `<wrapped>` or bare.
	var target = this.match[2] !== undefined ? this.match[2] : this.match[3];
	// Title is whichever of the three quote styles matched.
	var title = this.match[4] || this.match[5] || this.match[6] || "";

	var registry = this.parser.cmRegistry;
	if(!registry.linkRefs) { registry.linkRefs = Object.create(null); }
	// CommonMark: first definition wins (later same-label defs are ignored).
	if(!registry.linkRefs[label]) {
		registry.linkRefs[label] = {target: target, title: title};
	}

	// Ref-defs are invisible per CommonMark spec.
	return [];
};
