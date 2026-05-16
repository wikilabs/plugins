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
		// Pull bridged symbols from PageTemplate's `\importcustom`-loaded
		// pragmas (v0.x global pragma equivalent). Recursion-guarded.
		parser.cmRegistry.loadGlobalPragmas();
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
	config.quotedArgs = parsed.quotedArgs;
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
	var result = {level: 1, symbol: "", classes: [], quotedArgs: []};
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
	while(matchText.charAt(pos) === ":" && matchText.charAt(pos + 1) === '"') {
		var qMatch = /^:"([^"]*)"/.exec(matchText.substr(pos));
		if(qMatch) {
			result.quotedArgs.push(qMatch[1]);
			pos += qMatch[0].length;
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
		// Block-position fires (this rule) always wrap in a block element.
		// `mode: inline` controls how the body is parsed (single line vs
		// multi-block); it doesn't change the container element type.
		element: marker.element || "div",
		endString: marker.endString,
		classes: marker.classes || "",
		attributes: marker.attributes || {},
		srcName: marker.srcName,
		userClasses: classes
	};
	if(marker.symbols && marker.symbols[symbol]) {
		// Symbol override (also fires for bare-kind pragmas registered at
		// the empty-string key, e.g. `\custom angle _element=td`).
		var sym = marker.symbols[symbol];
		if(sym.element) { config.element = sym.element; }
		if(sym.endString !== undefined) { config.endString = sym.endString; }
		if(sym.classes) { config.classes = config.classes + sym.classes; }
		if(sym.mode) { config.mode = sym.mode; }
		if(sym.srcName) { config.srcName = sym.srcName; }
		if(sym.attributes) { config.attributes = $tw.utils.extend({}, config.attributes, sym.attributes); }
		if(sym.params) { config.params = sym.params; }
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
		// Wrapper element `<p>` can't legally contain block-level children,
		// so parse body inline (terminator = blank line) and let the inline
		// content render directly inside the paragraph. This matches v0.x's
		// useParagraph markers (», ≈, ¶) which rendered as
		// `<p class="...">inline content</p>` not nested paragraphs.
		if(config.element === "p") {
			return parser.parseInlineRun(/(\r?\n\r?\n)/mg, {eatTerminator: true});
		}
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
	if(config.level) {
		classes.push("wltc-l" + config.level);
	}
	classes.push("wltc");
	var attrs = {
		"class": {type: "string", value: classes.join(" ").trim()}
	};
	if(config.attributes) {
		for(var key in config.attributes) {
			if(key !== "class") {
				attrs[key] = toAttrNode(config.attributes[key]);
			}
		}
	}
	if(config.params && config.params.length > 0) {
		var args = config.quotedArgs || [];
		for(var i = 0; i < config.params.length; i++) {
			var p = config.params[i];
			if(!p || !p.name) { continue; }
			var override = args[i];
			if(typeof override === "string" && override.length > 0) {
				attrs[p.name] = {type: "string", value: override};
			} else {
				attrs[p.name] = toAttrNode(p);
			}
		}
	}
	if(config.element.charAt(0) === "$") {
		var contentEnd = parserPos;
		if(config.endString) { contentEnd -= config.endString.length; }
		var innerText = source.substring(contentStart, contentEnd);
		// Strip trailing line-endings consumed by the implicit terminator
		// (eatTerminator on inline mode, or the blank-line terminator on
		// block-with-paragraph wrapping). Otherwise widget attributes pick
		// up stray "\n" — which becomes "%0A" in URL-valued attrs.
		if(!config.endString) {
			innerText = innerText.replace(/(?:\r?\n)+$/, "");
		}
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

// Convert a parseAttribute token (or a plain string) into a parse-tree
// attribute node. Preserves indirect / macro / filtered / substituted
// types so `{{!!field}}`, `<<macro>>`, and `{{{filter}}}` survive into
// the rendered widget instead of being stringified to "[object Object]".
function toAttrNode(token) {
	if(token === null || token === undefined) {
		return {type: "string", value: ""};
	}
	if(typeof token === "string") {
		return {type: "string", value: token};
	}
	switch(token.type) {
		case "indirect":
			return {type: "indirect", textReference: token.textReference};
		case "macro":
			return {type: "macro", value: token.value};
		case "filtered":
			return {type: "filtered", filter: token.filter};
		case "substituted":
			return {type: "substituted", rawValue: token.rawValue};
		case "string":
		default:
			return {type: "string", value: (token.value !== undefined) ? String(token.value) : ""};
	}
}
