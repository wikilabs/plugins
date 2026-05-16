/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/custom.js
type: application/javascript
module-type: wikirule

Wiki pragma rule for Custom-Markup configuration.

```
\custom tick=§ _element=div _endString= _mode= _classes= _use=
\custom angle=x _element=span _classes=.i.j.c.cp _endString=eee
\custom single=det _element="details" _classes="" _endString="—"
\custom degree=sum _element="summary"
\custom tick _element=span
```

\*/

"use strict";

exports.name = "custom";
exports.types = {pragma: true};

var idTypes = ["tick", "single", "degree", "angle", "approx", "pilcrow", "corner", "braille", "slash"];

exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	this.matchRegExp = /^\\custom[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	this.pc = this.p.configTickText;

	idTypes.forEach(function(id) {
		self.pc[id] = self.pc[id] || {};
	});
};

function parseAttributes(source) {
	var pos = 0,
		attributes = [];
	var attribute = $tw.utils.parseAttribute(source, pos);
	while(attribute) {
		attributes.push(attribute);
		pos = attribute.end;
		attribute = $tw.utils.parseAttribute(source, pos);
	}
	return attributes;
}

exports.parse = function() {
	this.parser.pos = this.matchRegExp.lastIndex;
	// Read the rest of the line
	var reMatch = /([^\n]*\S)|(\r?\n)/mg,
		line = "";
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	while(match && match.index === this.parser.pos) {
		this.parser.pos = reMatch.lastIndex;
		if(match[2]) { break; }
		if(match[1]) { line = match[1]; }
		match = reMatch.exec(this.parser.source);
	}

	var attributes = parseAttributes(line);

	var id = "X",
		configTickText = {},
		debugString = "\\custom";

	$tw.utils.each(attributes, function(token) {
		if(idTypes.indexOf(token.name) >= 0) {
			id = token.name;
			configTickText.symbol = token.value;
			debugString += " " + id + "='" + token.value + "'";
			// Kind-name token is structural; don't fall through to the default
			// switch arm, which would store it as a passthrough attribute.
			return;
		}
		switch(token.name) {
			case "_classes":
			case "_debug":
			case "_mode":
			case "_element":
			case "_endString":
			case "_use":
			case "_useGlobal":
			case "_srcName":
				configTickText[token.name] = token.value;
				debugString += " " + token.name + "='" + token.value + "'";
				break;
			case "_params":
				configTickText[token.name] = parseAttributes(token.value);
				debugString += " " + token.name + "='" + token.value + "'";
				break;
			default:
				configTickText[token.name] = token || {};
				var tValue = (token.type === "macro") ? "<<" + token.value.name + ">>"
					: (token.type === "indirect") ? "{{" + token.textReference + "}}"
					: "'" + token.value + "'";
				debugString += " " + token.name + "=" + tValue;
		}
	});

	configTickText._debugString = debugString;
	this.pc[id][configTickText.symbol] = configTickText;

	// Bridge to new vocabulary registry. No-op if cmRegistry is absent or
	// has no marker matching this kind/open. Lets `\custom degree=foo`
	// register on the ° marker once Vocab/Default ships.
	bridgeToRegistry(this.parser, id, configTickText);

	return [];
};

function bridgeToRegistry(parser, kindOrOpen, legacyConfig) {
	if(!parser.cmRegistry || typeof parser.cmRegistry.findByOpenOrLegacyKind !== "function") {
		return;
	}
	var marker = parser.cmRegistry.findByOpenOrLegacyKind(kindOrOpen);
	if(!marker) { return; }
	// Bare-kind pragmas (`\custom angle _element=td`, with no `=symbol`)
	// register against the empty-string key so resolveConfig can pick them
	// up when the marker fires with no symbol. TW parses the bare kind
	// name as an attribute with literal value "true", so we treat that the
	// same as no symbol.
	var rawSymbol = legacyConfig.symbol;
	var symbolKey = (rawSymbol === undefined || rawSymbol === "true") ? "" : rawSymbol;
	marker.symbols[symbolKey] = normalizeLegacyConfig(legacyConfig);
}

function normalizeLegacyConfig(legacy) {
	var out = {};
	var attributes = {};
	for(var key in legacy) {
		switch(key) {
			case "symbol":
			case "_debugString":
				break;
			case "_element": out.element = legacy[key]; break;
			case "_classes":
				// Legacy `_classes="b-y"` is dot-less. Normalize so the registry's
				// dot-separated chain stays well-formed when concatenated.
				var c = legacy[key] || "";
				if(c && c.charAt(0) !== ".") { c = "." + c; }
				out.classes = c;
				break;
			case "_endString": out.endString = legacy[key]; break;
			case "_mode": out.mode = legacy[key]; break;
			case "_srcName": out.srcName = legacy[key]; break;
			case "_use": out.use = legacy[key]; break;
			case "_useGlobal": out.useGlobal = legacy[key]; break;
			case "_debug": out.debug = legacy[key]; break;
			case "_params": out.params = legacy[key]; break;
			default:
				if(key.charAt(0) !== "_") {
					var v = legacy[key];
					if(v && typeof v === "object" && v.value !== undefined) {
						attributes[key] = String(v.value);
					} else if(typeof v === "string") {
						attributes[key] = v;
					}
				}
		}
	}
	if(Object.keys(attributes).length > 0) {
		out.attributes = attributes;
	}
	return out;
}
