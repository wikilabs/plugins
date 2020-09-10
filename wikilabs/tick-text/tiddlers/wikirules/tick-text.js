/*\
title: $:/plugins/wikilabs/tick-text/wikirules/ticktext.js
type: application/javascript
module-type: wikirule

Wiki text block rule for ticktext and angeltext

Detect

´´´asdf.my.Class This is some text with a name and class
´.a.b.c.d This is some text with class
»»»asdf.my.Class This is some text with a name and class
».a.b.c.d This is some text with class

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
//	this.matchRegExp = /(^´{1,4}|^»{1,4})/mg; //a  OK
	
	// match[1] ... all symbols 1-4 ´ or » or ° or , or _
	// match[2] ... htmlTag ... default DIV
	// match[3] ... classString
//	this.matchRegExp = /(^´{1,4}|^»{1,4})((?:[^\.\r\n\s]+))?(\.(?:[^\r\n\s]+))?/mg; //a  
//	this.matchRegExp = /((?=´[^´])´|»{1,4})((?:[^\.\r\n\s´]+))?(\.(?:[^\r\n\s]+))?/mg; //a  OK
	this.matchRegExp = /((?=´[^´])´|»{1,4}|(?=°[^°])°|(?=,[^,]),|(?=_[^_])_)((?:[^\.\r\n\s´°]+))?(\.(?:[^\r\n\s]+))?/mg; //a  OK

	this.p = this.parser;
	this.p.configTickText = this.p.configTickText || {};
	
	this.pc = this.p.configTickText;
	this.pc.tick = this.pc.tick || {};
	this.pc.comma = this.pc.comma || {};
	this.pc.degree = this.pc.degree || {};
	this.pc.underline = this.pc.underline || {};
	this.pc.angel = this.pc.angel || {};
	this.pc.X = {}; // There is a naming problem
};

/*
Parse the most recent match
*/
exports.parse = function() {
	/*
	Skip the endstring at the current position. Options are:
	treatNewlinesAsNonWhitespace: true if newlines are NOT to be treated as whitespace
	*/
	function skipEndString (endString) {
		var endRegExp = new RegExp("(" + $tw.utils.escapeRegExp(endString) + ")","mg")
		endRegExp.lastIndex = self.parser.pos;
		var endMatch = endRegExp.exec(self.parser.source);
		if(endMatch && endMatch.index === self.parser.pos) {
			self.parser.pos = endRegExp.lastIndex;
		}
	}

//---------------------
	var self = this,
		tree = [],
		root = [];

	// Get all the details of the match
	var level   = this.match[1].length; //abc
	var id;
//	var id      = (this.match[1][0] === "°" || this.match[1][0] === "´") ? "tick" : (this.match[1][0] === "»") ? "angel" : null;
//	var id      = (this.match[1][0] === "´") ? "tick" : (this.match[1][0] === "»") ? "angel" : null;
	var sym     = this.match[2]; // needs to be undefined if no match
	var params  = (this.match[3]) ? this.match[3] : "";

	switch (this.match[1][0]) {
		case "»":
			id = "angel"
		break;
		case "´":
			id = "tick"
		break;
		case ",":
			id = "comma"
		break;
		case "_":
			id = "underline"
		break;
		case "°":
			id = "degree"
		break;
	}
	
	// "debug" is a binary parameter
	var options = {symbol: sym, mode : "inline", tag : (id==="angel") ? "p" : "div", params : params, endString : "", use: "", debug: false};
	
	var textEndInner,
		textStartInner,
		textEnd,
		textStart = this.parser.pos; // remember text postions for widget text handling

	// Move past the start symbol
	this.parser.pos = this.matchRegExp.lastIndex;
	
	this.parser.skipWhitespace();
	// remember text postions for macro src handling
	textStartInner = this.parser.pos
	// Parse any classes, whitespace and then the heading itself
	var classes = params.split(".");

	if (!sym && this.pc[id]["true"]) {
		sym = (this.pc[id]["true"].use) ? this.pc[id]["true"].use : true;
	} else if (sym && this.pc[id][sym] && this.pc[id][sym].use) {
		sym = this.pc[id][sym].use;
	}
	
	if (this.pc[id][sym]) {
		options.symbol = this.pc[id][sym].symbol || options.symbol;
		options.endString = this.pc[id][sym].endString || options.endString;
		options.mode = this.pc[id][sym].mode || options.mode;
		options.tag = this.pc[id][sym].tag || options.tag;
		options.params = this.pc[id][sym].params || options.params;
		options.debug = this.pc[id][sym].debug || options.debug;
		classes = (options.params + params).split(".") // pragma params are added to tick params
//		classes[0] = options.params.split(".").join(" ").trim() // replace the name element
	}
	
	// show tick config and code
	if (options.debug) {
		var text = "\\customize " + id + '="' + options.symbol + '" htmlTag="' + options.tag +
					'" params="' + options.params + '" mode="' + options.mode + '" endString="' + options.endString +
					'"';
		
		root.push({type:"codeblock", attributes:{ code: {type:"string", value: text}}})
	}
	
	this.parser.skipWhitespace();

	if (options.mode === "block") {
	// standard rendering
		// no GROUP in block mode
		classes.push(CLASS_PREFIX + level);
		
		tree = this.parser.parseBlocks("^" + $tw.utils.escapeRegExp(options.endString) + "$");
	} else {
		// apply CLASS_GROUP only if in inline mode. 
		classes.push(CLASS_PREFIX + level + " " + CLASS_GROUP);

		if (options.endString === "") {
			tree = this.parser.parseInlineRun((id==="angel") ? /(\r?\n\r?\n)/mg : /(\r?\n)/mg);// OK for single new-line
		} else {
			tree = this.parser.parseInlineRun(new RegExp("(^" + $tw.utils.escapeRegExp(options.endString) + "$)","mg"));
		}
	}
	// remember text postions for macro src handling
	textEndInner = this.parser.pos - options.endString.length;

	skipEndString(options.endString);
	
	textEnd = this.parser.pos;

	var fixAttributes = ["tick", "angel", "comma", "underline", "degree", "symbol", "endString", "mode", "htmlTag", "params", "use", "debug"];

	var attributes = {
			"class": {type: "string", value: classes.join(" ").trim()}
		}
	// Callback is invoked with (element,title,object)
	$tw.utils.each(this.pc[id][sym], function(val,title) {
		if (fixAttributes.indexOf(title) === -1) {
			attributes[title] = {type:"string", value: val}
			}
	});

	if (options.tag[0] === "$") {
		var textOuter = this.parser.source.slice(textStart, textEnd);
		var textInner = this.parser.source.slice(textStartInner, textEndInner);
		var type = options.tag.slice(1);
		
		root.push({ type: type,
					tag: options.tag,
					attributes: attributes,
					children: tree})
	} else {
		root.push( { type: "element", tag: options.tag, attributes: attributes, children: tree});
	}
	// Return the paragraph
	return root;
};
})();
