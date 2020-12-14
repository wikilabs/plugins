/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/debug-customize.js
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
	
var idTypes = ["tick", "single", "degree", "angle", "almost", "pilcrow", "little", "braille", "slash"];
/*
Instantiate parse rule
*/
exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\debugcustomi[zs]e[^\S\n]/mg;
	
	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	
	idTypes.map( function(id) {
		self.pc[id] = self.pc[id] || {};
	})};

/*
Parse the most recent match
*/
exports.parse = function() {
	var text = "";
	
	// Move past the pragma invocation
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse line terminated by a line break
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;

	var config = this.pc,
		global = this.p.wiki.caches["$:/config/custom-markup/pragma/PageTemplate"].blockParseTree.configTickText,
		foundKey = false,
		test=[];
	
	if (match[0] === "" ) test = [""]
	else test = (match[1]) ? match[1].split(/[ \t]+/) : [""];

	if (test[0] === "no") {
		return [];
	} else if (test[0] === "global") {
		if (test[1] === "list") {
			text += "global list:\n" 
			Object.keys(global).map( function(el) {
				var x = Object.keys(global[el]);
				if (x.length > 0) {
					text += "  - " + el + " {..}\n"
					foundKey = true;
				}
			});
			text += (foundKey === false) ? "  - no keys with values found!" : "";
		} else if (test[1]) {
			text += "global " + test[1] + ":\n" + 
			JSON.stringify(global[test[1]], null, 2)
		} else {
			text += "global all:\n" + JSON.stringify(global, null, 2)
		}
		text += "\n"
	} else {
		if (test[0] === "list") {
			text += "local list:\n" 
			Object.keys(config).map( function(el) {
				var x = Object.keys(config[el]);
				if (x.length > 0) {
					foundKey = true;
					text += "  - " + el + " {..}\n"
				}
			});
			text += (foundKey === false) ? "  - no keys with values found!" : "";
		} else if (test[0] === "all" || test[0] === "") {
			text += "local all:\n" + JSON.stringify(config, null, 2)
		} else {
			text += "local " + test[0] + ":\n" + JSON.stringify(config[test[0]], null, 2)
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
