/*\
title: $:/plugins/wikilabs/tick-text/wikirules/customize.js
type: application/javascript
module-type: wikirule

Wiki pragma rule for whitespace specifications

```
\customize tick=§ _element=div _endString= _mode= _params= _use=

\customize angel=x _element=span _params=.i.j.c.cp _endString=eee

\customize comma=det _element="details" _params="" _endString="—"

\customize degree=sum _element="summary"

\customize underscore _element=span
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "customize";
exports.types = {pragma: true};

/*
Instantiate parse rule
*/
exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\customize[^\S\n]/mg;

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	this.pc.tick = this.pc.tick || {};
	this.pc.comma = this.pc.comma || {};
	this.pc.degree = this.pc.degree || {};
	this.pc.underscore = this.pc.underscore || {};
	this.pc.angel = this.pc.angel || {};
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

/*
exports.parseTag = function(source,pos,options) {
*/

/*
returns an object array with::
start, end .. regexp numbers
type: string .. should be always string
name: .. parameter name // 
value: .. parameter value as string

example tick=x htmlTag=div params=".i.j.c.cp" end="eee"

doesn't work as expected.
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
		configTickText = {_mode:"", _element:"", _params:"", _endString:""};
	
	$tw.utils.each(attributes,function(token) {
		switch(token.name) {
			case "tick": // fall through
			case "angel": // fall through
			case "comma": // fall through
			case "underscore": // fall through
			case "degree":
				id = token.name;
				configTickText.symbol = token.value;
				break;
			case "_mode":
				configTickText._mode = token.value;
				break;
			case "_element":
				configTickText._element = token.value;
				break;
			case "_params":
				configTickText._params = token.value;
				break;
			case "_endString":
				configTickText._endString = token.value;
				break;
			default:
				configTickText[token.name] = token.value || "";
		}
	});
	
	this.pc[id][configTickText.symbol] = configTickText;
	// No parse tree nodes to return
	return [];
};

})();
