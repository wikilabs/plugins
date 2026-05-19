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
		// See marker-block.js for why all markers are loaded at init.
		parser.cmRegistry.loadAllMarkers();
		parser.cmRegistry.loadGlobalPragmas();
		parser.cmRegistry.activateFromTypeField(parser.type);
		parser.cmRegistry.applyAmendRules(parser);
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
	// Vocabulary scoping: emit matched text as plain text if the marker's
	// open isn't in any active vocabulary for this parser.
	if(!registry.isActive(marker.open)) {
		this.parser.pos = this.matchRegExp.lastIndex;
		return [{type: "text", text: matchText}];
	}
	var textStart = this.match.index;
	var parsed = parseMatchTail(matchText, marker);
	this.parser.pos = this.matchRegExp.lastIndex;
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	var contentStart = this.parser.pos;
	var config = resolveConfig(marker, parsed.symbol, parsed.classes);
	config.quotedArgs = parsed.quotedArgs;
	var children = parseBody(this.parser, config);
	var textEnd = this.parser.pos;
	var nodes = [];
	if(config.debug && config.debug !== "no") {
		var textOuter = this.parser.source.slice(textStart, textEnd).replace(/(?:\r?\n)+$/, "");
		nodes = nodes.concat(buildDebugNodes(config.debug, config.debugString || "", textOuter));
	}
	if(!isDebugRenderSuppressed(config.debug)) {
		nodes.push(buildNode(config, children, this.parser.source, contentStart, textEnd));
	}
	return nodes;
};

function buildDebugNodes(debug, debugString, textOuter) {
	var nodes = [];
	switch(debug) {
		case "both":
			nodes.push(codeblockNode(debugString));
			nodes.push(codeblockNode(textOuter));
			break;
		case "text":
		case "textOnly":
			nodes.push(codeblockNode(textOuter));
			break;
		case "pragmaOnly":
		case "pragma":
		default:
			nodes.push(codeblockNode(debugString));
	}
	return nodes;
}

function isDebugRenderSuppressed(debug) {
	return debug === "textOnly" || debug === "pragmaOnly";
}

function codeblockNode(text) {
	return {
		type: "codeblock",
		attributes: {code: {type: "string", value: text || ""}}
	};
}

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
	var result = {symbol: "", classes: [], quotedArgs: []};
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
	var sym = lookupSymbol(marker, symbol);
	if(sym) {
		sym = followUse(marker, sym);
		applySymbolToConfig(config, sym);
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

function lookupSymbol(marker, symbol) {
	if(marker.symbols && marker.symbols[symbol]) { return marker.symbols[symbol]; }
	if(marker.globalSymbols && marker.globalSymbols[symbol]) { return marker.globalSymbols[symbol]; }
	return null;
}

function followUse(marker, sym) {
	if(sym.use) {
		var localTarget = marker.symbols && marker.symbols[sym.use];
		if(localTarget) { return mergeSymbol(localTarget, sym, "use"); }
		return $tw.utils.extend({}, sym, {
			debug: sym.debug || "pragma",
			debugString: "Error - \\custom " + (marker.legacyKind || marker.open) + "=" + sym.use + " is not defined!"
		});
	}
	if(sym.useGlobal) {
		// _useGlobal switches to target wholesale (v0.x semantics).
		// Only local _debug wins (forceDebug); target's _debugString shows.
		var globalTarget = marker.globalSymbols && marker.globalSymbols[sym.useGlobal];
		if(globalTarget) {
			var merged = $tw.utils.extend({}, globalTarget);
			delete merged.useGlobal;
			if(sym.debug) { merged.debug = sym.debug; }
			return merged;
		}
		return $tw.utils.extend({}, sym, {
			debug: sym.debug || "pragma",
			debugString: "Error - global \\custom " + (marker.legacyKind || marker.open) + "=" + sym.useGlobal + " is not defined!"
		});
	}
	return sym;
}

function mergeSymbol(target, sym, useField) {
	var merged = $tw.utils.extend({}, target, sym);
	delete merged[useField];
	if(target.attributes && sym.attributes) {
		merged.attributes = $tw.utils.extend({}, target.attributes, sym.attributes);
	}
	return merged;
}

function applySymbolToConfig(config, sym) {
	if(sym.element) { config.element = sym.element; }
	if(sym.classes) { config.classes = config.classes + sym.classes; }
	if(sym.mode) { config.mode = sym.mode; }
	if(sym.srcName) { config.srcName = sym.srcName; }
	if(sym.attributes) { config.attributes = $tw.utils.extend({}, config.attributes, sym.attributes); }
	if(sym.params) { config.params = sym.params; }
	if(sym.debug) { config.debug = sym.debug; }
	if(sym.debugString) { config.debugString = sym.debugString; }
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

// Convert a parseAttribute token (or plain string) into a parse-tree
// attribute node, preserving indirect / macro / filtered / substituted
// types so `{{!!field}}`, `<<macro>>`, etc. don't get stringified.
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
