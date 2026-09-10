/*\
title: $:/core/modules/commands/inspect/calls.js
type: application/javascript
module-type: library

Where a macro, procedure, function or widget is called or defined in wikitext,
found through TiddlyWiki's own parsers.

Protocol-neutral on purpose: it answers in offsets into the text it was given,
never in LSP positions or MCP output, so --lsp and --mcp can each build on it
without depending on the other.

\*/

"use strict";

var WIKITEXT_TYPE = "text/vnd.tiddlywiki";

// Widget attributes, and named macro arguments, whose string value is a filter.
var FILTER_ATTRIBUTE = /^\$?(?:sub)?filter$/;

var CACHE_KEY = "tw-mcp-calls";

// Every call and definition in a wikitext, as { calls, definitions }. Each site
// is { name, start, end } around the NAME, plus the call's form or the
// definition's kind.
function sitesIn(text) {
	var sites = { calls: [], definitions: [] };
	text = text || "";
	collect($tw.wiki.parseText(WIKITEXT_TYPE, text).tree, text, 0, sites);
	return sites;
}

// The sites of one tiddler's text, kept in TiddlyWiki's own per-tiddler cache,
// which is dropped whenever that tiddler changes.
function sitesOfTiddler(title) {
	var tiddler = $tw.wiki.getTiddler(title);
	if(!tiddler || (tiddler.fields.type || WIKITEXT_TYPE) !== WIKITEXT_TYPE) {
		return { calls: [], definitions: [] };
	}
	return $tw.wiki.getCacheForTiddler(title, CACHE_KEY, function() {
		return sitesIn(tiddler.fields.text);
	});
}

// base is where text starts inside the text sitesIn was given, which differs
// only for a definition body, parsed on its own.
function collect(nodes, text, base, sites) {
	for(var i = 0; i < (nodes || []).length; i++) {
		visit(nodes[i], text, base, sites);
		collect(nodes[i].children, text, base, sites);
	}
}

function visit(node, text, base, sites) {
	var attributes = node.attributes || {};
	scanAttributes(attributes, text, base, sites);
	if(node.start === undefined) {
		return;
	}
	var kind = definitionKind(node);
	if(kind) {
		addDefinition(node, kind, text, base, sites);
		return;
	}
	if(node.type === "transclude" && attributes.$variable) {
		if(node.tag === "$transclude") {
			addFromAttribute(attributes.$variable, "transclude", text, base, sites);
		} else if(attributes.$variable.type === "string") {
			// <<name ...>> records no range for its name, only for the call.
			addName(attributes.$variable.value, "macro", text.indexOf(attributes.$variable.value, node.start), base, sites);
		}
	}
	if(node.type === "macrocall" && attributes.$name) {
		addFromAttribute(attributes.$name, "macrocall", text, base, sites);
	}
	// Covers a \widget call such as <$my.widget>, whose name is its tag.
	if(node.tag && node.tag.charAt(0) === "$") {
		addName(node.tag, "widget", node.start + 1, base, sites);
	}
}

function scanAttributes(attributes, text, base, sites) {
	for(var key in attributes) {
		var attribute = attributes[key];
		if(attribute.type === "macro" && attribute.value) {
			collect([attribute.value], text, base, sites);
		} else if(attribute.type === "filtered") {
			scanFilterAt(attribute.filter, attribute, text, base, sites);
		} else if(attribute.type === "string" && FILTER_ATTRIBUTE.test(key)) {
			scanFilterAt(attribute.value, attribute, text, base, sites);
		}
	}
}

// An attribute's range covers its name and quotes too, so the value is found
// inside it, from the end so a value equal to the attribute name still lands.
function addFromAttribute(attribute, form, text, base, sites) {
	if(attribute.type !== "string" || attribute.start === undefined) {
		return;
	}
	var at = text.slice(attribute.start, attribute.end).lastIndexOf(attribute.value);
	addName(attribute.value, form, at < 0 ? -1 : attribute.start + at, base, sites);
}

// A "$" after the first character is a \define placeholder ($param$ or
// $(variable)$), a name only known once the macro is expanded.
function addName(name, form, at, base, sites) {
	if(!name || at < 0 || name.indexOf("$", 1) !== -1) {
		return;
	}
	sites.calls.push({ name: name, form: form, start: base + at, end: base + at + name.length });
}

// --- Definitions ---

function definitionKind(node) {
	if(node.type !== "set") {
		return null;
	}
	if(node.isWidgetDefinition) {
		return "widget";
	}
	if(node.isFunctionDefinition) {
		return "function";
	}
	if(node.isProcedureDefinition) {
		return "procedure";
	}
	return node.isMacroDefinition ? "macro" : null;
}

// Neither the name nor the body carries offsets, so both are located inside the
// pragma's own source range.
function addDefinition(node, kind, text, base, sites) {
	var slice = text.slice(node.start, node.end),
		name = node.attributes.name ? node.attributes.name.value : "",
		keyword = /^\\\w+\s+/.exec(slice);
	if(name && keyword && slice.substr(keyword[0].length, name.length) === name) {
		var nameStart = base + node.start + keyword[0].length;
		sites.definitions.push({ name: name, kind: kind, start: nameStart, end: nameStart + name.length });
	}
	var body = definitionBody(node, text);
	if(!body) {
		return;
	}
	if(kind === "function") {
		scanFilter(body.text, base + body.start, sites);
	} else {
		collect($tw.wiki.parseText(WIKITEXT_TYPE, body.text).tree, body.text, base + body.start, sites);
	}
}

// A definition's body and where it starts in text, or null. The body is a plain
// string that TiddlyWiki does not parse with the tiddler.
function definitionBody(node, text) {
	var kind = definitionKind(node);
	if(!kind || node.start === undefined) {
		return null;
	}
	var body = node.attributes.value ? node.attributes.value.value : "",
		at = body ? bodyOffset(text.slice(node.start, node.end), body) : -1;
	return at < 0 ? null : { kind: kind, text: body, start: node.start + at };
}

// The body ends where the definition does: at a multi-line \end, else at the
// end of the line. Searching backwards from there keeps a short body from
// matching inside the header or inside "\end" itself.
function bodyOffset(slice, body) {
	var terminator = /\r?\n[^\S\n\r]*\\end[^\n]*\s*$/.exec(slice),
		limit = terminator ? terminator.index : slice.length;
	return slice.lastIndexOf(body, limit - body.length);
}

// --- Filters ---

function scanFilterAt(filter, attribute, text, base, sites) {
	if(!filter || attribute.start === undefined) {
		return;
	}
	var at = text.slice(attribute.start, attribute.end).lastIndexOf(filter);
	if(at >= 0) {
		scanFilter(filter, base + attribute.start + at, sites);
	}
}

// parseFilter knows what each operand is but not where it sits, so every
// operand is found again in order, moving a cursor forward so a name inside an
// earlier literal operand is never mistaken for a later call.
function scanFilter(filter, base, sites) {
	var operations = parseFilter(filter),
		cursor = 0;
	(operations || []).forEach(function(operation) {
		(operation.operators || []).forEach(function(operator) {
			// A dotted operator name invokes the function of that name.
			if(operator.operator.indexOf(".") !== -1) {
				var named = filter.indexOf(operator.operator, cursor);
				if(named >= 0) {
					addName(operator.operator, "filter", named, base, sites);
					cursor = named + operator.operator.length;
				}
			}
			(operator.operands || []).forEach(function(operand, index) {
				var open = operand.variable ? "<" : (operand.multiValuedVariable ? "(" : (operand.indirect ? "{" : "[")),
					at = filter.indexOf(open + operand.text, cursor),
					name = null;
				if(at < 0) {
					return;
				}
				cursor = at + 1 + operand.text.length;
				if(operand.variable || operand.multiValuedVariable) {
					name = $tw.utils.parseFilterVariable(operand.text).name;
				} else if(operator.operator === "function" && index === 0 && !operand.indirect) {
					name = operand.text;
				}
				if(name) {
					addName(name, "filter", at + 1 + operand.text.indexOf(name), base, sites);
				}
			});
		});
	});
}

// compileFilter caches a filter only when it parses (core filters.js), which is
// the one test for a malformed filter that does not throw.
function parseFilter(filter) {
	$tw.wiki.compileFilter(filter);
	return $tw.wiki.filterCache && $tw.wiki.filterCache[filter] !== undefined ? $tw.wiki.parseFilter(filter) : null;
}

exports.sitesIn = sitesIn;
exports.sitesOfTiddler = sitesOfTiddler;
exports.definitionBody = definitionBody;
