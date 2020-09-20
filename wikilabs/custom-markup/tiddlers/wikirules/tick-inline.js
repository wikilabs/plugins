/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/tickinline.js
type: application/javascript
module-type: wikirule

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

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /°°(\.(?:[^\r\n\s]+))?/mg; // OK
//	this.matchRegExp = /´´((?:[^\.\r\n\s]+))?(\.(?:[^\r\n\s]+))?/mg;
//	this.matchRegExp = /´´((?:[^\.\r\n\s:]+:[^\r\n;]+;)+)?(\.(?:[^\r\n\s]+)\s+)?/mg;
};

exports.parse = function() {
	var reEnd = /°°/g;
	// Get the styles and class
	var stylesString = this.match[1],
		classString = this.match[1] ? this.match[1].split(".").join(" ") : undefined;
	// Move past the match
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse the run up to the terminator
	var tree = this.parser.parseInlineRun(reEnd,{eatTerminator: true});
	// Return the classed span
	var node = {
		type: "element",
		tag: "span",
		attributes: {
			"class": {type: "string", value: "wltc wltc-inline"}
		},
		children: tree
	};
	if(classString) {
		$tw.utils.addClassToParseTreeNode(node,classString);
	}
//	if(stylesString) {
//		$tw.utils.addAttributeToParseTreeNode(node,"style",stylesString);
//	}
	return [node];
};

})();
