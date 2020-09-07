/*\
title: $:/plugins/wikilabs/tick-text/wikirules/ticktext.js
type: application/javascript
module-type: wikirule

Wiki text block rule for ticktext and angeltext

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
	this.matchRegExp = /(^\´{1,4}|^»{1,4})/mg; //a  OK

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
	var self = this,
		tree;
	
	// Get all the details of the match
	var level = this.match[1].length; //abc
	var id = (this.match[1][0] === "´") ? "tick" : (this.match[1][0] === "»") ? "angel" : "x";

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
	
	var options = {symbol: "¤", mode : "inline", tag : (id==="tick") ? "div" : "p", params : "", endString : "", use: ""};
	
	// Move past the !s
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse any classes, whitespace and then the heading itself
	var classes = this.parser.parseClasses();
	var sym = classes[0];

	if (!sym && this.pc[id]["true"]) {
		sym = this.pc[id]["true"].use;
	} else if (sym && this.pc[id][sym] && this.pc[id][sym].use) {
		sym = this.pc[id][sym].use;
	}
	
	if (this.pc[id][sym]) {
		options.symbol = this.pc[id][sym].symbol || options.symbol;
		options.endString = this.pc[id][sym].endString || options.endString;
		options.mode = this.pc[id][sym].mode || options.mode;
		options.tag = this.pc[id][sym].tag || options.tag;
		options.params = this.pc[id][sym].params.split(".").join(" ").trim() || options.params;
		classes[0] = options.params // replace the name element
	}
	
//	if (id === "tick") {
		this.parser.skipWhitespace();
//	} else {
//		this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
//	}
	
	if (options.mode === "block") {
		// no GROUP in block mode
		classes.push(CLASS_PREFIX + level);
		
		tree = this.parser.parseBlocks("^" + $tw.utils.escapeRegExp(options.endString) + "$");  // wip OK
	} else {
		// apply CLASS_GROUP only if in inline mode. 
		classes.push(CLASS_PREFIX + level + " " + CLASS_GROUP);

		if (options.endString === "") {
			tree = this.parser.parseInlineRun((id==="tick") ? /(\r?\n)/mg : /(\r?\n\r?\n)/mg); // OK for single new-line
		} else {
			tree = this.parser.parseInlineRun(new RegExp("(^" + $tw.utils.escapeRegExp(options.endString) + "$)","mg")); // OK for single new-line
		}
	}
	skipEndString(options.endString);

	
	var fixAttributes = ["tick", "angel", "symbol", "endString", "mode", "tag", "params", "use"];
	
	var attributes = {
			"class": {type: "string", value: classes.join(" ")}
		}
	// Callback is invoked with (element,title,object)
	$tw.utils.each(this.pc[id][sym], function(val,title,ob) {
		if (fixAttributes.indexOf(title) === -1) {
			attributes[title] = {type:"string", value: val}
			}
	});

	// Return the paragraph
	return [{
		type: "element",
		tag: options.tag,
		attributes: attributes,
		children: tree
	}];
};
})();
