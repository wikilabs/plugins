/*\
title: $:/plugins/wikilabs/uuid7/filters/c62.js
type: application/javascript
module-type: filteroperator

Filter operator for Base62id encoded UUID v7 values.

Usage:
	[get[c62]c62[c7]]        → convert to UUID v7 hex string
	[get[c62]c62[c32]]       → convert to Crockford Base32
	[get[c62]c62[ms]]        → Unix timestamp in milliseconds
	[get[c62]c62[phrase]]    → all 8 triplets (comma-separated)
	[get[c62]c62:+[phrase]]  → all 8 triplets (+ between words)
	[get[c62]c62[phrase],[1],[2]] → triplets 1-2 (start, count)
	[get[c62]c62[rnd]]       → random part as hex
	[get[c62]c62[version]]   → UUID version number (7)
	[get[c62]c62[variant]]   → variant bits as hex
	[get[c62]c62[valid]]     → "yes" or "no"

With no operand, passes through valid Base62id strings unchanged.

\*/

"use strict";

exports.c62 = function(source, operator, options) {
	var b62lib = require("$:/plugins/wikilabs/uuid7/base62id.js");
	var results = [];
	var operands = operator.operands || [operator.operand || ""];
	var suffix = operands[0] || "";

	source(function(tiddler, title) {
		// Helper: convert to UUID for operations that need it
		var uuid;
		function getUUID() {
			if(uuid === undefined) {
				try {
					uuid = b62lib.isValidB62(title) ? b62lib.toUUID(title) : null;
				} catch(e) {
					uuid = null;
				}
			}
			return uuid;
		}

		switch(suffix) {
			case "c7":
				var u = getUUID();
				if(u) { results.push(u); }
				break;
			case "c32":
				var u2 = getUUID();
				if(u2) {
					var c32lib = require("$:/plugins/wikilabs/uuid7/crockford32.js");
					results.push(c32lib.fromUUID(u2));
				}
				break;
			case "phrase":
				var u3 = getUUID();
				if(u3) {
					var phraselib = require("$:/plugins/wikilabs/uuid7/phraselib.js");
					var enc = phraselib.encodeUUID(u3);
					if(enc.phrase) {
						var wordSep = operator.suffix || " ";
						var triplets = enc.phrase.map(function(t) {
							return wordSep !== " " ? t.replace(/ /g, wordSep) : t;
						});
						var start = parseInt(operands[1], 10);
						if(start >= 1) {
							var count = parseInt(operands[2], 10) || 1;
							results.push(triplets.slice(start - 1, start - 1 + count).join(", "));
						} else {
							results.push(triplets.join(", "));
						}
					}
				}
				break;
			case "ms":
				var ms = b62lib.extractTimestampMs(title);
				if(ms !== null) {
					results.push(String(ms));
				}
				break;
			case "rnd":
				var u4 = getUUID();
				if(u4) {
					var hex = u4.replace(/-/g, "");
					var r = hex.slice(12);
					results.push(r.slice(0, 4) + "-" + r.slice(4, 8) + "-" + r.slice(8));
				}
				break;
			case "version":
				var u5 = getUUID();
				if(u5) {
					var vHex = u5.replace(/-/g, "");
					results.push(String(parseInt(vHex[12], 16) & 0x0f));
				}
				break;
			case "variant":
				var u6 = getUUID();
				if(u6) {
					var varHex = u6.replace(/-/g, "");
					results.push(((parseInt(varHex[16], 16) >> 2) & 0x03).toString(16));
				}
				break;
			case "check":
				var u7 = getUUID();
				if(u7) {
					var c32chk = require("$:/plugins/wikilabs/uuid7/crockford32.js");
					results.push(c32chk.checkSymbol(c32chk.fromUUID(u7)));
				}
				break;
			case "value":
				// Decode a single Base62id character to its decimal value
				if(title.length === 1) {
					var ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
					var idx = ALPHABET.indexOf(title);
					if(idx >= 0) { results.push(String(idx)); }
				}
				break;
			case "valid":
				results.push(b62lib.isValidB62(title) ? "yes" : "no");
				break;
			default:
				if(b62lib.isValidB62(title)) {
					results.push(title);
				}
				break;
		}
	});
	return results;
};
