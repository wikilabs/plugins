/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/front-matter.js
type: application/javascript
module-type: wikirule

YAML front-matter block. Fires only at parser.pos === 0 and only when
an activated vocab meta tiddler declares `front-matter: yes`. Reads
lines from the top of the source until a blank line or a `===` (or
longer) separator and hands the captured text to the YAML library;
the resulting object becomes one row per top-level key in the rendered
`<div class="wltc-front-matter">`.

The capture phase accepts both `Key: Value` lines and continuation
lines that begin with whitespace, so YAML's spec-compliant multi-line
values (Fountain title-page `Notes:\n\tline\n\tline`) survive into the
parser. The first line must still look like a top-level `Key:` so we
don't grab arbitrary prose.

Rendering keeps the previous structure: each top-level pair produces a
`<div class="wltc-front-matter-row" data-key="<Key>">` with a hidden
key span and a value span. Scalar values render directly; arrays
render as comma-joined strings; nested maps fall back to a JSON-ish
inline form (the simple title-page case rarely needs more).

\*/

"use strict";

var yaml = require("$:/plugins/wikilabs/custom-markup/yaml.js");

// Match a top-level `Key:` line. Key must start with an uppercase
// letter so we don't catch random `word: thing` mid-sentence; allow
// word chars, hyphens, and embedded single spaces so multi-word keys
// like `Draft date:` survive (common in Fountain title pages). The
// trailing assertion requires whitespace or end-of-line after the
// colon to avoid matching URLs (`https:` ...).
var KEY_LINE_RE = /^[A-Z][\w-]*(?:[ ][\w-]+)*:(?:[ \t]|$)/;
var SEPARATOR_RE = /^={3,}[ \t]*$/;

exports.name = "frontmatter";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
	}
};

exports.findNextMatch = function(startPos) {
	if(startPos !== 0) { return undefined; }
	if(!this.parser.cmRegistry.hasFrontMatter()) { return undefined; }
	var firstLine = readLine(this.parser.source, 0);
	if(!KEY_LINE_RE.test(firstLine.text)) { return undefined; }
	this.match = [firstLine.text];
	return 0;
};

exports.parse = function() {
	var source = this.parser.source;
	var pos = 0;
	var captured = [];
	while(pos < source.length) {
		var line = readLine(source, pos);
		if(line.text === "" || /^\s*$/.test(line.text)) {
			pos = line.nextPos;
			break;
		}
		if(SEPARATOR_RE.test(line.text)) {
			pos = line.nextPos;
			break;
		}
		// Accept top-level Key: lines, or continuation lines that begin
		// with whitespace (YAML's spec for multi-line scalar values).
		// Anything else ends the block without consuming the offending
		// line, so the next rule can handle it.
		if(!KEY_LINE_RE.test(line.text) && !/^[ \t]/.test(line.text)) {
			break;
		}
		captured.push(line.text);
		pos = line.nextPos;
	}
	this.parser.pos = pos;
	if(captured.length === 0) { return []; }
	var parsed;
	try {
		parsed = yaml.load(captured.join("\n"));
	} catch(e) {
		// If YAML parsing fails, treat the block as not-front-matter:
		// rewind the parser to before the block so the lines render via
		// regular rules.
		this.parser.pos = 0;
		return [];
	}
	if(!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		this.parser.pos = 0;
		return [];
	}
	var keys = Object.keys(parsed);
	if(keys.length === 0) { return []; }
	var children = keys.map(function(key) {
		var value = parsed[key];
		return {
			type: "element", tag: "div",
			attributes: {
				"class": {type: "string", value: "wltc-front-matter-row"},
				"data-key": {type: "string", value: key}
			},
			children: [
				{
					type: "element", tag: "span",
					attributes: {"class": {type: "string", value: "wltc-front-matter-key"}},
					children: [{type: "text", text: key + ": "}]
				},
				{
					type: "element", tag: "span",
					attributes: {"class": {type: "string", value: "wltc-front-matter-value"}},
					children: [{type: "text", text: formatValue(value)}]
				}
			]
		};
	});
	return [{
		type: "element", tag: "div",
		attributes: {"class": {type: "string", value: "wltc-front-matter"}},
		children: children
	}];
};

// Coerce a parsed YAML value into a single display string. The common
// title-page cases are strings; arrays show as comma-joined; anything
// else (object, null) falls back to JSON so the user at least sees the
// data rather than `[object Object]`.
function formatValue(value) {
	if(value === null || value === undefined) { return ""; }
	if(typeof value === "string") { return value; }
	if(typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if(Array.isArray(value)) {
		return value.map(formatValue).join(", ");
	}
	try {
		return JSON.stringify(value);
	} catch(e) {
		return String(value);
	}
}

function readLine(source, pos) {
	var nlIdx = source.indexOf("\n", pos);
	if(nlIdx === -1) {
		return {text: source.substring(pos), nextPos: source.length};
	}
	var text = source.substring(pos, nlIdx);
	if(text.charAt(text.length - 1) === "\r") {
		text = text.substring(0, text.length - 1);
	}
	return {text: text, nextPos: nlIdx + 1};
}
