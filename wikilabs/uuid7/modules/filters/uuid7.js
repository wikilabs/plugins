/*\
title: $:/plugins/wikilabs/uuid7/filters/uuid7.js
type: application/javascript
module-type: filteroperator

Filter operator for extracting UUID v7 components.

Usage:
	[get[c7]uuid7[ms]]              → Unix timestamp in milliseconds
	[get[c7]uuid7[rnd]]             → random part as hex (20 chars, visually matches UUID)
	[get[c7]uuid7[phrase]]          → all 8 triplets (comma-separated, spaces between words)
	[get[c7]uuid7:+[phrase]]        → all 8 triplets (comma-separated, + between words)
	[get[c7]uuid7[phrase],[1],[2]]   → triplets 1-2 (start, count — 1-based)
	[get[c7]uuid7:+[phrase],[3]]     → triplet 3 with + separator
	[get[c7]uuid7[version]]         → UUID version number (should be 7)
	[get[c7]uuid7[variant]]         → variant bits as hex
	[get[c7]uuid7[valid]]           → "yes" or "no"
	[get[c7]uuid7[c32]]             → convert to Crockford Base32 (6-4-12-4)
	[get[c7]uuid7[check]]           → check symbol (mod 37, via c32)

Date formatting is done by composing with existing operators:
	[get[c7]uuid7[ms]format:timestamp[YYYY0MM0DD]]

With no operand, passes through valid UUID v7 strings unchanged (filtering out invalid ones).

\*/

"use strict";

exports.uuid7 = function(source,operator,options) {
	var creator = require("$:/plugins/wikilabs/uuid7/creator.js");
	var results = [];
	var operands = operator.operands || [operator.operand || ""];
	var suffix = operands[0] || "";
	source(function(tiddler,title) {
		switch(suffix) {
			case "ms":
				var ms = creator.extractTimestampMs(title);
				if(ms !== null) {
					results.push(String(ms));
				}
				break;
			case "phrase":
				var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
				var encResult = phraselib.encodeUUID(title);
				if(encResult.phrase) {
					var wordSep = operator.suffix || " ";
					var triplets = encResult.phrase.map(function(t) {
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
				break;
			case "rnd":
				if(creator.isValidV7(title)) {
					// Bytes 6-15 with dashes, visually matches the UUID:
					// 019ce7af-ff4d-7897-ae47-6dd818e2d476
					//               ^^^^ ^^^^ ^^^^^^^^^^^^
					// rnd =         7897-ae47-6dd818e2d476
					var hex = title.replace(/-/g,"");
					var r = hex.slice(12);
					results.push(r.slice(0,4) + "-" + r.slice(4,8) + "-" + r.slice(8));
				}
				break;
			case "version":
				if(creator.isValidV7(title)) {
					var vHex = title.replace(/-/g,"");
					results.push(String((parseInt(vHex[12],16) >> 0) & 0x0f));
				}
				break;
			case "variant":
				if(creator.isValidV7(title)) {
					var varHex = title.replace(/-/g,"");
					results.push(((parseInt(varHex[16],16) >> 2) & 0x03).toString(16));
				}
				break;
			case "c32":
				if(creator.isValidV7(title)) {
					var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
					results.push(c32lib.fromUUID(title));
				}
				break;
			case "c62":
				if(creator.isValidV7(title)) {
					var b62lib = require("$:/plugins/wikilabs/uuid7/base62id.js");
					results.push(b62lib.fromUUID(title));
				}
				break;
			case "check":
				if(creator.isValidV7(title)) {
					var c32chk = require("$:/plugins/wikilabs/uuid7/crockford32.js");
					results.push(c32chk.checkSymbol(c32chk.fromUUID(title)));
				}
				break;
			case "bits":
				var hexVal = parseInt(title, 16);
				if(!isNaN(hexVal) && title.length === 1) {
					results.push(("0000" + hexVal.toString(2)).slice(-4));
				}
				break;
			case "value":
				var hexDec = parseInt(title, 16);
				if(!isNaN(hexDec) && title.length === 1) {
					results.push(String(hexDec));
				}
				break;
			case "valid":
				results.push(creator.isValidV7(title) ? "yes" : "no");
				break;
			default:
				// No operand: pass through valid UUIDs only
				if(creator.isValidV7(title)) {
					results.push(title);
				}
				break;
		}
	});
	return results;
};
