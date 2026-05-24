/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/debug-custom.js
type: application/javascript
module-type: wikirule

Returns a JSON dump of parser.configTickText (the legacy registry) plus
parser.cmRegistry.markers (the v1 marker registry).

```
\debugcustom
\debugcustom list
\debugcustom global
\debugcustom global list
\debugcustom global <id-or-open>
\debugcustom <id-or-open>
\debugcustom no
```

`<id>` matches a legacy kind (tick, single, degree, angle, approx, pilcrow,
corner, braille, slash). `<open>` matches any v1 marker's `open` literal
(e.g. `.`, `»`, `PRESENTATION`). Word-marker opens with whitespace are
supported via the joined tail of arguments.

\*/

"use strict";

exports.name = "debugcustom";
exports.types = {pragma: true};

// Legacy 9-kind list — pre-populated on configTickText so v0.x
// pragmas (`\custom degree=foo`) and v0.x debugcustom usage continue to work.
var legacyKinds = ["tick", "single", "degree", "angle", "approx", "pilcrow", "corner", "braille", "slash"];

exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	this.matchRegExp = /^\\debugcustom[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	this.pc = this.p.configTickText;

	legacyKinds.forEach(function(id) {
		self.pc[id] = self.pc[id] || {};
	});
};

exports.parse = function() {
	this.parser.pos = this.matchRegExp.lastIndex;
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;

	var localConfig = this.pc,
		localMarkers = (this.p.cmRegistry && this.p.cmRegistry.markers) || {},
		// parseAsInline + configTrimWhiteSpace match the options TW core's
		// ImportVariablesWidget passes when it parses the same tiddler, so
		// we share the cache slot rather than triggering a separate full
		// parse. Pragma phase populates configTickText / cmRegistry the
		// same way regardless of mode.
		globalParser = this.p.wiki.parseTiddler("$:/config/custom-markup/pragma/PageTemplate", {parseAsInline: true, configTrimWhiteSpace: false}),
		globalConfig = (globalParser && globalParser.configTickText) || {},
		globalMarkers = (globalParser && globalParser.cmRegistry && globalParser.cmRegistry.markers) || {};

	legacyKinds.forEach(function(id) { globalConfig[id] = globalConfig[id] || {}; });

	var tokens = (match[0] === "" || !match[1]) ? [""] : match[1].split(/[ \t]+/);
	var first = tokens[0] || "";

	var text = "";
	if(first === "no") {
		return [];
	} else if(first === "global") {
		var globalArg = tokens.slice(1).join(" ");
		text = renderScope("global", globalArg, globalConfig, globalMarkers);
	} else {
		var localArg = tokens.join(" ");
		text = renderScope("local", localArg, localConfig, localMarkers);
	}

	return [{
		type: "codeblock",
		attributes: {
			code: {type: "string", value: text}
		}
	}];
};

function renderScope(scope, arg, config, markers) {
	if(arg === "list") {
		return renderList(scope, config, markers);
	}
	if(arg === "" || arg === "all") {
		return renderAll(scope, config, markers);
	}
	return renderLookup(scope, arg, config, markers);
}

function renderList(scope, config, markers) {
	var text = scope + " list:\n";

	text += "  legacy kinds:\n";
	var legacyFound = false;
	legacyKinds.forEach(function(kind) {
		var bucket = config[kind] || {};
		if(Object.keys(bucket).length > 0) {
			text += "    - " + kind + " {..}\n";
			legacyFound = true;
		}
	});
	if(!legacyFound) {
		text += "    (no keys with values found)\n";
	}

	text += "  markers:\n";
	var opens = Object.keys(markers);
	if(opens.length === 0) {
		text += "    (none)\n";
	} else {
		opens.sort();
		opens.forEach(function(open) {
			var m = markers[open];
			var symbolCount = m.symbols ? Object.keys(m.symbols).length : 0;
			var hints = ["kind=" + m.kind];
			if(m.legacyKind) { hints.push("legacy-kind=" + m.legacyKind); }
			if(symbolCount > 0) {
				hints.push(symbolCount + (symbolCount === 1 ? " symbol" : " symbols"));
			}
			text += "    - " + open + "  (" + hints.join(", ") + ")\n";
		});
	}
	return text;
}

function renderAll(scope, config, markers) {
	return scope + " all:\n" + JSON.stringify(config, null, 2) + "\n" +
		scope + " markers:\n" + JSON.stringify(serializeMarkers(markers), null, 2) + "\n";
}

function renderLookup(scope, key, config, markers) {
	// Legacy kind lookup keeps v0.x output shape byte-for-byte.
	if(legacyKinds.indexOf(key) !== -1) {
		return scope + " " + key + ":\n" + JSON.stringify(config[key] || {}, null, 2) + "\n";
	}
	if(markers[key]) {
		return scope + " " + key + ":\n" + JSON.stringify(serializeMarker(markers[key]), null, 2) + "\n";
	}
	return scope + " " + key + ": (not found)\n";
}

function serializeMarkers(markers) {
	var out = {};
	Object.keys(markers).forEach(function(open) {
		out[open] = serializeMarker(markers[open]);
	});
	return out;
}

function serializeMarker(marker) {
	var out = {};
	Object.keys(marker).forEach(function(key) {
		// globalSymbols is a cross-parser reference to the global registry's
		// symbols map; including it would duplicate the global view.
		if(key === "globalSymbols") { return; }
		out[key] = marker[key];
	});
	return out;
}
