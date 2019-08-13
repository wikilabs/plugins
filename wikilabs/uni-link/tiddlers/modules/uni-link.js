/*\
title: $:/plugins/wikilabs/uni-link/uni-link.js
type: application/javascript
module-type: wikirule

Wiki text inline rule for uni link macros. For example:

```
[[Introduction]] ... uni-link

[[Link description|?]]  ... alias-link
[[Link description|?t]] ... alias-link - show title
[[Link description|?c]] ... alias-link - show caption
[[Link description|?s]] ... alias-link - show subtitle
[[Link description|?my-field]] ... alias-link - show any field-name as link text

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
//	this.matchRegExp = /\[\[(.*?)(?:\|(.*?))?\]\]/mg;
	this.matchRegExp = /\[\[(.*?)(?:(\|)(\?)?(.*?))?\]\]/mg;
};

exports.parse = function() {
	// Move past the match
	this.parser.pos = this.matchRegExp.lastIndex;
	// Process the link
	var text = this.match[1],
		link = this.match[4] || text,
		checkAlias = this.match[3] === "?",
		useUniLink = !(this.match[2] === "|");

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
		var field = "X"; // field names are alwayse lowercase!

		if(link === "c") {
			field = "caption"
		} else if(link === "s") {
			field = "subtitle"
		} else if(link === "t") {
			field = "title"
		} else if (text != link) {
			field = link;
		}

		return [{
			type: "macrocall",
			name: "aka",
			params: [
				{name: "target", value: text},
				{name: "field", value: field},
				]
			}
		];
	} else if((text == link) && useUniLink) {
		// Since V 1.1.0 new link-backlink detection implemented
		// Overwrites the core $tw.wiki.getTiddlerLinks() method with own version
		return [{
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
