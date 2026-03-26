/*\
title: $:/plugins/wikilabs/uuid7/filters/c32.js
type: application/javascript
module-type: filteroperator

Filter operator for Crockford Base32 encoded UUID v7 values.

Usage:
  [get[c32]c32[check]]              → check symbol (mod 37)
  [get[c32]c32[c7]]                 → convert to UUID v7 hex string
  [get[c32]c32[ms]]                 → Unix timestamp in milliseconds
  [get[c32]c32[phrase]]             → all 8 triplets (comma-separated)
  [get[c32]c32:+[phrase]]           → all 8 triplets (+ between words)
  [get[c32]c32[phrase],[1],[2]]     → triplets 1-2 (start, count — 1-based)
  [get[c32]c32[rnd]]               → random part as hex (4-4-12 format)
  [get[c32]c32[version]]           → UUID version number (7)
  [get[c32]c32[variant]]           → variant bits as hex
  [get[c32]c32[valid]]             → "yes" or "no"
With no operand, normalizes input to canonical uppercase with alias
substitution (O→0, I→1, L→1). Works on full and partial c32 strings.

\*/

"use strict";

exports.c32 = function(source,operator,options) {
	var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
	var results = [];
	var operands = operator.operands || [operator.operand || ""];
	var suffix = operands[0] || "";
	source(function(tiddler,title) {
		switch(suffix) {
			case "check":
				if(c32lib.isValidC32(title)) {
					results.push(c32lib.checkSymbol(title));
				}
				break;
			case "c7":
				if(c32lib.isValidC32(title)) {
					results.push(c32lib.toUUID(title));
				}
				break;
			case "phrase":
				if(c32lib.isValidC32(title)) {
					var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
					var enc = phraselib.encodeUUID(c32lib.toUUID(title));
					if(enc.phrase) {
						var wordSep = operator.suffix || " ";
						var triplets = enc.phrase.map(function(t) {
							return wordSep !== " " ? t.replace(/ /g, wordSep) : t;
						});
						var start = parseInt(operands[1],10);
						if(start >= 1) {
							var count = parseInt(operands[2],10) || 1;
							results.push(triplets.slice(start - 1, start - 1 + count).join(", "));
						} else {
							results.push(triplets.join(", "));
						}
					}
				}
				break;
			case "rnd":
				if(c32lib.isValidC32(title)) {
					var hex = c32lib.toUUID(title).replace(/-/g,"");
					var r = hex.slice(12);
					results.push(r.slice(0,4) + "-" + r.slice(4,8) + "-" + r.slice(8));
				}
				break;
			case "version":
				if(c32lib.isValidC32(title)) {
					var vHex = c32lib.toUUID(title).replace(/-/g,"");
					results.push(String(parseInt(vHex[12],16) & 0x0f));
				}
				break;
			case "variant":
				if(c32lib.isValidC32(title)) {
					var varHex = c32lib.toUUID(title).replace(/-/g,"");
					results.push(((parseInt(varHex[16],16) >> 2) & 0x03).toString(16));
				}
				break;
			case "ms":
				var ms = c32lib.extractTimestampMs(title);
				if(ms !== null) {
					results.push(String(ms));
				}
				break;
			case "valid":
				results.push(c32lib.isValidC32(title) ? "yes" : "no");
				break;
			default:
				// Default: normalize (canonical uppercase + alias substitution)
				var normalized = c32lib.normalize(title);
				if(normalized !== null) {
					results.push(normalized);
				}
				break;
		}
	});
	return results;
};
