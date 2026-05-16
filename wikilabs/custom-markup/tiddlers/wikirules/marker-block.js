/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/marker-block.js
type: application/javascript
module-type: wikirule

Block-level Custom-Markup parse rule. One rule for all block-invokable
markers (glyph, glyph-level, word). Reads from parser.cmRegistry.

\*/

"use strict";

exports.name = "cmblock";
exports.types = {block: true};

exports.init = function(parser) {
	this.parser = parser;
	if(!parser.cmRegistry) {
		parser.cmRegistry = new $tw.utils.CmRegistry(parser.wiki);
		// Load all known markers so the regex is comprehensive at init time
		// (avoids TW's rule-pruning when source has only later-activated
		// markers). Vocabulary scoping is enforced by the active-set check
		// in parse() below.
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.activateFromTypeField(parser.type);
	}
	this.matchRegExp = parser.cmRegistry.getBlockRegex() || /(?!)/g;
};

exports.parse = function() {
	var registry = this.parser.cmRegistry;
	var matchText = this.match[0];
	var marker = identifyMarker(matchText, registry);
	if(!marker) {
		this.parser.pos = this.matchRegExp.lastIndex;
		return [];
	}
	// Vocabulary scoping: emit matched text as plain text if the marker's
	// open isn't in any active vocabulary for this parser.
	if(!registry.isActive(marker.open)) {
		this.parser.pos = this.matchRegExp.lastIndex;
		return [{type: "text", text: matchText}];
	}
	var parsed = parseMatchTail(matchText, marker);
	this.parser.pos = this.matchRegExp.lastIndex;
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	var contentStart = this.parser.pos;
	var config = resolveConfig(marker, parsed.symbol, parsed.classes, parsed.level);
	var children = parseBody(this.parser, config);
	return [buildNode(config, children, this.parser.source, contentStart, this.parser.pos)];
};

function identifyMarker(matchText, registry) {
	var markers = registry.list();
	markers.sort(function(a, b) {
		// Word ahead of non-word; longest open first within each
		if(a.kind === "word" && b.kind !== "word") { return -1; }
		if(a.kind !== "word" && b.kind === "word") { return 1; }
		return b.open.length - a.open.length;
	});
	for(var i = 0; i < markers.length; i++) {
		if(matchText.indexOf(markers[i].open) === 0) {
			return markers[i];
		}
	}
	return null;
}

function parseMatchTail(matchText, marker) {
	var result = {level: 1, symbol: "", classes: []};
	var pos = marker.open.length;
	if(marker.kind === "glyph-level") {
		while(matchText.substr(pos, marker.open.length) === marker.open) {
			result.level++;
			pos += marker.open.length;
		}
	}
	if((marker.kind === "glyph" || marker.kind === "glyph-level") && marker.allowSymbol) {
		var symMatch = /^[^.:\s]*/.exec(matchText.substr(pos));
		if(symMatch && symMatch[0].length > 0) {
			result.symbol = symMatch[0];
			pos += symMatch[0].length;
		}
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

function resolveConfig(marker, symbol, classes, level) {
	var config = {
		marker: marker,
		symbol: symbol,
		level: level,
		mode: marker.mode,
		element: marker.element || (marker.mode === "inline" ? "span" : "div"),
		endString: marker.endString,
		classes: marker.classes || "",
		attributes: marker.attributes || {},
		srcName: marker.srcName,
		userClasses: classes
	};
	if(symbol && marker.symbols && marker.symbols[symbol]) {
		var sym = marker.symbols[symbol];
		if(sym.element) { config.element = sym.element; }
		if(sym.endString !== undefined) { config.endString = sym.endString; }
		if(sym.classes) { config.classes = config.classes + sym.classes; }
		if(sym.mode) { config.mode = sym.mode; }
		if(sym.attributes) { config.attributes = $tw.utils.extend({}, config.attributes, sym.attributes); }
	} else if(symbol && marker.allowSymbol) {
		// HTML-element fallback: any HTML element name overrides the default
		var cmInline = ($tw.config.cmInlineElements || []).indexOf(symbol) !== -1;
		var cmBlock = ($tw.config.cmBlockElements || []).indexOf(symbol) !== -1;
		if(cmBlock || cmInline) {
			config.element = symbol;
			if(cmBlock) { config.mode = "block"; }
		}
	}
	return config;
}

function parseBody(parser, config) {
	if(config.mode === "block") {
		if(config.endString) {
			return parser.parseBlocks($tw.utils.escapeRegExp(config.endString));
		}
		return parser.parseBlock();
	}
	var terminator = config.endString
		? new RegExp("(" + $tw.utils.escapeRegExp(config.endString) + ")", "mg")
		: /(\r?\n)/mg;
	return parser.parseInlineRun(terminator, {eatTerminator: true});
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
	if(config.level && config.mode === "block") {
		classes.push("wltc-l" + config.level);
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
		var contentEnd = parserPos;
		if(config.endString) { contentEnd -= config.endString.length; }
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
