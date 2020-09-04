/*\
title: $:/plugins/wikilabs/tick-text/wikirules/tick-text.js
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
};

/*
Parse the most recent match
*/
exports.parse = function() {
	var self = this;
	/*
	Skip any whitespace at the current position. Options are:
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
//	var level = (this.match[2]) ? this.match[2].length + 1 : 1; //x
//	var level = (this.match[2]) ? this.match[2].length - 1 : 1; //y
	// Move past the !s
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse any classes, whitespace and then the heading itself
	var classes = this.parser.parseClasses();
	var pc = this.parser.configTickText;
	var x = classes[0];
	
	if (pc && pc.tick && pc.tick[x]) {
		options.symbol = pc.tick[x].symbol || options.mode;
		options.endString = pc.tick[x].endString || options.endString;
		// if there is an endString block mode is forced
//		options.mode = (options.endString !== "") ? "block" : pc.tick[x].mode || options.mode;
		options.mode = pc.tick[x].mode || options.mode;
		options.tag = pc.tick[x].tag || options.tag;
		options.params = pc.tick[x].params.split(".").join(" ").trim() || options.params;
		classes[0] = options.params // remove the name element
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
