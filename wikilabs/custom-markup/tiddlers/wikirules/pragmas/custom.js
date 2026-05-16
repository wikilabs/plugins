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
	// Unknown kind names (e.g. \custom X _element=p — anything outside
	// idTypes) need an init step or the legacy pc[id][symbol] assignment
	// would throw "Cannot set properties of undefined".
	this.pc[id] = this.pc[id] || {};
	this.pc[id][configTickText.symbol] = configTickText;

	// Bridge to new vocabulary registry. No-op if cmRegistry is absent or
	// has no marker matching this kind/open. Lets `\custom degree=foo`
	// register on the ° marker once Vocab/Default ships.
	if(this.parser.cmRegistry && typeof this.parser.cmRegistry.bridgeLegacyConfig === "function") {
		this.parser.cmRegistry.bridgeLegacyConfig(id, configTickText);
	}

	return [];
};
