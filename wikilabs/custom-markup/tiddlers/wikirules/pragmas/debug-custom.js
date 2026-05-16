/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/debug-custom.js
type: application/javascript
module-type: wikirule

Returns a JSON dump of parser.configTickText (the legacy registry).

```
\debugcustom
\debugcustom list
\debugcustom global
\debugcustom global list
\debugcustom global <id>
\debugcustom <id>
```

\*/

"use strict";

exports.name = "debugcustom";
exports.types = {pragma: true};

var idTypes = ["tick", "single", "degree", "angle", "approx", "pilcrow", "corner", "braille", "slash"];

exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	this.matchRegExp = /^\\debugcustom[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	this.pc = this.p.configTickText;

	idTypes.forEach(function(id) {
		self.pc[id] = self.pc[id] || {};
	});
};

exports.parse = function() {
	var text = "";

	this.parser.pos = this.matchRegExp.lastIndex;
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;

	var config = this.pc,
		// parseTiddler caches via "blockParseTree" itself, so this is cheap
		// on repeat. parser.configTickText is populated by the \importcustom
		// pragma in the PageTemplate during parse.
		globalParser = this.p.wiki.parseTiddler("$:/config/custom-markup/pragma/PageTemplate"),
		global = (globalParser && globalParser.configTickText) || {},
		foundKey = false,
		test = [];

	// Ensure each id slot exists so downstream global[id] never throws
	idTypes.forEach(function(id) { global[id] = global[id] || {}; });

	if(match[0] === "") { test = [""]; }
	else { test = match[1] ? match[1].split(/[ \t]+/) : [""]; }

	if(test[0] === "no") {
		return [];
	} else if(test[0] === "global") {
		if(test[1] === "list") {
			text += "global list:\n";
			Object.keys(global).forEach(function(el) {
				var x = Object.keys(global[el]);
				if(x.length > 0) {
					text += "  - " + el + " {..}\n";
					foundKey = true;
				}
			});
			text += foundKey ? "" : "  - no keys with values found!";
		} else if(test[1]) {
			text += "global " + test[1] + ":\n" + JSON.stringify(global[test[1]], null, 2);
		} else {
			text += "global all:\n" + JSON.stringify(global, null, 2);
		}
		text += "\n";
	} else {
		if(test[0] === "list") {
			text += "local list:\n";
			Object.keys(config).forEach(function(el) {
				var x = Object.keys(config[el]);
				if(x.length > 0) {
					foundKey = true;
					text += "  - " + el + " {..}\n";
				}
			});
			text += foundKey ? "" : "  - no keys with values found!";
		} else if(test[0] === "all" || test[0] === "") {
			text += "local all:\n" + JSON.stringify(config, null, 2);
		} else {
			text += "local " + test[0] + ":\n" + JSON.stringify(config[test[0]], null, 2);
		}
	}

	return [{
		type: "codeblock",
		attributes: {
			code: {type: "string", value: text}
		}
	}];
};
