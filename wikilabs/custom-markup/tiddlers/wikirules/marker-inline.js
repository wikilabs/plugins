/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/marker-inline.js
type: application/javascript
module-type: wikirule

Inline-level Custom-Markup parse rule. Handles two kinds:
- inline-pair: paired open/close literals like /° °/, ❮ ❯, ⠒ ⠶.
- linked-pair: open BODY close link-open LINK link-close, e.g. markdown
  `[text](url)` and `![alt](url)`. Body either parses as inline content
  (default — link text) or becomes a plain-text attribute (image alt).
  The captured LINK text is emitted on the configured attribute (href / src).
Reads from parser.cmRegistry.

\*/

"use strict";

exports.name = "cminline";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	var registry = $tw.utils.CmRegistry.ensureRegistry(parser);
	this.matchRegExp = registry.getInlineRegex() || /(?!)/g;
};

// See marker-block.js findNextMatch override for the rationale. Same
// pattern: filter inactive marker positions once pragmas have parsed,
// so inline-pair markers in vocabs the tiddler hasn't activated don't
// shadow TW core rules.
exports.findNextMatch = function(startPos) {
	var source = this.parser.source;
	var regex = this.matchRegExp;
	regex.lastIndex = startPos;
	var match;
	while((match = regex.exec(source)) !== null) {
		if(this.parser._cmPragmasDone) {
			var marker = identifyInlinePairMarker(match[0], this.parser.cmRegistry);
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
	if(marker.kind === "linked-pair") {
		return parseLinkedPair(this.parser, marker, this.match);
	}
	if(marker.openVariable) {
		return parseVariableInlinePair(this.parser, marker, this.match);
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
	// See marker-block.js for the override resolution rationale.
	var effectiveDebug = resolveDebugMode(this.parser, marker.open, config.debug);
	if(effectiveDebug && effectiveDebug !== "no") {
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
	// Pull from the inline-only dict so an inline-kind marker is still
	// findable even when a block-kind marker with the same `open` later
	// overwrote `registry.markers` (e.g. markdown's `*` ITALIC vs `*`
	// ITEM-STAR). The flat `registry.markers` would resolve `*` to the
	// block-kind survivor and identify would never return ITALIC.
	var markers = [];
	var openKeys = Object.keys(registry.inlineMarkers);
	for(var i = 0; i < openKeys.length; i++) {
		markers.push(registry.inlineMarkers[openKeys[i]]);
	}
	markers.sort(function(a, b) { return b.open.length - a.open.length; });
	for(var j = 0; j < markers.length; j++) {
		if(matchText.indexOf(markers[j].open) === 0) {
			return markers[j];
		}
	}
	return null;
}

// Variable-length inline-pair parsing: the opening match captured a run
// of N `open` characters (flanked by non-open). Walk forward looking for
// the FIRST same-length closing run with the same flanking property —
// that delimits the body. Body is captured verbatim (open-variable
// implies body-raw semantics). CommonMark's single-space stripping is
// applied when the body has both leading and trailing space AND any
// non-whitespace content, so authors can wrap leading/trailing
// backticks: `` ` `not a closing tick `` (and similar).
function parseVariableInlinePair(parser, marker, match) {
	var matchText = match[0];
	var matchStart = match.index;
	var openLen = matchText.length;
	var openChar = marker.open;
	var source = parser.source;
	var bodyStart = matchStart + openLen;
	// Code spans (and other variable-length inline-pair markers) don't
	// cross blank-line block boundaries — without this cap, a lonely
	// unmatched backtick would silently extend until SOME later `\`run
	// happens to appear, swallowing entire paragraphs and code blocks.
	// Limit the close-search to the next blank line (or end of source).
	var blankLineRe = /\n[ \t]*\n/g;
	blankLineRe.lastIndex = bodyStart;
	var blankMatch = blankLineRe.exec(source);
	var paragraphEnd = blankMatch ? blankMatch.index : source.length;
	var closeStart = -1;
	var scanPos = bodyStart;
	while(scanPos < paragraphEnd) {
		var idx = source.indexOf(openChar, scanPos);
		if(idx === -1 || idx >= paragraphEnd) { break; }
		var runEnd = idx;
		while(runEnd < source.length && source.charAt(runEnd) === openChar) {
			runEnd++;
		}
		var runLen = runEnd - idx;
		// Same-length run? Then it's a candidate. The body-side flanking
		// (char at idx-1) is non-open by construction of this scan: we
		// started at bodyStart and advanced runEnd past full runs only,
		// so `source.charAt(idx-1)` is either bodyStart's prior char
		// (which is the LAST char of the opening run — also openChar —
		// not what we want) OR the char after a previous shorter run
		// (non-open). We DO need to handle the bodyStart-adjacent case.
		// Concrete: for `` ``hello`` ``, idx of first matching close is
		// at position 7 (the closing run start); char at idx-1 is 'o',
		// non-open. Good. For an EMPTY body `` `````` `` (3+3), the
		// scan starts at bodyStart=3, finds run at 3 (length 3),
		// charAt(2) is open — but only because the OPENING run abuts
		// the closing run with no body in between. Empty body is
		// legitimate; we just need to NOT reject this case.
		if(runLen === openLen && idx >= bodyStart) {
			closeStart = idx;
			break;
		}
		scanPos = runEnd;
	}
	if(closeStart === -1) {
		// No matching close — emit the opening run as plain text and
		// fall through. The user gets to see their backticks; better
		// than silently consuming them.
		parser.pos = matchStart + openLen;
		return [{type: "text", text: matchText}];
	}
	var bodyEnd = closeStart;
	var body = source.substring(bodyStart, bodyEnd);
	if(body.length >= 2 && body.charAt(0) === " " && body.charAt(body.length - 1) === " " && /\S/.test(body)) {
		body = body.substring(1, body.length - 1);
	}
	parser.pos = closeStart + openLen;
	var classList = [];
	if(marker.classes) {
		$tw.utils.each(marker.classes.split("."), function(c) {
			if(c) { classList.push(c); }
		});
	}
	classList.push("wltc");
	var attrs = {
		"class": {type: "string", value: classList.join(" ").trim()}
	};
	if(marker.attributes) {
		for(var k in marker.attributes) {
			if(k !== "class") {
				attrs[k] = toAttrNode(marker.attributes[k]);
			}
		}
	}
	var element = marker.element || "span";
	var node;
	if(element.charAt(0) === "$") {
		node = {type: element.substr(1), tag: element, attributes: attrs};
	} else {
		node = {type: "element", tag: element, attributes: attrs};
	}
	node.children = [{type: "text", text: body}];
	return [node];
}

// Linked-pair parsing: BODY between open and close, LINK between
// link-open and link-close, both ranges already validated by the
// combined-regex match. Body either parses as inline children (default)
// or becomes a plain-text attribute on the rendered element (when the
// marker sets `body-attribute`, used for `<img alt="...">`). LINK text
// is emitted on `link-attribute` (default `href`). Engine knows no
// markdown-specific semantics — fields drive everything.
function parseLinkedPair(parser, marker, match) {
	var matchText = match[0];
	var matchStart = match.index;
	var matchEnd = matchStart + matchText.length;
	parser.pos = matchStart + marker.open.length;

	var bodyText = "";
	var children = null;
	if(marker.bodyAttribute) {
		// Body is captured verbatim as a plain-text attribute. No inline
		// parsing — alt-text in CommonMark is plain string content.
		var closeIdx = parser.source.indexOf(marker.close, parser.pos);
		if(closeIdx === -1) {
			parser.pos = matchEnd;
			return [{type: "text", text: matchText}];
		}
		bodyText = parser.source.substring(parser.pos, closeIdx);
		parser.pos = closeIdx + marker.close.length;
	} else {
		// Body parses as an inline run; parseInlineRun advances pos past
		// the terminator (the close literal).
		var closeRe = new RegExp("(" + $tw.utils.escapeRegExp(marker.close) + ")", "mg");
		children = parser.parseInlineRun(closeRe, {eatTerminator: true});
	}

	// Past close; advance past link-open, capture link text, advance past
	// link-close. Indexes are guaranteed to be present (regex matched the
	// whole pattern) — the -1 branches are defensive belt-and-suspenders.
	parser.pos += marker.linkOpen.length;
	var linkEnd = parser.source.indexOf(marker.linkClose, parser.pos);
	if(linkEnd === -1) { linkEnd = matchEnd - marker.linkClose.length; }
	var rawLinkText = parser.source.substring(parser.pos, linkEnd);
	parser.pos = linkEnd + marker.linkClose.length;
	// Decode TW-md-plugin compat affordances: strip optional `<...>` wrap,
	// peel off trailing `"tooltip"`, and recognise `#`-prefix as an
	// explicit-internal hint. All three are no-ops when the marker hasn't
	// opted in — `linkText` then equals `rawLinkText`.
	var parsedLink = parseLinkSyntax(rawLinkText, marker);
	var linkText = parsedLink.target;

	var classList = [];
	if(marker.classes) {
		$tw.utils.each(marker.classes.split("."), function(c) {
			if(c) { classList.push(c); }
		});
	}
	classList.push("wltc");
	var attrs = {
		"class": {type: "string", value: classList.join(" ").trim()}
	};
	if(marker.attributes) {
		for(var k in marker.attributes) {
			if(k !== "class") {
				attrs[k] = toAttrNode(marker.attributes[k]);
			}
		}
	}
	// Body-attribute (e.g. tooltip on IMAGE) — only set when the user
	// actually provided a body. Applied FIRST so attr-X-from + the
	// `"tooltip"` parameter below can override it when something more
	// specific is available; otherwise the body fallback stays in effect.
	if(marker.bodyAttribute && bodyText !== "") {
		attrs[marker.bodyAttribute] = {type: "string", value: bodyText};
	}
	// Trailing `"tooltip"` parameter (TW md plugin compat). Overrides any
	// body-set value on the same attribute — user-supplied tooltip syntax
	// is the most explicit signal.
	if(marker.linkTooltipAttribute && parsedLink.tooltip != null) {
		attrs[marker.linkTooltipAttribute] = {type: "string", value: parsedLink.tooltip};
	}
	// `attr-X-from` fields fall back to the source tiddler's field when
	// the user didn't supply a value for the attribute (body / "tooltip"
	// param both win when present). Special rule for `alt`: when the
	// user-supplied alt is ≤2 words AND the source field is ≥3 words,
	// prefer the source — descriptive alt-text matters more for
	// accessibility than a short callsite label. For URLs, missing
	// tiddlers, or missing fields, we leave the user's value untouched.
	if(marker.attrFromFields) {
		var sourceTiddler = parser.wiki.getTiddler(linkText);
		if(sourceTiddler) {
			for(var attrName in marker.attrFromFields) {
				var sourceField = marker.attrFromFields[attrName];
				var fieldValue = sourceTiddler.fields[sourceField];
				if(fieldValue == null || fieldValue === "") { continue; }
				var userAttr = attrs[attrName];
				var useSource = !userAttr;
				if(!useSource && attrName === "alt" && userAttr.type === "string") {
					var userWords = countWords(userAttr.value);
					var fieldWords = countWords(fieldValue);
					if(userWords > 0 && userWords <= 2 && fieldWords >= 3) {
						useSource = true;
					}
				}
				if(useSource) {
					attrs[attrName] = {
						type: "indirect",
						textReference: linkText + "!!" + sourceField
					};
				}
			}
		}
	}
	// External routing: emit a plain `<a href target=_blank>` instead of
	// the configured element when EITHER
	// * the target is URL-shaped and the marker opted into auto-external
	//   (prettylink-style — TW's `$link` widget can't handle URLs in
	//   `to`, so we need this split), OR
	// * the marker requires `#` for internal (`link-hash-prefix: required`)
	//   AND no `#` was present (TW md plugin's strict "everything is a
	//   URL unless explicitly marked internal" semantics).
	// A `#`-prefixed target (parsedLink.isInternal) always suppresses
	// this branch — explicit-internal hint from the author wins.
	var hashRequired = marker.linkHashPrefix === "required";
	if(!parsedLink.isInternal && (hashRequired || (marker.autoExternal && isExternalLink(linkText)))) {
		attrs.href = {type: "string", value: linkText};
		attrs.target = {type: "string", value: "_blank"};
		attrs.rel = {type: "string", value: "noopener noreferrer"};
		var extNode = {
			type: "element",
			tag: "a",
			attributes: attrs
		};
		if(children) { extNode.children = children; }
		return [extNode];
	}
	attrs[marker.linkAttribute] = {type: "string", value: linkText};
	// `$`-prefixed elements are TW widget invocations (`$link`, `$image`,
	// ...) — emit the widget node shape (type=name without prefix, tag=
	// full `$name`) so the runtime widget engine picks them up. Mirrors
	// buildNode's handling for inline-pair markers.
	var element = marker.element || "a";
	var node;
	if(element.charAt(0) === "$") {
		node = {
			type: element.substr(1),
			tag: element,
			attributes: attrs
		};
	} else {
		node = {
			type: "element",
			tag: element,
			attributes: attrs
		};
	}
	if(children) { node.children = children; }
	return [node];
}

// Matches strings TW core considers external links. Use $tw.utils
// version when present; fall back to a same-shape regex for tests /
// out-of-tree contexts. Pattern matches scheme:rest (file, http, https,
// mailto, ftp, irc, news, data) or protocol-relative `//host`.
function isExternalLink(value) {
	if($tw && $tw.utils && typeof $tw.utils.isLinkExternal === "function") {
		return $tw.utils.isLinkExternal(value);
	}
	return /^(?:(?:file|http|https|mailto|ftp|irc|news|data):|\/\/)/i.test(value);
}

// Count whitespace-separated words in a string. Used by the alt-attribute
// smart-override rule: a 1-2-word user-supplied alt is replaced by a 3+
// word source-tiddler alt-text field. Trim first so leading/trailing
// whitespace doesn't bias the count.
function countWords(value) {
	if(typeof value !== "string") { return 0; }
	var trimmed = value.replace(/^\s+|\s+$/g, "");
	if(trimmed === "") { return 0; }
	return trimmed.split(/\s+/).length;
}

// Parse the captured-LINK content for the TW markdown plugin's extra
// syntax: trailing `"tooltip"`, angle-bracket wrapping `<...>` (with
// `\<` / `\>` escapes inside), and `#`-prefix to force the internal
// routing path. All three are gated by per-marker fields so a DSL
// author opts in to whichever ones match their syntax. Returns an
// object with the cleaned `target`, optional `tooltip` (or null), and
// `isInternal` flag (true when `#` was stripped, signalling that
// auto-external should be skipped even if the target happens to look
// URL-shaped).
function parseLinkSyntax(raw, marker) {
	var result = {target: raw, tooltip: null, isInternal: false};
	var s = raw.replace(/^[ \t]+|[ \t]+$/g, "");
	if(marker.linkTooltipAttribute) {
		var tipMatch = /[ \t]+"([^"\r\n]*)"$/.exec(s);
		if(tipMatch) {
			result.tooltip = tipMatch[1];
			s = s.substring(0, tipMatch.index);
		}
	}
	if(marker.linkAngleBrackets && s.length >= 2 && s.charAt(0) === "<" && s.charAt(s.length - 1) === ">") {
		s = s.substring(1, s.length - 1).replace(/\\([<>])/g, "$1");
	}
	if(marker.linkHashPrefix && s.charAt(0) === "#") {
		result.isInternal = true;
		s = s.substring(1);
		// Percent-decode AFTER `#`-strip: an internal `#`-prefixed target
		// names a tiddler title, and tiddler titles use literal spaces /
		// punctuation. URL-encoded forms (`%20`, `%29`, ...) need to be
		// decoded for `wiki.getTiddler(target)` to match. Malformed
		// escapes are left as-is so they don't blow up the parse.
		try {
			s = decodeURIComponent(s);
		} catch(e) {
			// keep `s` as-is on malformed escape
		}
	}
	result.target = s;
	return result;
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
		userClasses: classes,
		bodyRaw: marker.bodyRaw,
		// See marker-block.js for the rationale on propagating debug fields.
		debug: marker.debug || "",
		debugString: marker.debugString || ""
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
	if(config.bodyRaw) {
		// Literal-text body: capture everything between open and close
		// verbatim as a single text node, no recursive parsing. Used for
		// code spans, escape regions, raw-HTML quoting — any inline-pair
		// where the body must be preserved as-is.
		var closeIdx = parser.source.indexOf(config.close, parser.pos);
		if(closeIdx === -1) {
			// No close found — consume to end of source.
			closeIdx = parser.source.length;
		}
		var bodyText = parser.source.substring(parser.pos, closeIdx);
		parser.pos = closeIdx + config.close.length;
		return [{type: "text", text: bodyText}];
	}
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
