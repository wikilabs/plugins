/*\
title: $:/plugins/wikilabs/tick-text/wikirules/ticktext.js
type: application/javascript
module-type: wikirule

Wiki text block rule for ticktexts

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false exports:false */
"use strict";

var CLASS_GROUP = "wltc";
var CLASS_PREFIX = CLASS_GROUP + "-l"; // l .. level

exports.name = "ticktext";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /(\´{1,4})/mg; //a  OK
//	this.matchRegExp = /(\.{1,3})/mg; //b  CSS interference
//	this.matchRegExp = /(\. )/mg;     //y  OK see: dot-space!
//	this.matchRegExp = /(\´)(\t{1,2})?/mg; //x  OK
//	this.matchRegExp = /(\´)(\´{1,3})?/mg; //x  OK
//	this.matchRegExp = /(\. )|(\.{2,4} )/mg; //y  OK

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText  || {};
	
	this.pc = this.p.configTickText;
	this.pc.tick = this.pc.tick || {};
	this.pc.angel = this.pc.angel || {};
};

/*
Parse the most recent match
*/
exports.parse = function() {
	var self = this;
	/*
	Skip the endstring at the current position. Options are:
	treatNewlinesAsNonWhitespace: true if newlines are NOT to be treated as whitespace
	*/
	var skipEndString = function(endString) {
		var endRegExp = new RegExp("(" + $tw.utils.escapeRegExp(endString) + ")","mg")
		endRegExp.lastIndex = self.parser.pos;
		var endMatch = endRegExp.exec(self.parser.source);
		if(endMatch && endMatch.index === self.parser.pos) {
			self.parser.pos = endRegExp.lastIndex;
		}
	};
	
	var tree,
		options = {symbol: "¤", mode : "inline", tag : "div", params : "", endString : ""};
	
	// Get all the details of the match
	var level = this.match[1].length; //abc
	// Move past the !s
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse any classes, whitespace and then the heading itself
	var classes = this.parser.parseClasses();
	var x = classes[0];

	if (!x && this.pc.tick["true"]) {
		x = this.pc.tick["true"].use;
	}
	
	if (this.pc.tick[x]) {
		options.symbol = this.pc.tick[x].symbol || options.mode;
		options.endString = this.pc.tick[x].endString || options.endString;
		options.mode = this.pc.tick[x].mode || options.mode;
		options.tag = this.pc.tick[x].tag || options.tag;
		options.params = this.pc.tick[x].params.split(".").join(" ").trim() || options.params;
		classes[0] = options.params // replace the name element
	}
	
	this.parser.skipWhitespace();
//	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	if (options.mode === "block") {
		// no GROUP in block mode
		classes.push(CLASS_PREFIX + level);
		
		tree = this.parser.parseBlocks("^" + $tw.utils.escapeRegExp(options.endString) + "$");  // wip OK
	} else {
		// apply CLASS_GROUP only if in inline mode. 
		classes.push(CLASS_PREFIX + level + " " + CLASS_GROUP);
		
//		tree = this.parser.parseInlineRun(new RegExp("(" + options.endString + ")","mg")); // OK for single new-line
//		tree = this.parser.parseInlineRun(/(\r?\n)/mg); // OK for single new-line

		if (options.endString === "") {
			tree = this.parser.parseInlineRun(/(\r?\n)/mg); // OK for single new-line
		} else {
//			tree = this.parser.parseInlineRun(new RegExp("(^" + options.endString + "|\\r?\\n)","mg")); // OK for single new-line
			tree = this.parser.parseInlineRun(new RegExp("(^" + $tw.utils.escapeRegExp(options.endString) + "$)","mg")); // OK for single new-line
		}
	}
	skipEndString(options.endString);
	
	// Return the paragraph
	return [{
		type: "element",
		tag: options.tag,
		attributes: {
			"class": {type: "string", value: classes.join(" ")}
		},
		children: tree
	}];
};
})();
