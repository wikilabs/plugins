/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/import-custom.js
type: application/javascript
module-type: wikirule

Wiki pragma rule to import Custom-Markup definitions from other tiddlers.

```
\importcustom [tag[$:/tags/Pragma]]
\importcustom [tag[Vocab/Presentation]]
```

The filter result can mix legacy `\custom`-pragma tiddlers (parsed for
their pragmas) and modern marker tiddlers (have `open` and `kind` fields,
loaded directly into the registry).

\*/

"use strict";

exports.name = "importcustom";
exports.types = {pragma: true};

var idTypes = ["tick", "single", "degree", "angle", "approx", "pilcrow", "corner", "braille", "slash"];

exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	this.matchRegExp = /^\\importcustom[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	this.pc = this.p.configTickText;

	idTypes.forEach(function(id) {
		self.pc[id] = self.pc[id] || {};
	});
};

exports.parse = function() {
	var self = this;
	this.parser.pos = this.matchRegExp.lastIndex;
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;

	if(!match) { return []; }
	var filter = match[1];
	var tiddlerList = $tw.wiki.filterTiddlers(filter);

	$tw.utils.each(tiddlerList, function(title) {
		var t = $tw.wiki.getTiddler(title);
		if(!t) { return; }
		// Modern path: tiddler is a marker definition (has open + kind).
		// Markers are already preloaded into the registry at init time, so
		// we just need to activate this marker's open literal so it actually
		// fires (rather than emitting plain text).
		if(t.fields.open && t.fields.kind && self.parser.cmRegistry) {
			self.parser.cmRegistry.active[t.fields.open] = true;
			return;
		}
		// Legacy path: parse the tiddler's text and harvest its pragmas
		var pragmaInParser = $tw.wiki.parseText("text/vnd.tiddlywiki", $tw.wiki.getTiddlerText(title));
		if(!pragmaInParser || !pragmaInParser.configTickText) { return; }
		idTypes.forEach(function(id) {
			var imported = pragmaInParser.configTickText[id];
			if(!imported) { return; }
			Object.keys(imported).forEach(function(key) {
				imported[key].imported = true;
			});
			$tw.utils.extend(self.pc[id], imported);
		});
	});

	return [];
};
