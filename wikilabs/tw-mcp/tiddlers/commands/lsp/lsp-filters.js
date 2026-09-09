/*\
title: $:/core/modules/commands/inspect/lsp/lsp-filters.js
type: application/javascript
module-type: library

Hovering a filter expression: run it against the live wiki and report what it
currently resolves to.

Filters are located through the PARSER, which is why <$list filter="...">, a
multi-line filter and a \function body all work without this file knowing their
syntax. The hand-scanner below is the fallback for the one case the parser
cannot help with: a filter still being typed produces no node at all.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

// Titles listed in one hover. A filter over a large wiki would otherwise render
// its whole result set into a popup.
var MAX_HOVER_TITLES = 50;

var FILTER_ERROR_TITLE = "$:/language/Error/Filter";

// --- Locating filters through the parser ---

// Every filter the parser can locate, in offsets relative to the body.
function filterSites(tree, body) {
	var sites = [];
	source.eachNode(tree, function(node) {
		var attributes = node.attributes || {},
			filter = attributes.filter;
		if(filter && filter.type === "string" && filter.start !== undefined) {
			sites.push({ filter: filter.value, start: filter.start, end: filter.end });
			return;
		}
		// A \function body IS a filter, where a \procedure body is wikitext, and
		// both parse to a set node. The value attribute carries no offsets, so
		// the body is located inside the pragma's own source range.
		if(node.isFunctionDefinition && attributes.value && node.start !== undefined) {
			var value = attributes.value.value,
				at = body.slice(node.start, node.end).lastIndexOf(value);
			if(at >= 0) {
				sites.push({ filter: value, start: node.start + at, end: node.start + at + value.length });
			}
		}
	});
	return sites;
}

// The smallest site containing the cursor, so an inner filter wins over the
// widget that encloses it.
function innermostSite(sites, offset) {
	var best = null;
	for(var i = 0; i < sites.length; i++) {
		var site = sites[i];
		if(offset >= site.start && offset <= site.end) {
			if(!best || (site.end - site.start) < (best.end - best.start)) {
				best = site;
			}
		}
	}
	return best;
}

// --- The fallback, for a filter that does not parse yet ---

// A filter is written in two places on a line: a filtered transclusion, and a
// filter= or filter: value. Both may be unfinished, because the cursor is
// usually still inside one.
function filterContext(lineText, character) {
	return filterInBraces(lineText, character) || filterInAttribute(lineText, character);
}

function filterInBraces(lineText, character) {
	var open = lineText.lastIndexOf("{{{", character);
	if(open < 0) {
		return null;
	}
	var close = lineText.indexOf("}}}", open + 3),
		start = open + 3,
		end = close < 0 ? lineText.length : close;
	if(character < start || character > end) {
		return null;
	}
	return { text: lineText.slice(start, end), start: start, end: end };
}

function filterInAttribute(lineText, character) {
	// Backtick included because 5.3 attribute values may use it.
	var pattern = /(?:filter|subfilter)\s*[=:]\s*(["'`])/g,
		match;
	while((match = pattern.exec(lineText)) !== null) {
		var start = match.index + match[0].length,
			close = lineText.indexOf(match[1], start),
			end = close < 0 ? lineText.length : close;
		if(character >= start && character <= end) {
			return { text: lineText.slice(start, end), start: start, end: end };
		}
	}
	return null;
}

// --- Running and describing ---

// A filter still being typed is the normal state under a cursor, and it must
// not be reported as one that legitimately matches nothing.
function bracketsBalanced(filterString) {
	var depth = 0;
	for(var i = 0; i < filterString.length; i++) {
		var ch = filterString.charAt(i);
		if(ch === "[") {
			depth++;
		} else if(ch === "]") {
			depth--;
			if(depth < 0) {
				return false;
			}
		}
	}
	return depth === 0;
}

// compileFilter does not throw on a malformed filter: it returns a function
// whose single result is the error message. Told apart from a real tiddler of
// that title by asking the wiki whether one exists.
function runFilter(filterString) {
	var errorTiddler = $tw.wiki.getTiddler(FILTER_ERROR_TITLE),
		prefix = ((errorTiddler && errorTiddler.fields.text) || "Filter error") + ": ",
		results = $tw.wiki.filterTiddlers(filterString);
	if(results.length === 1 && results[0].startsWith(prefix) && !$tw.wiki.tiddlerExists(results[0])) {
		return { error: results[0].slice(prefix.length) };
	}
	return { titles: results };
}

function describeFilter(filterString) {
	var trimmed = filterString.trim();
	if(!trimmed) {
		return "Empty filter.";
	}
	var head = "```\n" + trimmed + "\n```\n\n";
	if(!bracketsBalanced(trimmed)) {
		return head + "Unfinished filter (unbalanced brackets), so it has not been run.";
	}
	var outcome = runFilter(trimmed);
	if(outcome.error) {
		return head + "**Filter error:** " + outcome.error;
	}
	var titles = outcome.titles;
	if(!titles.length) {
		return head + "Matches nothing.";
	}
	var shown = titles.slice(0, MAX_HOVER_TITLES),
		body = head + "**" + titles.length + (titles.length === 1 ? " tiddler**\n\n" : " tiddlers**\n\n");
	for(var i = 0; i < shown.length; i++) {
		body += "* " + shown[i] + "\n";
	}
	if(titles.length > shown.length) {
		body += "\n... and " + (titles.length - shown.length) + " more.";
	}
	return body;
}

function hover(uri, text, position) {
	var body = source.bodyOf(uri, text);
	if(position.line < body.firstLine) {
		return null;
	}
	var cursor = source.offsetAt(body.starts, position) - body.offset;
	var site = innermostSite(filterSites(source.parseBody(body.text), body.text), cursor);
	if(site) {
		return {
			contents: { kind: "markdown", value: describeFilter(site.filter) },
			range: {
				start: source.positionAt(body.starts, body.offset + site.start),
				end: source.positionAt(body.starts, body.offset + site.end)
			}
		};
	}
	// A filter still being typed produces no node at all, so the parser cannot
	// see it. That is exactly when a reader most wants to know it is unfinished,
	// so the hand-scanner still covers the line under the cursor.
	var context = filterContext(body.lines[position.line] || "", position.character);
	if(!context) {
		return null;
	}
	return {
		contents: { kind: "markdown", value: describeFilter(context.text) },
		range: {
			start: { line: position.line, character: context.start },
			end: { line: position.line, character: context.end }
		}
	};
}

exports.hover = hover;
exports.filterContext = filterContext;
exports.bracketsBalanced = bracketsBalanced;
