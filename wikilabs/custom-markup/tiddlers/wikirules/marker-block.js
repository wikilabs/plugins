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
		// Schedule the declared TW core-rule exclusions. The actual mutation
		// runs via a one-shot parsePragmas wrap (see registry.applyAmendRules
		// for why); init() is too early to amend rules safely.
		parser.cmRegistry.applyAmendRules(parser);
	}
	this.matchRegExp = parser.cmRegistry.getBlockRegex() || /(?!)/g;
};

// Override the default findNextMatch so that AFTER pragmas have parsed
// (so `\importcustom` has had its chance to activate vocabs), we skip
// over inactive marker positions instead of claiming them. Without this
// filter, an inactive marker whose open literal collides with a TW core
// rule (Vocab/Fountain's `#` SECTION vs core `list`, etc.) would silently
// eat the position via the text-fallback in parse(), suppressing the
// core rule for any tiddler in the wiki — even tiddlers that don't
// activate the offending vocab.
//
// Before pragmas: behave like the default (accept any marker match) so
// the rule survives TW's `instantiateRules` pruning and remains
// available for pragma-activated vocabs to use.
exports.findNextMatch = function(startPos) {
	var source = this.parser.source;
	var regex = this.matchRegExp;
	regex.lastIndex = startPos;
	var match;
	while((match = regex.exec(source)) !== null) {
		if(this.parser._cmPragmasDone) {
			var marker = identifyMarker(match[0], this.parser.cmRegistry);
			if(!marker || !this.parser.cmRegistry.isActive(marker.open)) {
				regex.lastIndex = match.index + 1;
				continue;
			}
		}
		this.match = match;
		return match.index;
	}
	this.match = null;
	return undefined;
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
	// List-item markers consume the whole list in one parse() call:
	// consecutive items collapse into a single container element, deeper
	// indent nests under the previous item, container switch starts a
	// sibling list. Body of each item parses as an inline run.
	if(marker.kind === "list-item") {
		return parseListItems(this.parser, this.match, this.matchRegExp);
	}
	var textStart = this.match.index;
	var parsed = parseMatchTail(matchText, marker);
	this.parser.pos = this.matchRegExp.lastIndex;
	this.parser.skipWhitespace({treatNewlinesAsNonWhitespace: true});
	var contentStart = this.parser.pos;
	var config = resolveConfig(marker, parsed.symbol, parsed.classes, parsed.level);
	config.quotedArgs = parsed.quotedArgs;
	var children = parseBody(this.parser, config);
	// Marker opts into keeping its open literal visible as body content
	// (Fountain transitions: `CUT TO:`, `FADE IN:`, ... where the keyword
	// IS the content). Add a trailing space when body has content so the
	// open literal and body don't run together (`INT. KITCHEN`, not
	// `INT.KITCHEN`); skipWhitespace eats the source-side separator before
	// body parsing begins, so we re-introduce it on the rendered side.
	if(marker.emitOpen === "yes") {
		children.unshift({type: "text", text: children.length > 0 ? marker.open + " " : marker.open});
	}
	var textEnd = this.parser.pos;
	var nodes = [];
	if(config.debug && config.debug !== "no") {
		// Strip the trailing terminator (newline or blank-line) that
		// eatTerminator consumed, so the debug `text` codeblock matches
		// v0.x's clean per-marker source slice.
		var textOuter = this.parser.source.slice(textStart, textEnd).replace(/(?:\r?\n)+$/, "");
		nodes = nodes.concat(buildDebugNodes(config.debug, config.debugString || "", textOuter));
	}
	if(!isDebugRenderSuppressed(config.debug)) {
		nodes.push(buildNode(config, children, this.parser.source, contentStart, textEnd));
	}
	return nodes;
};

// `_debug` modes from v0.x (glyph-text.js / glyph-inline.js):
//   pragma (default), pragmaOnly, text, textOnly, both, no.
// `*Only` variants suppress the normal render. `both` shows both code blocks.
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

function identifyMarker(matchText, registry) {
	var markers = registry.list();
	markers.sort(function(a, b) {
		// Word ahead of non-word; longest open first within each
		if(a.kind === "word" && b.kind !== "word") { return -1; }
		if(a.kind !== "word" && b.kind === "word") { return 1; }
		var aLen = a.kind === "list-item" ? (a.openPattern || a.open).length : a.open.length;
		var bLen = b.kind === "list-item" ? (b.openPattern || b.open).length : b.open.length;
		return bLen - aLen;
	});
	// list-item matches start with optional indent; strip it before testing
	// the bullet so e.g. "  - " resolves to the dash marker.
	var trimmed = matchText.replace(/^[ \t]+/, "");
	for(var i = 0; i < markers.length; i++) {
		var m = markers[i];
		if(m.kind === "list-item") {
			if(m.openPattern) {
				if(new RegExp("^(?:" + m.openPattern + ")").test(trimmed)) {
					return m;
				}
			} else if(trimmed.indexOf(m.open) === 0) {
				return m;
			}
		} else if(matchText.indexOf(m.open) === 0) {
			return m;
		}
	}
	return null;
}

// Consume a run of list-item matches into a nested tree of container
// elements. Each item's body is parsed as an inline run terminated by
// the next newline. Indent (after tab-expansion to indent-unit spaces)
// drives nesting level; container change at the same level starts a
// sibling list.
function parseListItems(parser, firstMatch, blockRegExp) {
	var registry = parser.cmRegistry;
	var roots = [];
	var stack = []; // [{listNode, container, level}]
	var sharedRe = new RegExp(blockRegExp.source, "mg");
	var match = firstMatch;

	while(match) {
		var marker = identifyMarker(match[0], registry);
		if(!marker || marker.kind !== "list-item" || !registry.isActive(marker.open)) { break; }

		var indentText = (/^[ \t]*/.exec(match[0]) || [""])[0];
		var indent = indentText.replace(/\t/g, repeatSpace(marker.indentUnit)).length;
		var level = Math.floor(indent / marker.indentUnit);
		if(level > stack.length) { level = stack.length; }

		while(stack.length > level + 1) { stack.pop(); }

		if(stack.length === level + 1 && stack[level].container !== marker.container) {
			stack.pop();
		}

		if(stack.length === level) {
			var newList = {type: "element", tag: marker.container, children: []};
			if(level === 0) {
				roots.push(newList);
			} else {
				var parentList = stack[level - 1].listNode;
				var parentItem = parentList.children[parentList.children.length - 1];
				parentItem.children.push(newList);
			}
			stack.push({listNode: newList, container: marker.container, level: level});
		}

		parser.pos = match.index + match[0].length;
		var bodyTree = parser.parseInlineRun(/(\r?\n)/mg, {eatTerminator: true});

		stack[level].listNode.children.push({
			type: "element",
			tag: marker.itemElement,
			children: bodyTree
		});

		sharedRe.lastIndex = parser.pos;
		var nextMatch = sharedRe.exec(parser.source);
		if(!nextMatch || nextMatch.index !== parser.pos) { break; }
		match = nextMatch;
	}

	return roots;
}

function repeatSpace(n) {
	var s = "";
	for(var i = 0; i < n; i++) { s += " "; }
	return s;
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
	var sym = lookupSymbol(marker, symbol);
	if(sym) {
		// Follow `_use` / `_useGlobal` aliases. Errors are surfaced via
		// the debug-codeblock path in parse().
		sym = followUse(marker, sym);
		applySymbolToConfig(config, sym);
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

function lookupSymbol(marker, symbol) {
	if(marker.symbols && marker.symbols[symbol]) { return marker.symbols[symbol]; }
	if(marker.globalSymbols && marker.globalSymbols[symbol]) { return marker.globalSymbols[symbol]; }
	return null;
}

// Resolve `_use` (local-only alias) and `_useGlobal` (global-only alias)
// chains. v0.x semantics:
//   _use: extend target with the local pragma's overrides (local wins).
//   _useGlobal: switch to target wholesale; only the local `_debug` value
//     wins (forceDebug). Target's `_debugString` is shown so the debug
//     output reveals what config is actually applied.
function followUse(marker, sym) {
	if(sym.use) {
		var localTarget = marker.symbols && marker.symbols[sym.use];
		if(localTarget) {
			return mergeSymbol(localTarget, sym, "use");
		}
		return $tw.utils.extend({}, sym, {
			debug: sym.debug || "pragma",
			debugString: "Error - \\custom " + (marker.legacyKind || marker.open) + "=" + sym.use + " is not defined!"
		});
	}
	if(sym.useGlobal) {
		var globalTarget = marker.globalSymbols && marker.globalSymbols[sym.useGlobal];
		if(globalTarget) {
			var merged = $tw.utils.extend({}, globalTarget);
			delete merged.useGlobal;
			// Local `_debug` wins (v0.x's forceDebug capture).
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

// Merge target onto sym (sym's overrides win), dropping the `use` / `useGlobal`
// field so we don't re-follow on a subsequent resolveConfig pass.
function mergeSymbol(target, sym, useField) {
	var merged = $tw.utils.extend({}, target, sym);
	delete merged[useField];
	// Attributes from both sides should compose, not overwrite.
	if(target.attributes && sym.attributes) {
		merged.attributes = $tw.utils.extend({}, target.attributes, sym.attributes);
	}
	return merged;
}

function applySymbolToConfig(config, sym) {
	if(sym.element) { config.element = sym.element; }
	if(sym.endString !== undefined) { config.endString = sym.endString; }
	if(sym.classes) { config.classes = config.classes + sym.classes; }
	if(sym.mode) { config.mode = sym.mode; }
	if(sym.srcName) { config.srcName = sym.srcName; }
	if(sym.attributes) { config.attributes = $tw.utils.extend({}, config.attributes, sym.attributes); }
	if(sym.params) { config.params = sym.params; }
	if(sym.debug) { config.debug = sym.debug; }
	if(sym.debugString) { config.debugString = sym.debugString; }
}

// paragraph-marker: explicit schema flag. "yes" opts into paragraph
// terminator (blank line); anything else is non-paragraph (single newline).
function isParagraphMarker(marker) {
	return !!marker && marker.paragraphMarker === "yes";
}

function parseBody(parser, config) {
	if(config.mode === "block") {
		// Explicit endString wins regardless of wrapper element. Browser
		// auto-closes `<p>` when block children appear inside, matching
		// v0.x's parseBlocks-with-newline-terminator behaviour.
		if(config.endString) {
			return parser.parseBlocks($tw.utils.escapeRegExp(unescapeEndString(config.endString)));
		}
		// `<p>` wrapper without explicit endString: parse body inline so the
		// paragraph wrapper doesn't nest an inner paragraph. This is a DOM
		// constraint on the rendered element, not the marker's paragraph-ness.
		if(config.element === "p") {
			return parser.parseInlineRun(/(\r?\n\r?\n)/mg, {eatTerminator: true});
		}
		// Non-paragraph markers (´, °, › and any marker with paragraph-marker:no
		// or undefined+element!=p) default to single-newline terminator so each
		// fire on its own line is a separate node. Paragraph markers fall through
		// to blank-line default.
		if(config.marker && !isParagraphMarker(config.marker)) {
			return parser.parseBlock("\\r?\\n");
		}
		return parser.parseBlock();
	}
	// mode === "inline": pick terminator by marker's paragraph-ness. v0.x's
	// useParagraph markers (», ≈, ¶) terminate at a blank line; the rest (´, °, ›)
	// terminate at single newline. The paragraph-marker field is the canonical
	// signal; element===p is the back-compat fallback.
	var terminator;
	if(config.endString) {
		terminator = new RegExp("(" + $tw.utils.escapeRegExp(unescapeEndString(config.endString)) + ")", "mg");
	} else if(config.marker && isParagraphMarker(config.marker)) {
		terminator = /(\r?\n\r?\n)/mg;
	} else {
		terminator = /(\r?\n)/mg;
	}
	return parser.parseInlineRun(terminator, {eatTerminator: true});
}

// TW's parseAttribute returns `_endString="\n"` as the literal two-char
// string `\n`. Unescape JS-style sequences so users can write `"\n"`,
// `"\r\n"`, `"\t"` and have them mean what they look like.
function unescapeEndString(s) {
	if(typeof s !== "string") { return s; }
	return s.replace(/\\([nrt\\'"])/g, function(_, c) {
		switch(c) {
			case "n": return "\n";
			case "r": return "\r";
			case "t": return "\t";
			case "\\": return "\\";
			case "'": return "'";
			case '"': return '"';
		}
		return c;
	});
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
	if(config.level && config.marker && config.marker.kind === "glyph-level") {
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
