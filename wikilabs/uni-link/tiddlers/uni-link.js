/*\
title: $:/plugins/wikilabs/uni-link/uni-link.js
type: application/javascript
module-type: wikirule

Wiki text inline rule for uni link macros. For example:

```
[[Introduction]] ... uni-link

[[Link description|?]] ... alias-link
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.name = "unilink";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /\[\[(.*?)(?:\|(.*?))?\]\]/mg;
};

exports.parse = function() {
	// Move past the match
	this.parser.pos = this.matchRegExp.lastIndex;
	// Process the link
	var text = this.match[1],
		link = this.match[2] || text,
		checkAlias = this.match[2] === "?",
		useUniLink = !(this.match[2] === "");

	if($tw.utils.isLinkExternal(link)) {
		return [{
			type: "element",
			tag: "a",
			attributes: {
				href: {type: "string", value: link},
				"class": {type: "string", value: "tc-tiddlylink-external"},
				target: {type: "string", value: "_blank"},
				rel: {type: "string", value: "noopener noreferrer"}
			},
			children: [{
				type: "text", text: text
			}]
		}];
	} else if(checkAlias) {
		return [{
			type: "macrocall",
			name: "aka",
			params: [
				{name: "target", value: text}
				]
			}
		];
	} else if((text == link) && useUniLink) {
		// we need to add the type: "link" element, since the core needs it to find "backlinks" and "missing links" ...
		return [{
			type: "link",
			attributes: {
				to: {type: "string", value: text},
				tag: {type: "string", value: "x"},
				overrideClass: {type: "string", value: ""},
				draggable: {type: "string", value: "false"}
				}
			},
			{
			type: "macrocall",
			name: "uni-link",
			params: [
				{name: "tid", value: text}
				]
			}
		];
	} else {
		return [{
			type: "link",
			attributes: {
				to: {type: "string", value: link}
			},
			children: [{
				type: "text", text: text
			}]
		}];
	}
};

})();
