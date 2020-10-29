/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/import-custom.js
type: application/javascript
module-type: wikirule

Wiki pragma rule to import pragmas from other tiddlers

```
\importcustom [[pragma-global]] ... filter
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "importcustom";
exports.types = {pragma: true};

var idTypes = ["tick", "single", "degree", "angle", "almost", "pilcrow", "underscore", "little", "braille", "slash"];
/*
Instantiate parse rule
*/
exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\importcustom[^\S\n]/mg;
	
	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	
	idTypes.map( function(id) {
		self.pc[id] = self.pc[id] || {};
	})
};

/*
Parse the most recent match
*/
exports.parse = function() {
	var self = this,
		filter,
		tiddlerList;

	// Move past the pragma invocation
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse line terminated by a line break
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;
	
	if (match) {
		filter = match[1];
		tiddlerList = $tw.wiki.filterTiddlers(filter);
	}

	$tw.utils.each(tiddlerList,function(title) {
		var pragmaInParser = $tw.wiki.parseText("text/vnd.tiddlywiki", $tw.wiki.getTiddlerText(title));
		
		idTypes.map( function(id) {
			pragmaInParser.configTickText[id];
			Object.keys(pragmaInParser.configTickText[id]).map(function (key) {
				pragmaInParser.configTickText[id][key].imported = true;
			})
			$tw.utils.extend(self.pc[id], pragmaInParser.configTickText[id]);
		})
	});

	// No parse tree nodes to return
	return [];
};

})();
