/*\
title: $:/core/modules/commands/inspect/hashline.js
type: application/javascript
module-type: library

HashLine Edits — content-addressed line editing with conflict detection.
Ported from oh-my-pi (MIT, Can Bölük & Mario Zechner).

\*/

"use strict";

var crypto = require("crypto");

var HASH_SEP = ": ";
var NIBBLE_STR = "ZPMQVRWSNKTXJBYH";
var DICT = [];
for(var i = 0; i < 256; i++) {
	DICT.push(NIBBLE_STR[i >>> 4] + NIBBLE_STR[i & 0x0f]);
}

var RE_SIGNIFICANT = /[\p{L}\p{N}]/u;
var RE_TAG = /^\s*[>+-]*\s*(\d+)\s*#\s*([ZPMQVRWSNKTXJBYH]{2})/;

function hash32(line, seed) {
	var buf = Buffer.from(seed + ":" + line);
	return crypto.createHash("md5").update(buf).digest().readUInt32LE(0);
}

function computeLineHash(idx, line) {
	line = line.replace(/\r/g, "").trimEnd();
	var seed = 0;
	if(!RE_SIGNIFICANT.test(line)) {
		seed = idx;
	}
	return DICT[hash32(line, seed) & 0xff];
}

function formatLineTag(line, lineText) {
	return line + "#" + computeLineHash(line, lineText);
}

function formatHashLines(text) {
	var lines = text.split("\n");
	var result = [];
	for(var i = 0; i < lines.length; i++) {
		var num = i + 1;
		result.push(formatLineTag(num, lines[i]) + HASH_SEP + lines[i]);
	}
	return result.join("\n");
}

function parseTag(ref) {
	var match = ref.match(RE_TAG);
	if(!match) {
		throw new Error("Invalid line reference \"" + ref + "\". Expected format \"LINE#ID\" (e.g. \"5#AB\").");
	}
	var line = parseInt(match[1], 10);
	if(line < 1) {
		throw new Error("Line number must be >= 1, got " + line);
	}
	return { line: line, hash: match[2] };
}

function validateLineRef(ref, fileLines) {
	if(ref.line < 1 || ref.line > fileLines.length) {
		throw new Error("Line " + ref.line + " does not exist (file has " + fileLines.length + " lines)");
	}
	var actualHash = computeLineHash(ref.line, fileLines[ref.line - 1]);
	if(actualHash !== ref.hash) {
		return { line: ref.line, expected: ref.hash, actual: actualHash };
	}
	return null;
}

function formatMismatchError(mismatches, fileLines) {
	var lines = [];
	lines.push(mismatches.length + " line" + (mismatches.length > 1 ? "s have" : " has") +
		" changed since last read. Use the updated LINE#ID references shown below (>>> marks changed lines).");
	lines.push("");
	var mismatchMap = {};
	for(var m = 0; m < mismatches.length; m++) {
		mismatchMap[mismatches[m].line] = mismatches[m];
	}
	var displayLines = {};
	for(var m = 0; m < mismatches.length; m++) {
		var lo = Math.max(1, mismatches[m].line - 2);
		var hi = Math.min(fileLines.length, mismatches[m].line + 2);
		for(var i = lo; i <= hi; i++) {
			displayLines[i] = true;
		}
	}
	var sorted = Object.keys(displayLines).map(Number).sort(function(a, b) { return a - b; });
	var prevLine = -1;
	for(var s = 0; s < sorted.length; s++) {
		var lineNum = sorted[s];
		if(prevLine !== -1 && lineNum > prevLine + 1) {
			lines.push("    ...");
		}
		prevLine = lineNum;
		var text = fileLines[lineNum - 1];
		var hash = computeLineHash(lineNum, text);
		var prefix = lineNum + "#" + hash;
		if(mismatchMap[lineNum]) {
			lines.push(">>> " + prefix + HASH_SEP + text);
		} else {
			lines.push("    " + prefix + HASH_SEP + text);
		}
	}
	return lines.join("\n");
}

function applyEdits(text, edits) {
	if(edits.length === 0) {
		return { text: text };
	}
	var fileLines = text.split("\n");
	var mismatches = [];

	// Pre-validate all refs
	for(var i = 0; i < edits.length; i++) {
		var edit = edits[i];
		if(edit.pos) {
			var m = validateLineRef(edit.pos, fileLines);
			if(m) mismatches.push(m);
		}
		if(edit.end) {
			var m = validateLineRef(edit.end, fileLines);
			if(m) mismatches.push(m);
		}
		if(edit.op === "replace_range" && edit.pos && edit.end && edit.pos.line > edit.end.line) {
			throw new Error("Range start line " + edit.pos.line + " must be <= end line " + edit.end.line);
		}
	}

	if(mismatches.length > 0) {
		var err = new Error(formatMismatchError(mismatches, fileLines));
		err.name = "HashlineMismatchError";
		err.mismatches = mismatches;
		throw err;
	}

	// Sort bottom-up (highest line first)
	var annotated = [];
	for(var i = 0; i < edits.length; i++) {
		var edit = edits[i];
		var sortLine = 0;
		var precedence = 0;
		switch(edit.op) {
			case "replace_line": sortLine = edit.pos.line; precedence = 0; break;
			case "replace_range": sortLine = edit.end.line; precedence = 0; break;
			case "append_at": sortLine = edit.pos.line; precedence = 1; break;
			case "prepend_at": sortLine = edit.pos.line; precedence = 2; break;
		}
		annotated.push({ edit: edit, sortLine: sortLine, precedence: precedence });
	}
	annotated.sort(function(a, b) {
		return b.sortLine - a.sortLine || a.precedence - b.precedence;
	});

	// Apply edits
	var firstChangedLine;
	function trackFirst(line) {
		if(firstChangedLine === undefined || line < firstChangedLine) {
			firstChangedLine = line;
		}
	}

	for(var i = 0; i < annotated.length; i++) {
		var edit = annotated[i].edit;
		var lines = edit.lines || [];
		switch(edit.op) {
			case "replace_line":
				fileLines.splice(edit.pos.line - 1, 1, lines.join("\n"));
				trackFirst(edit.pos.line);
				break;
			case "replace_range":
				var count = edit.end.line - edit.pos.line + 1;
				fileLines.splice(edit.pos.line - 1, count, lines.join("\n"));
				trackFirst(edit.pos.line);
				break;
			case "append_at":
				for(var l = lines.length - 1; l >= 0; l--) {
					fileLines.splice(edit.pos.line, 0, lines[l]);
				}
				trackFirst(edit.pos.line + 1);
				break;
			case "prepend_at":
				for(var l = lines.length - 1; l >= 0; l--) {
					fileLines.splice(edit.pos.line - 1, 0, lines[l]);
				}
				trackFirst(edit.pos.line);
				break;
		}
	}

	return { text: fileLines.join("\n"), firstChangedLine: firstChangedLine };
}

exports.computeLineHash = computeLineHash;
exports.formatHashLines = formatHashLines;
exports.formatLineTag = formatLineTag;
exports.parseTag = parseTag;
exports.applyEdits = applyEdits;
