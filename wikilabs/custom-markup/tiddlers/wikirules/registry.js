/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/registry.js
type: application/javascript
module-type: utils

Custom-Markup marker registry. Reads marker tiddlers from the wiki, builds
combined regex per parse rule, exposes per-marker config lookup. Each parser
holds its own instance, populated during wikirule init().

\*/

"use strict";

var MARKER_TAG = "$:/tags/CustomMarkup/Marker";
var VOCAB_TAG = "$:/tags/CustomMarkup/Vocabulary";
var PAGE_TEMPLATE_TITLE = "$:/config/custom-markup/pragma/PageTemplate";

// Secure-by-default. Three categories:
//   - DENIED: replaced with the default wrapper element. No usable sandbox
//     semantics; the element itself is dropped.
//   - SANDBOXABLE: rendered, but `sandbox=""` is injected if the marker
//     author hasn't set a sandbox attribute. The sandbox neutralizes
//     script execution from `srcdoc` and external content alike.
//   - everything else: untouched.
// Markers opt out of all three rules with `allow-unsafe: yes` (or pragma
// form `_allow_unsafe=yes`).
var DENIED_ELEMENTS = ["object", "embed", "frame", "frameset"];
var SANDBOXABLE_ELEMENTS = ["iframe"];

// URL-bearing attributes scrubbed for `javascript:` scheme. TW already
// strips inline event-handler attributes via `excludeEventAttributes: true`
// in element.js, so we focus on the URL vectors that bypass that path.
var URL_ATTRS = ["src", "href", "xlink:href", "data", "action", "formaction"];
var JAVASCRIPT_URL_RE = /^\s*javascript:/i;

function isDeniedElement(el) {
	if(!el || typeof el !== "string") { return false; }
	return DENIED_ELEMENTS.indexOf(el.toLowerCase()) !== -1;
}

function isSandboxableElement(el) {
	if(!el || typeof el !== "string") { return false; }
	return SANDBOXABLE_ELEMENTS.indexOf(el.toLowerCase()) !== -1;
}

function hasSandboxAttr(attrs) {
	if(!attrs) { return false; }
	return Object.keys(attrs).some(function(k) { return k.toLowerCase() === "sandbox"; });
}

function scrubAttributes(attrs, element) {
	if(!attrs || typeof attrs !== "object") { attrs = {}; }
	var out = {};
	Object.keys(attrs).forEach(function(key) {
		var lk = key.toLowerCase();
		var val = attrs[key];
		if(URL_ATTRS.indexOf(lk) !== -1 && typeof val === "string" && JAVASCRIPT_URL_RE.test(val)) { return; }
		out[key] = val;
	});
	if(isSandboxableElement(element) && !hasSandboxAttr(out)) {
		out.sandbox = "";
	}
	return out;
}

var CmRegistry = function(wiki) {
	this.wiki = wiki;
	this.markers = Object.create(null);
	// `active` tracks which marker open literals are currently enabled
	// for this parser. The regex always contains EVERY known marker, but
	// only active ones produce element output (the parse function emits
	// plain text for inactive matches). This decoupling is what lets
	// pragmas (\importcustom) activate vocabularies after parser init,
	// without falling foul of TW's rule-pruning at instantiateRules time.
	this.active = Object.create(null);
	// Union of TW core wikirule names that each activated vocab declared
	// in its `disable-core-rules` field. Applied via parser.amendRules so
	// colliding core rules (heading vs `!action`, list vs `*x` line-start,
	// prettylink vs `[[note]]`, ...) stop firing for the tiddler.
	this.disabledCoreRules = Object.create(null);
	this.blockRegex = null;
	this.inlineRegex = null;
	this.dirty = true;
};

CmRegistry.prototype.addFromFilter = function(filterExpr) {
	var self = this;
	var titles = this.wiki.filterTiddlers(filterExpr);
	$tw.utils.each(titles, function(title) {
		var config = self.parseMarkerTiddler(title);
		if(config && config.open) {
			self.markers[config.open] = config;
		}
	});
	this.dirty = true;
};

// Load every marker tiddler in the wiki into the registry. The regex will
// then cover all known markers; whether they actually fire is decided by
// the `active` set (see activate()).
CmRegistry.prototype.loadAllMarkers = function() {
	this.addFromFilter("[all[shadows+tiddlers]tag[" + MARKER_TAG + "]]");
};

// Activate a vocabulary by name. Adds the open literal of every marker
// tagged with that vocabulary's marker-tag to the active set, AND
// re-writes the marker config for each open with the activated vocab's
// version. The re-write resolves cross-vocab collisions (two vocabs
// shipping a marker with the same `open`) by letting the activated vocab
// win. When multiple vocabs are activated, the LAST one wins.
CmRegistry.prototype.activate = function(name) {
	var titles = this.wiki.filterTiddlers(
		"[all[shadows+tiddlers]tag[" + VOCAB_TAG + "]field:caption[" + name + "]]"
	);
	if(!titles || !titles.length) { return false; }
	var meta = this.wiki.getTiddler(titles[0]);
	if(!meta) { return false; }
	var markerTag = meta.fields["marker-tag"];
	if(!markerTag) { return false; }
	var markerTitles = this.wiki.filterTiddlers("[all[shadows+tiddlers]tag[" + markerTag + "]]");
	var self = this;
	markerTitles.forEach(function(title) {
		var config = self.parseMarkerTiddler(title);
		if(config && config.open) {
			self.markers[config.open] = config;
			self.active[config.open] = true;
		}
	});
	// Union-merge the vocab's declared core-rule exclusions. Whitespace
	// separated list of TW core wikirule names (e.g. `heading list
	// prettylink`). Empty / absent field is a no-op.
	var disabled = meta.fields["disable-core-rules"];
	if(typeof disabled === "string" && disabled.length > 0) {
		disabled.split(/\s+/).forEach(function(rule) {
			if(rule) { self.disabledCoreRules[rule] = true; }
		});
	}
	self.dirty = true;
	return true;
};

CmRegistry.prototype.isActive = function(open) {
	return !!this.active[open];
};

// Apply the union of declared core-rule exclusions to the parser.
//
// Timing constraint: cannot call parser.amendRules synchronously from a
// rule's init() — during the WikiParser constructor, init() runs while
// instantiateRules is mid-flight assigning this.blockRules /
// this.inlineRules / this.pragmaRules. amendRules walks all three arrays
// and crashes on the not-yet-assigned ones (TypeError → RSOD).
//
// Defer via a one-shot wrap of parser.parsePragmas (called immediately
// after instantiateRules completes, so all rule arrays are populated and
// safe to mutate). The wrap also runs BEFORE pragma rules fire, so any
// user `\rules except|only ...` pragma in the source can still amend
// further on top of the vocab's baseline.
CmRegistry.prototype.applyAmendRules = function(parser) {
	var names = Object.keys(this.disabledCoreRules);
	if(names.length === 0) { return; }
	if(parser._cmAmendScheduled) { return; }
	parser._cmAmendScheduled = true;
	var originalParsePragmas = parser.parsePragmas;
	parser.parsePragmas = function() {
		parser.amendRules("except", names);
		parser.parsePragmas = originalParsePragmas;
		return originalParsePragmas.apply(this, arguments);
	};
};

// Parse a content-type string like `text/vnd.tiddlywiki;vocab=A,B,C` and
// activate the listed vocabularies. Without a `;vocab=` parameter, falls
// back to `Default`.
CmRegistry.prototype.activateFromTypeField = function(typeStr) {
	var match = /;\s*vocab\s*=\s*([^;]+)/.exec(typeStr || "");
	if(!match) {
		this.activate("Default");
		return;
	}
	var names = match[1].split(",");
	var self = this;
	names.forEach(function(raw) {
		var name = raw.trim();
		if(name) { self.activate(name); }
	});
};

CmRegistry.prototype.parseMarkerTiddler = function(title) {
	var t = this.wiki.getTiddler(title);
	if(!t) { return null; }
	var f = t.fields;
	if(!f.open || !f.kind) { return null; }
	var attrs = {};
	if(f.attributes) {
		try {
			attrs = (typeof f.attributes === "string")
				? JSON.parse(f.attributes)
				: f.attributes;
		} catch(e) {
			attrs = {};
		}
	}
	var allowUnsafe = f["allow-unsafe"] === "yes";
	var element = f.element || "";
	if(!allowUnsafe) {
		if(isDeniedElement(element)) { element = ""; }
		attrs = scrubAttributes(attrs, element);
	}
	return {
		title: title,
		open: f.open,
		close: f.close || "",
		kind: f.kind,
		mode: f.mode || (f.kind === "inline-pair" ? "inline" : "block"),
		element: element,
		endString: f["end-string"] || "",
		classes: f.classes || "",
		attributes: attrs,
		srcName: f["src-name"] || "src",
		allowSymbol: f["allow-symbol"] !== "no",
		allowClasses: f["allow-classes"] === "yes",
		allowUnsafe: allowUnsafe,
		maxLevel: parseInt(f["max-level"] || "4", 10) || 4,
		// paragraph-marker: "yes" opts into paragraph terminator semantics
		// (blank-line, no nested-p body parse) independently of `element`.
		paragraphMarker: f["paragraph-marker"],
		// emit-open: "yes" prepends the open literal as a text node to the
		// rendered children. Useful for word markers whose keyword IS the
		// content (Fountain transitions: `CUT TO:`, `FADE IN:`, ...).
		// Default behaviour consumes the open literal; this opts back into
		// emitting it.
		emitOpen: f["emit-open"],
		// legacy-kind: friendly name from the v0.x plugin (tick, degree, angle,
		// approx, pilcrow, single, corner, braille, slash). Lets the legacy
		// `\custom degree=foo` pragma resolve to the right marker.
		legacyKind: f["legacy-kind"] || "",
		caption: f.caption || title,
		description: f.description || "",
		symbols: Object.create(null)
	};
};

CmRegistry.prototype.registerSymbol = function(openLiteral, symbol, config) {
	var marker = this.markers[openLiteral];
	if(!marker) { return false; }
	marker.symbols[symbol] = config;
	return true;
};

// Bridge a legacy `\custom <kind>=<symbol> ...` pragma into the registry.
// `kindOrOpen` may be the legacy kind name (tick, degree, angle, ...) or
// the marker's open literal. `legacyConfig` is the raw configTickText shape
// produced by custom.js (and by harvest paths in import-custom.js).
CmRegistry.prototype.bridgeLegacyConfig = function(kindOrOpen, legacyConfig) {
	var marker = this.findByOpenOrLegacyKind(kindOrOpen);
	if(!marker) { return false; }
	var rawSymbol = legacyConfig.symbol;
	// TW parses bare-kind pragmas (`\custom angle _element=td`) as
	// {name:"angle", value:"true"}. Treat both `undefined` and `"true"`
	// as the empty-key sentinel so resolveConfig picks them up.
	var symbolKey = (rawSymbol === undefined || rawSymbol === "true") ? "" : rawSymbol;
	var normalized = normalizeLegacyConfig(legacyConfig);
	marker.symbols[symbolKey] = normalized;
	// Author-intent activation: a `\custom <kind>=...` pragma implies the
	// author wants the marker active in this tiddler. Opt out with
	// `_activate=no` (e.g. for pragmas that only exist to be referenced
	// via `_useGlobal` from other tiddlers).
	if(normalized.activate !== "no") {
		this.active[marker.open] = true;
	}
	return true;
};

function normalizeLegacyConfig(legacy) {
	var out = {};
	var attributes = {};
	for(var key in legacy) {
		switch(key) {
			case "symbol":
				break;
			case "_debugString": out.debugString = legacy[key]; break;
			case "_element": out.element = legacy[key]; break;
			case "_classes":
				// Legacy `_classes="b-y"` is dot-less. Normalize so the
				// registry's dot-separated chain stays well-formed when
				// concatenated.
				var c = legacy[key] || "";
				if(c && c.charAt(0) !== ".") { c = "." + c; }
				out.classes = c;
				break;
			case "_endString": out.endString = legacy[key]; break;
			case "_mode": out.mode = legacy[key]; break;
			case "_srcName": out.srcName = legacy[key]; break;
			case "_use": out.use = legacy[key]; break;
			case "_useGlobal": out.useGlobal = legacy[key]; break;
			case "_activate": out.activate = legacy[key]; break;
			case "_allow_unsafe": out.allowUnsafe = legacy[key]; break;
			case "_debug": out.debug = legacy[key]; break;
			case "_params": out.params = legacy[key]; break;
			default:
				if(key.charAt(0) !== "_") {
					var v = legacy[key];
					if(typeof v === "string") {
						attributes[key] = v;
					} else if(v && typeof v === "object") {
						// Preserve macro / indirect / filtered tokens so
						// `<<qualify>>`, `{{!!field}}`, etc. survive.
						attributes[key] = v;
					}
				}
		}
	}
	// Secure-by-default: deny iframe-family unsafeoutright (frame, frameset,
	// object, embed) and force a `sandbox=""` on iframe unless the pragma
	// explicitly opts out with `_allow_unsafe=yes`. Strip `javascript:` URL
	// values from URL-bearing attributes either way (the opt-out covers
	// elements, not URL schemes).
	if(out.allowUnsafe !== "yes") {
		if(isDeniedElement(out.element)) { delete out.element; }
		attributes = scrubAttributes(attributes, out.element);
	}
	if(Object.keys(attributes).length > 0) {
		out.attributes = attributes;
	}
	return out;
}

// Attach `other`'s per-marker symbols as `globalSymbols` on the matching
// markers in this registry. Kept SEPARATE from `symbols` so:
//   - `_use=<sym>` resolves against local symbols only (v0.x semantics)
//   - `_useGlobal=<sym>` resolves explicitly against globals
//   - a bare `°clip` with no local definition falls back through the
//     resolveConfig chain to globalSymbols.
CmRegistry.prototype.mergeSymbolsFrom = function(other) {
	var self = this;
	Object.keys(other.markers).forEach(function(open) {
		var oM = other.markers[open];
		var lM = self.markers[open];
		if(!lM || !oM.symbols) { return; }
		lM.globalSymbols = oM.symbols;
	});
};

// Pull bridged symbols from `$:/config/custom-markup/pragma/PageTemplate`
// into this registry. PageTemplate is conventionally
// `\importcustom [tag[$:/tags/Pragma]]`, so this captures wiki-wide
// pragmas (e.g. the `°clip` / `°example` macro shortcuts shipped in
// `.example-macro` and `global-pragma-definition`).
//
// Caching: `wiki.parseTiddler` memoizes its result via TW core's per-
// tiddler cache (`getCacheForTiddler`). The cached sub-parser is
// invalidated only when PageTemplate itself changes — UI state churn
// (popups, folded, drafts) leaves it warm. This is the same pattern
// the v0.x plugin used (see Phase-1 handoff Chunk 1: "replaced cache
// access with `parser.wiki.parseTiddler(template).configTickText`").
//
// Recursion guard: parseTiddler's cache initializer builds a sub-parser
// whose marker-rule init re-enters loadGlobalPragmas; the
// `_loadingGlobals` static flag short-circuits that recursive call.
CmRegistry.prototype.loadGlobalPragmas = function() {
	if(CmRegistry._loadingGlobals) { return; }
	CmRegistry._loadingGlobals = true;
	try {
		var subParser = this.wiki.parseTiddler(PAGE_TEMPLATE_TITLE);
		if(subParser && subParser.cmRegistry) {
			this.mergeSymbolsFrom(subParser.cmRegistry);
		}
	} finally {
		CmRegistry._loadingGlobals = false;
	}
};

CmRegistry.prototype.findByOpen = function(literal) {
	return this.markers[literal] || null;
};

// Look up a marker by its open literal, or by its legacy-kind name (tick,
// degree, etc.). Used by the \custom pragma so legacy `degree=foo` syntax
// keeps resolving after the kind-name layer was retired.
CmRegistry.prototype.findByOpenOrLegacyKind = function(name) {
	if(this.markers[name]) { return this.markers[name]; }
	for(var key in this.markers) {
		if(this.markers[key].legacyKind === name) {
			return this.markers[key];
		}
	}
	return null;
};

CmRegistry.prototype.list = function(predicate) {
	var out = [];
	for(var key in this.markers) {
		if(!predicate || predicate(this.markers[key])) {
			out.push(this.markers[key]);
		}
	}
	return out;
};

CmRegistry.prototype.getBlockRegex = function() {
	if(this.dirty || !this.blockRegex) { this.rebuildRegexes(); }
	return this.blockRegex;
};

CmRegistry.prototype.getInlineRegex = function() {
	if(this.dirty || !this.inlineRegex) { this.rebuildRegexes(); }
	return this.inlineRegex;
};

CmRegistry.prototype.rebuildRegexes = function() {
	var blockMarkers = this.list(function(m) {
		return m.kind === "glyph" || m.kind === "glyph-level" || m.kind === "word";
	});
	var inlineMarkers = this.list(function(m) {
		return m.kind === "inline-pair";
	});

	// Word arms longest-first so longer literals preempt shorter prefixes
	blockMarkers.sort(function(a, b) {
		if(a.kind === "word" && b.kind === "word") {
			return b.open.length - a.open.length;
		}
		return 0;
	});

	var blockArms = [];
	$tw.utils.each(blockMarkers, function(m) {
		blockArms.push(buildBlockArm(m));
	});
	var inlineArms = [];
	$tw.utils.each(inlineMarkers, function(m) {
		inlineArms.push(buildInlineArm(m));
	});

	this.blockRegex = blockArms.length ? new RegExp(blockArms.join("|"), "mg") : null;
	this.inlineRegex = inlineArms.length ? new RegExp(inlineArms.join("|"), "mg") : null;
	this.dirty = false;
};

function buildBlockArm(m) {
	var open = $tw.utils.escapeRegExp(m.open);
	// Strict-class rule kicks in when allow-symbol is off (e.g. dot marker)
	// to keep prose like ".NET" / ".com" from matching.
	var classChain = m.allowSymbol
		? String.raw`(?:\.[^.\r\n\s:]+)*`
		: String.raw`(?:\.[a-z][\w-]*)*`;
	var symbol = m.allowSymbol ? String.raw`(?:[^.:\r\n\s]+)?` : "";
	// Positional quoted-argument chain (`:"a":"b":"c"`), feeds the
	// pragma's `_params` positional overrides at fire time.
	var quotedArgs = String.raw`(?::"[^"]*")*`;
	var bound = String.raw`(?=[ \t\r\n]|$)`;

	switch(m.kind) {
		case "glyph":
			return `(?:${open}${symbol}${classChain}${quotedArgs}${bound})`;
		case "glyph-level":
			var lvl = `(?:${open}){1,${m.maxLevel}}`;
			return `(?:${lvl}${symbol}${classChain}${quotedArgs}${bound})`;
		case "word":
			var wordCls = m.allowClasses ? classChain : "";
			return `(?:${open}${wordCls}${bound})`;
		default:
			return `(?:${open}${bound})`;
	}
}

function buildInlineArm(m) {
	var open = $tw.utils.escapeRegExp(m.open);
	// Symbol/class char-class must exclude the first char of the close marker,
	// otherwise text like `{!body!}` swallows the `!}` close into the symbol.
	var closeFirst = m.close ? $tw.utils.escapeRegExp(m.close.charAt(0)) : "";
	var quotedArgs = String.raw`(?::"[^"]*")*`;
	return String.raw`(?:${open}(?:[^.:\r\n\s${closeFirst}]+)?(?:\.[^.\r\n\s:${closeFirst}]+)*${quotedArgs})`;
}

exports.CmRegistry = CmRegistry;
exports.CM_MARKER_TAG = MARKER_TAG;
exports.CM_VOCAB_TAG = VOCAB_TAG;
