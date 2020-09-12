/*\
title: $:/plugins/wikilabs/tick-text/wikirules/pragmas/debug-customize.js
type: application/javascript
module-type: wikirule

Returns a JSON info of parser.configTickText

```
\debugcostomize
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "debugcustomize";
exports.types = {pragma: true};

/*
Instantiate parse rule
*/
exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\debugcustomize[^\S\n]/mg;
	
	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	this.pc.tick = this.pc.tick || {};
	this.pc.comma = this.pc.comma || {};
	this.pc.degree = this.pc.degree || {};
	this.pc.underscore = this.pc.underscore || {};
	this.pc.angel = this.pc.angel || {};
};

/*
Parse the most recent match
*/
exports.parse = function() {
	var text = "";
	
	// Move past the pragma invocation
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse line terminated by a line break
	var reMatch = /(.*)(\r?\n)|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;
	
	if (match) {
		switch(match[1]) {
			case "tick":
				text = "tick:\n" + JSON.stringify(this.pc.tick, null, 2)
				break;
			case "angel":
				text += "angel:\n" + JSON.stringify(this.pc.angel, null, 2)
				break;
			case "comma":
				text += "comma:\n" + JSON.stringify(this.pc.comma, null, 2)
				break;
			case "underscore":
				text += "underscore:\n" + JSON.stringify(this.pc.underscore, null, 2)
				break;
			case "degree":
				text += "degree:\n" + JSON.stringify(this.pc.degree, null, 2)
				break;
			case "all": // fall through
			default:
				text = JSON.stringify(this.pc, null, 2) + "\n\n"
				break
		}
	}
	
	return [{
		type: "codeblock",
		attributes: {
				code: {type: "string", value: text}
		}
	}]
};

})();
