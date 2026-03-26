/*\
title: $:/plugins/wikilabs/uuid7/filters/c32.js
type: application/javascript
module-type: filteroperator

Filter operator for Crockford Base32 encoded UUID v7 values.

Usage:
  [get[c32]c32[check]]     → check symbol (mod 37)
  [get[c32]c32[c7]]        → convert to UUID v7 hex string
  [get[c32]c32[ms]]        → Unix timestamp in milliseconds
  [get[c32]c32[valid]]     → "yes" or "no"
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
