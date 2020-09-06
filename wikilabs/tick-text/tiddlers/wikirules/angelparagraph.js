/*\
title: $:/plugins/wikilabs/tick-text/wikirules/angelparagraph.js
type: application/javascript
module-type: wikiruleXXXX

Wiki text block rule for ticktexts

\*/
(function(){

/*jslint node: true, browser: true */
/*global exports: false */
"use strict";

var CLASS_GROUP = "wltc";
var CLASS_PREFIX = CLASS_GROUP + "-l"; // l .. level

exports.name = "angelparagraph";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
//	this.matchRegExp = /(\´{1,3})/mg; //a  OK
//	this.matchRegExp = /(\.{1,3})/mg; //b  CSS interference
//	this.matchRegExp = /(\. )/mg;     //y  OK see: dot-space!
//	this.matchRegExp = /(\´)(\t{1,2})?/mg; //x  OK
	this.matchRegExp = /(»)(»{1,3})?/mg; //x  OK
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
	// Get all the details of the match
//	var level = this.match[1].length; //abc
	var level = (this.match[2]) ? this.match[2].length + 1 : 1; //x
//	var level = (this.match[2]) ? this.match[2].length - 1 : 1; //y
	// Move past the !s
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse any classes, whitespace and then the heading itself
	var classes = this.parser.parseClasses();
	classes.push(CLASS_PREFIX + level + " " + CLASS_GROUP);
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	var tree = this.parser.parseInlineRun(/(\r?\n\r?\n)/mg);
	// Return the paragraph
	return [{
		type: "element",
		tag: "p",
		attributes: {
			"class": {type: "string", value: classes.join(" ")}
		},
		children: tree
	}];
};
})();
