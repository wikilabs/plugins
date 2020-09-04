/*\
title: $:/plugins/wikilabs/tick-text/wikirules/ticktext-pragma.js
type: application/javascript
module-type: wikirule

Wiki pragma rule for whitespace specifications

```
\ticktext tick tag=div name=§ end=---

\ticktext tick name=x tag=span params=.i.j.c.cp end=eee

\ticktext tick name=det tag="details" params="" end="—"

\ticktext angel name=sum tag="summary" 

\ticktext angel tag=span
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false, exports:false*/
"use strict";

exports.name = "ticktext";
exports.types = {pragma: true};

/*
Instantiate parse rule
*/
exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /^\\ticktext[^\S\n]/mg;
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

example tick name=x tag=div params=".i.j.c.cp" end="eee"

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
	var self = this;
	var sp = self.parser;
	sp.configTickText = sp.configTickText  || {};
	
	var spc = sp.configTickText;
	spc.tick = spc.tick || {};
	spc.angel = spc.angel || {};
	
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

	// \ticktext tick name=x tag=div params=".i.j.c.cp" end="eee"
	var isTick = false,
		isAngel = false,
		configTickText = {mode:"", tag:"", params:"", endString:""};
	
	$tw.utils.each(attributes,function(token) {
		switch(token.name) {
			case "tick":
				isTick  = true;
				configTickText.symbol = token.value;
				break;
			case "angel":
				isAngel = true;
				configTickText.symbol = token.value;
				break;
			case "mode":
				configTickText.mode = token.value;
				break;
			case "tag":
				configTickText.tag = token.value;
				break;
			case "params":
				configTickText.params = token.value;
				break;
			case "endString":
				configTickText.endString = token.value;
				break;
			default:
				configTickText[token.name] = token.value || "";
		}
	});
	
	if (isAngel === true) {
		spc.angel[configTickText.symbol] = configTickText;
	} else {
		spc.tick[configTickText.symbol] = configTickText;
	}
	// No parse tree nodes to return
	return [];
};

})();
