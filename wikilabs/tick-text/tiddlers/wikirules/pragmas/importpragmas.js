/*\
title: $:/plugins/wikilabs/tick-text/wikirules/pragmas/importpragmas.js
type: application/javascript
module-type: wikirule

Wiki pragma rule to import pragmas from other tiddlers

```
\imortpragmas [[pragma-global]] ... filter
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "importpragmas";
exports.types = {pragma: true};

/*
Instantiate parse rule
*/
exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\importpragmas[^\S\n]/mg;
	
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
		filter,
		tiddlerList;

	// Move past the pragma invocation
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse line terminated by a line break
	var reMatch = /(.*)(\r?\n)|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;
	
	if (match) {
		filter = match[1];
		tiddlerList = $tw.wiki.filterTiddlers(filter);
	}

	$tw.utils.each(tiddlerList,function(title) {
		var pragmaInParser = $tw.wiki.parseText("text/vnd.tiddlywiki", $tw.wiki.getTiddlerText(title));
		$tw.utils.extend(self.pc.tick, pragmaInParser.configTickText.tick);
		$tw.utils.extend(self.pc.angel, pragmaInParser.configTickText.angel);
	});

	// No parse tree nodes to return
	return [];
};

})();