/*\
title: $:/plugins/wikilabs/speciallinks/special.js
type: application/javascript
module-type: wikirule

Wiki text inline rule for wiki links. For example:

```
AWikiLink
AnotherLink
~SuppressedLink

Camel_Case <- special
```

Precede a camel case word with `~` to prevent it from being recognised as a link.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false exports:false */
"use strict";
var SEPARATOR = "_?";
	
var WIKILINK = $tw.config.textPrimitives.upperLetter + "+" +
$tw.config.textPrimitives.lowerLetter + "+" + SEPARATOR +
$tw.config.textPrimitives.upperLetter +
$tw.config.textPrimitives.anyLetter + "*";

exports.name = "speciallink";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = new RegExp($tw.config.textPrimitives.unWikiLink + "?" + WIKILINK,"mg");
};

/*
Parse the most recent match
*/
exports.parse = function() {
	// Get the details of the match
	var linkText = this.match[0];
	// Move past the macro call
	this.parser.pos = this.matchRegExp.lastIndex;
	// If the link starts with the unwikilink character then just output it as plain text
	if(linkText.substr(0,1) === $tw.config.textPrimitives.unWikiLink) {
		return [{type: "text", text: linkText.substr(1)}];
	}
	// If the link has been preceded with a blocked letter then don't treat it as a link
	if(this.match.index > 0) {
		var preRegExp = new RegExp($tw.config.textPrimitives.blockPrefixLetters,"mg");
		preRegExp.lastIndex = this.match.index-1;
		var preMatch = preRegExp.exec(this.parser.source);
		if(preMatch && preMatch.index === this.match.index-1) {
			return [{type: "text", text: linkText}];
		}
	}
	return [{
		type: "link",
		attributes: {
			to: {type: "string", value: linkText}
		},
		children: [{
			type: "text",
			text: linkText
		}]
	}];
};

})();
