/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/custom.js
type: application/javascript
module-type: wikirule

Wiki pragma rule for whitespace specifications

```
\custom tick=§ _element=div _endString= _mode= _classes= _use=

\custom angle=x _element=span _classes=.i.j.c.cp _endString=eee

\custom single=det _element="details" _classes="" _endString="—"

\custom degree=sum _element="summary"

\custom tick _element=span
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "custom";
exports.types = {pragma: true};

//var idTypes = ["tick", "single", "degree", "angle", "approx", "pilcrow", "corner", "braille", "slash"];
/*
Instantiate parse rule
*/
exports.init = function(parser) {
	var self = this;
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\custom[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	
	// idTypes.map( function(id) {
	// 	self.pc[id] = self.pc[id] || {};
	// })
};


/* parse attributes
var s = '<option value="" data-foo="{{te st}}" readonly>Value 1</option>';

var test_element = document.createElement('div');
test_element.innerHTML = s;

var element = test_element.childNodes[0];
var attributes = element.attributes;

for (var i = 0; i < attributes.length; i++) {
    var attribute = attributes[i];

    console.log(attribute.name, '=>', attribute.value);
}
*/

function parseAttributes(source) {
	var pos = 0,
		attributes= [];

	// Process attributes
	var attribute = $tw.utils.parseAttribute(source,pos);
	while(attribute) {
		attributes.push(attribute);
		pos = attribute.end;
		// Get the next attribute
		attribute = $tw.utils.parseAttribute(source,pos);
	}
	return attributes;
}

/*
Parse the most recent match
*/
exports.parse = function() {
	// Move past the pragma invocation
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse line terminated by a line break
	var reMatch = /([^\n]*\S)|(\r?\n)/mg,
		line = "";
	reMatch.lastIndex = this.parser.pos;
	var match = reMatch.exec(this.parser.source);
	while(match && match.index === this.parser.pos) {
		this.parser.pos = reMatch.lastIndex;
		// Exit if we've got the line break
		if(match[2]) {
			break;
		}
		// Process the token
		if(match[1]) {
			line = (match[1]);
		}
		// Match the next token
		match = reMatch.exec(this.parser.source);
	}

	var attributes = parseAttributes(line);

	// \ticktext tick=x htmlTag=div params=".i.j.c.cp" end="eee"
	var id = "X", // There should be no id X!!
//		configTickText = {_mode:"", _element:"", _classes:"", _endString:""};
		configTickText = {};

	var debugString = "\\custom",
		tValue = "",
		self = this;

	$tw.utils.each(attributes,function(token) {
//		if (idTypes.indexOf(token.name) >= 0) {
		if (attributes[0].name === token.name) {
			id = token.name;
			configTickText.symbol = token.value;
			self.pc[id] = (self.pc[id]) ? self.pc[id] : {}; 
//			debugString += " " + id + "='" + token.value + "'";
		}
		switch(token.name) {
			case "_classes":
			case "_debug":
			case "_mode":
			case "_element":
			case "_classes":
			case "_endString":
			case "_use":
			case "_useGlobal":
			case "_srcName": // falltrough
				configTickText[token.name] = token.value;
				debugString += " " + token.name + "='" + token.value + "'";
			break;
			case "_params":
				configTickText[token.name] = parseAttributes(token.value);
				debugString += " " + token.name + "='" + token.value + "'";
			break;
			default:
				configTickText[token.name] = token || {};
				tValue = (token.type === "macro") ? "<<" + token.value.name + ">>": 
						(token.type === "indirect") ? "{{" + token.textReference + "}}" : "'" + token.value + "'";
				debugString += " " + token.name + "=" + tValue; 
		}
	});

	configTickText._debugString = debugString;

	this.pc[id][configTickText.symbol] = configTickText;
	// No parse tree nodes to return
	return [];
};

})();
