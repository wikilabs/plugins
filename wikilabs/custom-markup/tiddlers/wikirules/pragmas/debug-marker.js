/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/pragmas/debug-marker.js
type: application/javascript
module-type: wikirule

Per-tiddler override for a v1 marker's render-time debug mode. Parallels
v0.x's `_debug` pragma attribute, scoped to the tiddler the pragma lives in.

```
\debugmarker <open>=<mode>     // turn on debug for this marker
\debugmarker <open>=no         // explicitly off (overrides the field)
\debugmarker no                // off for ALL markers in this tiddler
```

Modes: `pragma` (default if truthy), `pragmaOnly`, `text`, `textOnly`,
`both`, `no`. `<open>` matches either a marker's `open` literal or its
`legacy-kind` (so `\debugmarker tick=both` and `\debugmarker °=both` both
target the DEGREE marker).

\*/

"use strict";

exports.name = "debugmarker";
exports.types = {pragma: true};

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = /^\\debugmarker[^\S\n]/mg;
};

exports.parse = function() {
	this.parser.pos = this.matchRegExp.lastIndex;
	var reMatch = /(.*)\r?\n?|$/mg;
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	this.parser.pos = reMatch.lastIndex;

	var arg = ((match && match[1]) || "").trim();

	if(!this.parser.debugMarkerOverrides) {
		this.parser.debugMarkerOverrides = Object.create(null);
	}

	if(arg === "" || arg === "no") {
		this.parser.debugMarkerAllOff = true;
		return [];
	}

	// Split on LAST `=` so an open literal containing `=` still parses
	// correctly (mode-name set is fixed and contains no `=`).
	var eqIdx = arg.lastIndexOf("=");
	if(eqIdx === -1) { return []; }

	var open = arg.slice(0, eqIdx).trim();
	var mode = arg.slice(eqIdx + 1).trim();
	if(!open) { return []; }

	// Resolve `legacy-kind` aliases (tick, degree, ...) to the underlying
	// open literal so the marker-block / marker-inline override lookup
	// (keyed by `marker.open`) hits.
	var registry = this.parser.cmRegistry;
	if(registry && !registry.markers[open] && registry.findByOpenOrLegacyKind) {
		var byLegacy = registry.findByOpenOrLegacyKind(open);
		if(byLegacy && byLegacy.open) { open = byLegacy.open; }
	}

	this.parser.debugMarkerOverrides[open] = mode;
	return [];
};
