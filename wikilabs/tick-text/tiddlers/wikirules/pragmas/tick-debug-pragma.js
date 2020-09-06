/*\
title: $:/plugins/wikilabs/tick-text/wikirules/pragmas/tick-debug-pragma.js
type: application/javascript
module-type: wikirule

Returns a JSON info of parser.configTickText

```
\importdebug
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "tickdebug";
exports.types = {pragma: true};

/*
Instantiate parse rule
*/
exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\tickdebug[^\S\n]/mg;
	
	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	this.pc.tick = this.pc.tick || {};
	this.pc.angel = this.pc.angel || {};
};

/*
Parse the most recent match
*/
exports.parse = function() {
	var self = this,
		text = "";
	
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
			case "all":
				text = "tick:\n" + JSON.stringify(this.pc.tick, null, 2) + "\n\n"
				// intentional fall through!
			case "angel":
				text += "angel:\n" + JSON.stringify(this.pc.angel, null, 2)
				break;
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
