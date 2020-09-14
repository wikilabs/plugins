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
	this.pc.underscore = this.pc.underscore || {};
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
	var _params  = (this.match[3]) ? this.match[3] : "";

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
			id = "underscore"
		break;
		case "°":
			id = "degree"
		break;
	}
	
	// "_debug" is a binary parameter
	var options = {symbol: sym, _mode : "inline", _element : (id==="angel") ? "p" : "div", _params : _params, _endString : "", _use: "", _debug: false};
	
	var textEndInner,
		textStartInner,
		textEnd,
		textStart = this.parser.pos; // remember text postions for widget text handling

	// Move past the start symbol
	this.parser.pos = this.matchRegExp.lastIndex;
	
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	// remember text postions for macro src handling
	textStartInner = this.parser.pos
	// Parse any classes, whitespace and then the heading itself
	var classes = _params.split(".");

	if (!sym && this.pc[id]["true"]) {
		sym = (this.pc[id]["true"]._use) ? this.pc[id]["true"]._use : true;
	} else if (sym && this.pc[id][sym] && this.pc[id][sym]._use) {
		sym = this.pc[id][sym]._use;
	} else if (sym !== "") {
		options._element = ($tw.config.htmlBlockElements.indexOf(sym) !== -1) ? sym : options._element;
	}
	
	if (this.pc[id][sym]) {
		options.symbol = this.pc[id][sym].symbol || options.symbol;
		options._endString = this.pc[id][sym]._endString || options._endString;
		options._mode = this.pc[id][sym]._mode || options._mode;
		options._element = this.pc[id][sym]._element || options._element;
		options._params = this.pc[id][sym]._params || options._params;
		options._debug = this.pc[id][sym]._debug || options._debug;
		classes = (options._params + _params).split(".") // pragma _params are added to tick _params
//		classes[0] = options._params.split(".").join(" ").trim() // replace the name element
	}
	
	// show tick config and code
	if (options._debug) {
		var text = "\\customize " + id + '="' + options.symbol + '" htmlTag="' + options._element +
					'" _params="' + options._params + '" _mode="' + options._mode + '" _endString="' + options._endString +
					'"';
		
		root.push({type:"codeblock", attributes:{ code: {type:"string", value: text}}})
	}
	
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});

	if (options._mode === "block") {
	// standard rendering
		// no GROUP in block mode
		classes.push(CLASS_PREFIX + level);
		
//		tree = this.parser.parseBlocks("^" + $tw.utils.escapeRegExp(options._endString) + "$");
		tree = this.parser.parseBlocks($tw.utils.escapeRegExp(options._endString));
	} else {
		// apply CLASS_GROUP only if in inline mode. 
		classes.push(CLASS_PREFIX + level + " " + CLASS_GROUP);

		if (options._endString === "") {
			tree = this.parser.parseInlineRun((id==="angel") ? /(\r?\n\r?\n)/mg : /(\r?\n)/mg);// OK for single new-line
		} else {
			tree = this.parser.parseInlineRun(new RegExp("(^" + $tw.utils.escapeRegExp(options._endString) + "$)","mg"));
		}
	}
	// remember text postions for macro src handling
	textEndInner = this.parser.pos - options._endString.length;

	skipEndString(options._endString);
	
	textEnd = this.parser.pos;

	var fixAttributes = ["tick", "angel", "comma", "underscore", "degree", "symbol", "_endString", "_mode", "_element", "_params", "_use", "_debug"];

	var attributes = {
			"class": {type: "string", value: classes.join(" ").trim()}
		}
	// Callback is invoked with (element,title,object)
	$tw.utils.each(this.pc[id][sym], function(val,title) {
		if (fixAttributes.indexOf(title) === -1) {
			attributes[title] = {type:"string", value: val}
			}
	});

	if (options._element[0] === "$") {
		var textOuter = this.parser.source.slice(textStart, textEnd);
		var textInner = this.parser.source.slice(textStartInner, textEndInner);
		var type = options._element.slice(1);
		
		root.push({ type: type,
					tag: options._element,
					attributes: attributes,
					children: tree})
	} else {
		root.push( { type: "element", tag: options._element, attributes: attributes, children: tree});
	}
	// Return the paragraph
	return root;
};
})();
