/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/marker-inline.js
type: application/javascript
module-type: wikirule

Inline-level Custom-Markup parse rule. Handles inline-pair kind (paired
open/close literals like /° °/, ❮ ❯, ⠒ ⠶). Reads from parser.cmRegistry.

\*/

"use strict";

exports.name = "cminline";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		parser.cmRegistry.addFromFilter("[all[shadows+tiddlers]tag[$:/tags/CustomMarkup/Marker]]");
	}
	this.matchRegExp = parser.cmRegistry.getInlineRegex() || /(?!)/g;
};

exports.parse = function() {
	var registry = this.parser.cmRegistry;
	var matchText = this.match[0];
	var marker = identifyInlinePairMarker(matchText, registry);
	if(!marker) {
		this.parser.pos = this.matchRegExp.lastIndex;
		return [];
	}
	var parsed = parseMatchTail(matchText, marker);
	this.parser.pos = this.matchRegExp.lastIndex;
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	var contentStart = this.parser.pos;
	var config = resolveConfig(marker, parsed.symbol, parsed.classes);
	var children = parseBody(this.parser, config);
	return [buildNode(config, children, this.parser.source, contentStart, this.parser.pos)];
};

function identifyInlinePairMarker(matchText, registry) {
	var markers = registry.list(function(m) { return m.kind === "inline-pair"; });
	markers.sort(function(a, b) { return b.open.length - a.open.length; });
	for(var i = 0; i < markers.length; i++) {
		if(matchText.indexOf(markers[i].open) === 0) {
			return markers[i];
		}
	}
	return null;
}

function parseMatchTail(matchText, marker) {
	var result = {symbol: "", classes: []};
	var pos = marker.open.length;
	var symMatch = /^[^.:\s]*/.exec(matchText.substr(pos));
	if(symMatch && symMatch[0].length > 0) {
		result.symbol = symMatch[0];
		pos += symMatch[0].length;
	}
	while(matchText.charAt(pos) === ".") {
		var cMatch = /^\.([^.\s:]+)/.exec(matchText.substr(pos));
		if(cMatch) {
			result.classes.push(cMatch[1]);
			pos += cMatch[0].length;
		} else {
			break;
		}
	}
	return result;
}

function resolveConfig(marker, symbol, classes) {
	var config = {
		marker: marker,
		symbol: symbol,
		mode: marker.mode,
		element: marker.element || (marker.mode === "block" ? "div" : "span"),
		close: marker.close,
		classes: marker.classes || "",
		attributes: marker.attributes || {},
		srcName: marker.srcName,
		userClasses: classes
	};
	if(symbol && marker.symbols && marker.symbols[symbol]) {
		var sym = marker.symbols[symbol];
		if(sym.element) { config.element = sym.element; }
		if(sym.classes) { config.classes = config.classes + sym.classes; }
		if(sym.mode) { config.mode = sym.mode; }
		if(sym.attributes) { config.attributes = $tw.utils.extend({}, config.attributes, sym.attributes); }
	} else if(symbol) {
		// HTML-element fallback: any HTML element name overrides the default
		var cmInline = ($tw.config.cmInlineElements || []).indexOf(symbol) !== -1;
		var cmBlock = ($tw.config.cmBlockElements || []).indexOf(symbol) !== -1;
		if(cmBlock || cmInline) {
			config.element = symbol;
		}
	}
	return config;
}

function parseBody(parser, config) {
	if(config.mode === "block") {
		return parser.parseBlocks($tw.utils.escapeRegExp(config.close));
	}
	var closeRe = new RegExp("(" + $tw.utils.escapeRegExp(config.close) + ")", "mg");
	return parser.parseInlineRun(closeRe, {eatTerminator: true});
}

function buildNode(config, children, source, contentStart, parserPos) {
	var classes = [];
	if(config.classes) {
		$tw.utils.each(config.classes.split("."), function(c) {
			if(c) { classes.push(c); }
		});
	}
	if(config.userClasses && config.userClasses.length) {
		classes = classes.concat(config.userClasses);
	}
	classes.push("wltc");
	var attrs = {
		"class": {type: "string", value: classes.join(" ").trim()}
	};
	if(config.attributes) {
		for(var key in config.attributes) {
			if(key !== "class") {
				attrs[key] = {type: "string", value: String(config.attributes[key])};
			}
		}
	}
	if(config.element.charAt(0) === "$") {
		var contentEnd = parserPos - (config.close ? config.close.length : 0);
		var innerText = source.substring(contentStart, contentEnd);
		attrs[config.srcName || "src"] = {type: "string", value: innerText};
		return {
			type: config.element.substr(1),
			tag: config.element,
			attributes: attrs,
			children: children
		};
	}
	return {
		type: "element",
		tag: config.element,
		attributes: attrs,
		children: children
	};
}
