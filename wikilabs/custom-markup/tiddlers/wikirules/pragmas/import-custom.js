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
	// Run the filter against shadows + tiddlers so users can write
	// `[tag[Vocab/X]]` without having to remember to spell
	// `[all[shadows+tiddlers]tag[Vocab/X]]`. Marker tiddlers are almost
	// always shadows (shipped inside plugins), so this is what authors
	// want 99% of the time and matches the type-field activation path.
	var tiddlerList = $tw.wiki.filterTiddlers(filter, null, $tw.wiki.eachShadowPlusTiddlers);

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
		// Legacy path: parse the tiddler's text and harvest its pragmas.
		var pragmaInParser = $tw.wiki.parseText("text/vnd.tiddlywiki", $tw.wiki.getTiddlerText(title));
		if(!pragmaInParser || !pragmaInParser.configTickText) { return; }
		idTypes.forEach(function(id) {
			var imported = pragmaInParser.configTickText[id];
			if(!imported) { return; }
			Object.keys(imported).forEach(function(key) {
				imported[key].imported = true;
				// Bridge each imported pragma into the registry so the
				// new marker rules can resolve symbols defined in other
				// tiddlers (the v0.x legacy storage in `pc[id]` is not
				// consulted by marker-block / marker-inline).
				if(self.parser.cmRegistry && typeof self.parser.cmRegistry.bridgeLegacyConfig === "function") {
					self.parser.cmRegistry.bridgeLegacyConfig(id, imported[key]);
				}
			});
			$tw.utils.extend(self.pc[id], imported);
		});
	});

	return [];
};
