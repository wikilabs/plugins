/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/tickinlineXXXX.js
type: application/javascriptXXX
module-type: wikiruleXXX

Wiki text inline rule for assigning styles and classes to inline runs. For example:

```
´´name.my.Class This is some text with a class´´
```


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false exports:false */
"use strict";

exports.name = "tickinline";
exports.types = {inline: true};

var idTypes = ["inline"];

exports.init = function(parser) {
	var self = this; 
	this.parser = parser;
	// Regexp to match
//	this.matchRegExp = /°'(\.(?:[^\r\n\s]+))?/mg; // OK
//	this.matchRegExp = /_((?:[^\.:\r\n\s_]+))?(\.(?:[^:\r\n\s]+))?(\:(?:[^.\r\n\s]+))?/mg; 
	this.matchRegExp = /(__|\/°|⠒|﹙)((?:[^\.:\r\n\s]+))?(\.(?:[^:\r\n\s]+))?(\:(?:[^.\r\n\s]+))?/mg; 

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	
	this.pc = this.p.configTickText;

	idTypes.map( function(id) {
		self.pc[id] = self.pc[id] || {};
	})
};

exports.parse = function() {
	var reEnd;

	switch (this.match[1]) {
		case "__":
			reEnd = /___|_\//g
		break;
		case "/°":
			reEnd = /°\//g
		break;
		case "⠒":
			reEnd = /⠶/g
		break;
		case "﹙":
			reEnd = /﹚/g
		break;
	}

	// Get the styles and class
	var	_sym = this.match[2] || "",
		_classes = this.match[3] ? this.match[3].split(".").join(" ") : "",
		_params = this.match[4],
		_element = "span";

	// Move past the match
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse the run up to the terminator
	var tree = this.parser.parseInlineRun(reEnd,{eatTerminator: true});

// "_debug" is a binary parameter
//	var options = {symbol: sym, _mode : "inline", _element : "span", _classes : _classes, _endString : "/°", _use: "", _useGlobal: "",
//				_debug: false, _debugString: "", _srcName:"src", _params : (_params !== "") ? _params.split(":") : [] };

	// Return the classed span
	var node = {
		type: "element",
		tag: _element,
		attributes: {
			"class": {type: "string", value: _classes + " " + "wltc wltc-inline"}
		},
		children: tree
	};
	// if(_classes) {
	// 	$tw.utils.addClassToParseTreeNode(node,_classes);
	// }
	// if(_params) {
	// 	$tw.utils.addAttributeToParseTreeNode(node,"style",_params);
	// }
	return [node];
};

})();
