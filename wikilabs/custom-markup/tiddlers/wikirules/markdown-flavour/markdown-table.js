/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/markdown-table.js
type: application/javascript
module-type: wikirule

Markdown-style table block rule. Fires only when the markdown vocabulary
is active for the tiddler being parsed.

Recognises pipe-syntax tables with a required separator row:

```
| Header 1 | Header 2 | Header 3 |
|----------|:--------:|---------:|
| left     | centre   | right    |
| cell     | cell     | cell     |
```

Alignment derives from the separator row's colons: `:-` left,
`:-:` centre, `-:` right, plain `-` defaults to left. A blank line or any
line not starting with `|` ends the table. Cells are emitted as plain
text in v1; inline emphasis inside cells is a future enhancement.

\*/

"use strict";

exports.name = "markdown-table";
exports.types = {block: true};

// Match a header row immediately followed by a separator row. The
// separator constraint is what distinguishes a real markdown table from
// any other line that happens to contain pipes.
var TABLE_RE = /^[ \t]*\|[^\r\n]+\|[ \t]*\r?\n[ \t]*\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*(?:\r?\n|$)/mg;
var ROW_RE = /^[ \t]*\|([^\r\n]*?)\|[ \t]*(\r?\n|$)/mg;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = TABLE_RE;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
	}
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.isActiveVocab("vocab/markdown")) {
		return undefined;
	}
	var regex = new RegExp(TABLE_RE.source, "mg");
	regex.lastIndex = startPos;
	var match = regex.exec(this.parser.source);
	if(!match) { return undefined; }
	this.match = match;
	return match.index;
};

exports.parse = function() {
	var parser = this.parser;
	var headerCells = readInlineRow(parser);
	if(!headerCells) { return [textFallback(parser)]; }
	var separatorText = readPlainRow(parser);
	if(separatorText === null) { return [textFallback(parser)]; }
	var alignments = separatorText.split("|").map(function(c) {
		return c.replace(/^[ \t]+|[ \t]+$/g, "");
	}).map(parseAlignment);

	var dataRows = [];
	while(parser.pos < parser.source.length) {
		var saved = parser.pos;
		var cells = readInlineRow(parser);
		if(!cells) { parser.pos = saved; break; }
		dataRows.push(cells);
	}

	return [buildTable(headerCells, dataRows, alignments)];
};

// Read one row as plain text (used for the separator). Returns the inner
// content (between first and last `|`), advances parser.pos past the
// trailing newline. Null if not a pipe row.
function readPlainRow(parser) {
	var regex = new RegExp(ROW_RE.source, "mg");
	regex.lastIndex = parser.pos;
	var match = regex.exec(parser.source);
	if(!match || match.index !== parser.pos) { return null; }
	parser.pos = match.index + match[0].length;
	return match[1];
}

// Read one row with each cell parsed as an inline run, so emphasis
// markers inside cells (e.g. `*italic*`, `` `code` ``) fire. Advances
// parser.pos past the trailing newline. Null if not a pipe row.
function readInlineRow(parser) {
	var src = parser.source;
	var startPos = parser.pos;
	// Find row extent: from current pos to end-of-line.
	var nlIdx = src.indexOf("\n", startPos);
	if(nlIdx === -1) { nlIdx = src.length; }
	// Trim trailing whitespace (including any \r before \n).
	var rowEnd = nlIdx;
	while(rowEnd > startPos && /[ \t\r]/.test(src.charAt(rowEnd - 1))) { rowEnd--; }
	// Row must start (after optional indent) and end with `|`.
	var probe = startPos;
	while(probe < rowEnd && /[ \t]/.test(src.charAt(probe))) { probe++; }
	if(src.charAt(probe) !== "|" || src.charAt(rowEnd - 1) !== "|") { return null; }

	parser.pos = probe + 1; // past the opening `|`
	var cells = [];
	while(parser.pos < rowEnd - 1) {
		// Trim leading whitespace inside the cell.
		while(parser.pos < rowEnd - 1 && /[ \t]/.test(src.charAt(parser.pos))) { parser.pos++; }
		// Parse inline content until the next `|` (or end of row).
		var cellTerm = /\|/g;
		var children = parser.parseInlineRun(cellTerm);
		trimTrailingWhitespace(children);
		cells.push(children);
		// Step past the `|` separator.
		if(parser.pos < rowEnd && src.charAt(parser.pos) === "|") { parser.pos++; }
		else { break; }
	}
	// Advance past the closing `|` (if not already) and the newline.
	parser.pos = nlIdx < src.length ? nlIdx + 1 : nlIdx;
	return cells;
}

function trimTrailingWhitespace(children) {
	if(children.length === 0) { return; }
	var last = children[children.length - 1];
	if(last && last.type === "text" && typeof last.text === "string") {
		last.text = last.text.replace(/[ \t]+$/, "");
		if(last.text === "") { children.pop(); }
	}
}

// Parse one separator cell like "---", ":---", "---:", ":---:" into
// "left" / "centre" / "right". Anything else defaults to "left".
function parseAlignment(cell) {
	var trimmed = cell.replace(/^[ \t]+|[ \t]+$/g, "");
	var leadsColon = trimmed.charAt(0) === ":";
	var trailsColon = trimmed.charAt(trimmed.length - 1) === ":";
	if(leadsColon && trailsColon) { return "center"; }
	if(trailsColon) { return "right"; }
	return "left";
}

function buildTable(headerCells, dataRows, alignments) {
	function cellNode(tag, children, align) {
		var attrs = {};
		if(align && align !== "left") {
			attrs.style = {type: "string", value: "text-align:" + align};
		}
		return {
			type: "element",
			tag: tag,
			attributes: attrs,
			children: children
		};
	}
	function rowNode(cells, tag) {
		return {
			type: "element",
			tag: "tr",
			children: cells.map(function(c, i) {
				return cellNode(tag, c, alignments[i] || "left");
			})
		};
	}
	return {
		type: "element",
		tag: "table",
		children: [
			{
				type: "element",
				tag: "thead",
				children: [rowNode(headerCells, "th")]
			},
			{
				type: "element",
				tag: "tbody",
				children: dataRows.map(function(r) { return rowNode(r, "td"); })
			}
		]
	};
}

// Last-resort fallback used when findNextMatch matched a position but
// parse() couldn't read a valid header/separator pair (shouldn't happen
// with our tight regex, but defends against future regex drift).
function textFallback(parser) {
	var nlIdx = parser.source.indexOf("\n", parser.pos);
	if(nlIdx === -1) { nlIdx = parser.source.length; }
	var text = parser.source.substring(parser.pos, nlIdx);
	parser.pos = nlIdx + 1;
	return {type: "text", text: text};
}
