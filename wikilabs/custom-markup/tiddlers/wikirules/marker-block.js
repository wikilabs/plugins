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
	// Builds the registry on first wikirule init() for this parser: loads
	// all markers (so the combined regex is comprehensive — vocab scoping is
	// enforced by the active-set check in parse() below), pulls bridged
	// symbols from PageTemplate's `\importcustom`-loaded pragmas, activates
	// vocabs from the parser type, and schedules the deferred core-rule
	// exclusions (see registry.applyAmendRules for why init() is too early
	// to amend rules directly).
	var registry = $tw.utils.CmRegistry.ensureRegistry(parser);
	this.matchRegExp = registry.getBlockRegex() || /(?!)/g;
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
	// Fenced markers consume the whole block in one parse() call: the
	// open line gives the fence-run length and info string, the body is
	// captured raw until a matching close fence (same char, run length
	// >= open length, on its own line), implicit close at EOF.
	if(marker.kind === "fenced") {
		return parseFenced(this.parser, marker, this.match);
	}
	// Hr markers fire on a thematic-break line: open + optional more of
	// the same char + optional whitespace + EOL. No body, no symbol, no
	// quoted args — just emit the configured element with classes.
	if(marker.kind === "hr") {
		return parseHr(this.parser, marker, this.matchRegExp);
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
	// `\debugmarker` pragma overrides the marker's static `debug` field for
	// this tiddler. `debugMarkerAllOff` is the wiki-wide off switch
	// (`\debugmarker no`); per-marker entries in `debugMarkerOverrides`
	// (including `=no`) win over the field.
	var effectiveDebug = resolveDebugMode(this.parser, marker.open, config.debug);
	if(effectiveDebug && effectiveDebug !== "no") {
		// Strip the trailing terminator (newline or blank-line) that
		// eatTerminator consumed, so the debug `text` codeblock matches
		// v0.x's clean per-marker source slice.
		var textOuter = this.parser.source.slice(textStart, textEnd).replace(/(?:\r?\n)+$/, "");
		nodes = nodes.concat(buildDebugNodes(effectiveDebug, config.debugString || "", textOuter));
	}
	if(!isDebugRenderSuppressed(effectiveDebug)) {
		nodes.push(buildNode(config, children, this.parser.source, contentStart, textEnd));
	}
	return nodes;
};

function resolveDebugMode(parser, open, fieldDebug) {
	if(parser.debugMarkerAllOff) { return "no"; }
	var overrides = parser.debugMarkerOverrides;
	if(overrides && Object.prototype.hasOwnProperty.call(overrides, open)) {
		return overrides[open];
	}
	return fieldDebug;
}

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
		} else if(m.caseInsensitive) {
			// Case-insensitive word markers (e.g. Fountain `INT.` matching
			// `int.` / `Int.`). Compare lowercased so the marker resolves
			// regardless of source case.
			var head = matchText.substring(0, m.open.length);
			if(head.toLowerCase() === m.open.toLowerCase()) {
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

// Hr marker: emit a single childless element (default `<hr>`) for a
// thematic-break line that already matched the engine's block regex.
// No body to parse, no symbol/class chain after the open, no quoted
// args — just the classes from the marker config plus the universal
// `wltc` hook.
function parseHr(parser, marker, matchRegExp) {
	parser.pos = matchRegExp.lastIndex;
	var classes = [];
	if(marker.classes) {
		$tw.utils.each(marker.classes.split("."), function(c) {
			if(c) { classes.push(c); }
		});
	}
	classes.push("wltc");
	return [{
		type: "element",
		tag: marker.element || "hr",
		attributes: {
			"class": {type: "string", value: classes.join(" ").trim()}
		}
	}];
}

// Fenced block: capture the body between the open fence (already matched
// by the block regex) and the next matching close fence on its own line,
// with implicit close at EOF when none is found. The marker's `open`
// field pins the fence character (`open.charAt(0)`) and the MINIMUM run
// length (`open.length`); the actual open run can be longer, and the
// close must match >= that actual length. Body is captured verbatim
// (no inline parsing). The info string — text after the opening fence
// on the same line — is wired to the configured attribute (typically
// `class` with the `language-` prefix, mirroring CommonMark's output).
function parseFenced(parser, marker, match) {
	var source = parser.source;
	var openLine = match[0];
	var fenceChar = marker.open.charAt(0);

	// Count the actual fence-run length in this open instance (the marker's
	// `open.length` is the minimum; an author can use a longer run so the
	// body itself can contain shorter runs of the fence char without
	// terminating early).
	var fenceLen = 0;
	while(fenceLen < openLine.length && openLine.charAt(fenceLen) === fenceChar) {
		fenceLen++;
	}

	// Info string is everything after the fence run on the open line,
	// trimmed of surrounding whitespace.
	var infoString = openLine.substring(fenceLen).replace(/^[ \t]+|[ \t]+$/g, "");

	// Advance past the open line + its newline (CR+LF or LF). The block
	// regex captured up to (but not including) the line break so we step
	// past it explicitly.
	var afterOpen = match.index + openLine.length;
	if(source.charAt(afterOpen) === "\r") { afterOpen++; }
	if(source.charAt(afterOpen) === "\n") { afterOpen++; }

	// Scan for the matching close fence: same fence char, run length
	// >= the open run, at line start (col 0), followed by optional
	// trailing whitespace and the line terminator (or EOF).
	var fenceCharEsc = $tw.utils.escapeRegExp(fenceChar);
	var closeRe = new RegExp("^" + fenceCharEsc + "{" + fenceLen + ",}[ \\t]*(?:\\r?\\n|$)", "mg");
	closeRe.lastIndex = afterOpen;
	var closeMatch = closeRe.exec(source);
	var bodyEnd, advanceTo;
	if(closeMatch) {
		bodyEnd = closeMatch.index;
		advanceTo = closeMatch.index + closeMatch[0].length;
	} else {
		// CommonMark: missing close fence is implicitly closed at EOF.
		bodyEnd = source.length;
		advanceTo = source.length;
	}

	// Body runs from one past the open line's \n through to the start of
	// the close fence. That range includes the \n that ends the last body
	// line — keeping it would emit a visible trailing blank line inside
	// `<pre><code>...</code></pre>`. TW core's `codeblock` rule strips it
	// (the close-fence sentinel matches the \n BEFORE the fence, not the
	// fence itself); match that convention.
	var body = source.substring(afterOpen, bodyEnd).replace(/\r?\n$/, "");
	parser.pos = advanceTo;

	return buildFencedNodes(marker, infoString, body);
}

function buildFencedNodes(marker, infoString, body) {
	// Info-string value: first word by default (CommonMark / GFM
	// convention), or full string when `info-words: all`. The
	// `info-prefix` is prepended (CommonMark uses `language-`).
	var infoValue = "";
	if(infoString && marker.infoAttribute) {
		infoValue = (marker.infoWords === "all") ? infoString : infoString.split(/\s+/)[0];
		if(marker.infoPrefix) {
			infoValue = marker.infoPrefix + infoValue;
		}
	}

	// Marker identity classes (`wltc` + the marker's `.classes` chain) go
	// on the OUTERMOST block element: the wrapper when one is configured,
	// else the single element. The universal `.wltc` hook usually carries
	// a vocab-wide margin; placing it on the wrapper means the margin
	// lands OUTSIDE the visible block (e.g. above/below `<pre>`) rather
	// than inside it (where it would show as whitespace before/after the
	// rendered content). The inner element keeps only the info attribute
	// — CommonMark's `<pre><code class="language-X">...</code></pre>`
	// shape, where syntax highlighters (Prism, highlight.js, Shiki) look
	// for `.language-X` on `<code>` specifically.
	var baseClasses = [];
	if(marker.classes) {
		$tw.utils.each(marker.classes.split("."), function(c) {
			if(c) { baseClasses.push(c); }
		});
	}
	baseClasses.push("wltc");

	var hasWrapper = !!marker.wrapperElement;
	var innerAttrs = {};
	var outerAttrs = {};

	// Static attributes from the marker tiddler's `attributes` JSON field
	// land on the inner element — they describe the content element, not
	// the wrapper.
	if(marker.attributes) {
		for(var key in marker.attributes) {
			if(key !== "class") {
				innerAttrs[key] = toAttrNode(marker.attributes[key]);
			}
		}
	}

	if(hasWrapper) {
		// Wrapper carries the marker identity. Info attribute placement
		// depends on its type:
		// - `class`: stays on the INNER element alone (CommonMark
		//   `<code class="language-X">` convention — syntax highlighters
		//   like Prism / highlight.js / Shiki look there).
		// - anything else (`data-caption`, `data-attrs`, ...): goes on
		//   the OUTER wrapper alongside the marker identity classes, so
		//   a CSS rule like `.wltc-captioned-code[data-caption]::before
		//   { content: attr(data-caption); }` can target the same element
		//   for both the class hook and the attr value.
		outerAttrs["class"] = {type: "string", value: baseClasses.join(" ").trim()};
		if(infoValue) {
			if(marker.infoAttribute === "class") {
				innerAttrs["class"] = {type: "string", value: infoValue};
			} else {
				outerAttrs[marker.infoAttribute] = {type: "string", value: infoValue};
			}
		}
		parseInfoAttrsInto(marker, infoString, infoValue, outerAttrs);
	} else {
		// No wrapper — the single element collects everything.
		var innerClasses = baseClasses.slice();
		if(infoValue) {
			if(marker.infoAttribute === "class") {
				innerClasses.push(infoValue);
			} else {
				innerAttrs[marker.infoAttribute] = {type: "string", value: infoValue};
			}
		}
		innerAttrs["class"] = {type: "string", value: innerClasses.join(" ").trim()};
		parseInfoAttrsInto(marker, infoString, infoValue, innerAttrs);
	}

	var inner = {
		type: "element",
		tag: marker.element || "code",
		attributes: innerAttrs,
		children: [{type: "text", text: body}]
	};

	if(hasWrapper) {
		return [{
			type: "element",
			tag: marker.wrapperElement,
			attributes: outerAttrs,
			children: [inner]
		}];
	}
	return [inner];
}

// When `info-attrs: yes`, parse the info string (or its after-first-word
// remainder when an `info-attribute` already claimed the first word) as a
// sequence of TW macro-parameter attributes. Each parsed name is prepended
// with `data-` and the resulting attribute is added to `target`.
//
// `parseMacroParameterAsAttribute` is the canonical TW parser for the
// `name=value`, `name:value`, `name="quoted"`, `name={{!!field}}`,
// `name={{{filter}}}`, `name=<<macro>>`, `name=` ``` `subst` ``` syntaxes. Reusing it
// means all the canonical attribute value types work, plus the same
// quoting / escaping rules as everywhere else in TW.
//
// The hardcoded `data-` prefix is the security boundary: a user-supplied
// `onclick="alert(1)"` is emitted as `data-onclick="alert(1)"` (an inert
// data attribute), and a `href="javascript:..."` lands as `data-href=...`
// (no URL evaluation). No need to maintain a denylist — every parsed
// attribute becomes a data-* by construction.
function parseInfoAttrsInto(marker, infoString, infoValue, target) {
	if(!marker.infoAttrs || !infoString) { return; }
	// Determine which slice of the info string is the attr source.
	// When info-attribute already claimed the first word, parse only the
	// remainder. Otherwise the whole info string is fair game.
	var source = infoString;
	if(marker.infoAttribute && infoValue && marker.infoWords !== "all") {
		var firstWord = infoString.split(/\s+/)[0];
		source = infoString.substring(firstWord.length).replace(/^\s+/, "");
	}
	var pos = 0;
	while(pos < source.length) {
		var attr = $tw.utils.parseMacroParameterAsAttribute(source, pos);
		if(!attr || typeof attr.end !== "number" || attr.end <= pos) { break; }
		pos = attr.end;
		if(!attr.name) { continue; }
		target["data-" + attr.name] = parsedAttrToNode(attr);
	}
}

function parsedAttrToNode(attr) {
	switch(attr.type) {
		case "indirect":
			return {type: "indirect", textReference: attr.textReference};
		case "filtered":
			return {type: "filtered", filter: attr.filter};
		case "substituted":
			return {type: "substituted", rawValue: attr.rawValue};
		case "macro":
			return {type: "macro", value: attr.value};
		case "string":
		default:
			return {type: "string", value: attr.value !== undefined ? String(attr.value) : ""};
	}
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
		userClasses: classes,
		// Marker-tiddler `debug` / `debug-string` fields. Symbol resolution
		// (applySymbolToConfig) can still override these with `_use` / legacy
		// `_debug` values from a pragma symbol.
		debug: marker.debug || "",
		debugString: marker.debugString || ""
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
