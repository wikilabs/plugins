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

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js");

// Titles listed in one hover. A filter over a large wiki would otherwise render
// its whole result set into a popup.
var MAX_HOVER_TITLES = 50;

var FILTER_ERROR_TITLE = "$:/language/Error/Filter";

// A rendered body can be a whole page; a hover is not the place for it.
var MAX_RENDER_CHARS = 600;

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
		if(offset >= site.start && offset < site.end) {
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

// --- The last resort: a line that is nothing but a filter ---

// A bare [tag[X]] carries no syntax saying it is a filter, so it is recognised
// by shape instead: the whole line, trimmed, opens with "[" and closes with "]"
// and nothing else is on it. That covers a filter inside a documentation code
// block and a filter-valued system tiddler such as $:/config/FileSystemPaths,
// where the text IS a filter with no wikitext around it.
function bareFilterOnLine(lineText, character) {
	var trimmed = lineText.trim();
	if(trimmed.length < 2 || trimmed.charAt(0) !== "[" || trimmed.charAt(trimmed.length - 1) !== "]") {
		return null;
	}
	var start = lineText.indexOf(trimmed),
		end = start + trimmed.length;
	if(character < start || character > end) {
		return null;
	}
	return { text: trimmed, start: start, end: end };
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
function runFilter(filterString, context) {
	var errorTiddler = $tw.wiki.getTiddler(FILTER_ERROR_TITLE),
		prefix = ((errorTiddler && errorTiddler.fields.text) || "Filter error") + ": ",
		results = $tw.wiki.filterTiddlers(filterString, context || undefined);
	if(results.length === 1 && results[0].startsWith(prefix) && !$tw.wiki.tiddlerExists(results[0])) {
		return { error: results[0].slice(prefix.length) };
	}
	return { titles: results };
}

// Markdown link syntax is fragile about characters a real path holds. A ")" in
// the URL ends the link early, and a filename with parentheses is ordinary,
// while encodeURI leaves both alone. Brackets in the text end it too.
function markdownLink(text, uri) {
	return "[" + text.replace(/[[\]]/g, "\\$&") + "](" + uri.replace(/[()]/g, function(ch) {
		return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
	}) + ")";
}

// A title in the hover, linked to its own file so the reader can open it. A
// shadow tiddler has no file, so it stays plain text rather than becoming a
// link that goes nowhere.
function titleLink(title) {
	var uri = source.uriOfTitle(title);
	return uri ? markdownLink(title, uri) : title;
}

function describeFilter(filterString, context) {
	var trimmed = filterString.trim();
	if(!trimmed) {
		return "Empty filter.";
	}
	var head = "```\n" + trimmed + "\n```\n\n";
	if(!bracketsBalanced(trimmed)) {
		return head + "Unfinished filter (unbalanced brackets), so it has not been run.";
	}
	var outcome = runFilter(trimmed, context);
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
		body += "* " + titleLink(shown[i]) + "\n";
	}
	if(titles.length > shown.length) {
		body += "\n... and " + (titles.length - shown.length) + " more.";
	}
	return body;
}

// A call is described whole, arguments and filter results together, so it wins
// over the filter argument nested inside it. Hovering a filter attribute of an
// ordinary widget still reports just the filter, because that is no call.
function describeCall(site, bodyText, context) {
	var definition = macros.findDefinition(site.name, bodyText),
		head = "```\n" + site.name + "\n```\n\n";
	if(!definition) {
		return head + "**Not defined.** No macro, procedure or function of that name is in scope.";
	}
	var where = definition.title === null
			? (definition.kind === "javascript" ? "a JavaScript macro" : "defined in this tiddler")
			: "defined in " + definitionLink(definition.title),
		body = "**" + definition.kind + "** `" + site.name + "`, " + where + "\n\n",
		bound = macros.bindArguments(definition.params, site.args);
	if(!bound.length) {
		body += "Takes no parameters.\n";
	} else {
		// Markdown, not wikitext: hover contents are declared as markdown, and a
		// markdown table is nothing without its header separator row.
		body += "| Parameter | Value | Given as |\n| --- | --- | --- |\n";
		for(var i = 0; i < bound.length; i++) {
			body += "| " + cell(bound[i].name) + " | `" + cell(bound[i].value) + "` | " + bound[i].origin + " |\n";
		}
	}
	// A parameter holding a filter is the one a reader wants evaluated, and it
	// is why this hover exists rather than just naming the macro.
	for(var f = 0; f < bound.length; f++) {
		if(looksLikeFilter(bound[f].value)) {
			body += "\n" + describeFilter(bound[f].value, context);
			break;
		}
	}
	return head + body;
}

// A widget hover: what it is, whether anything registers it, and what each
// attribute is worth here rather than as written.
function describeWidget(site, context, widget, bodyText) {
	var head = "```\n<$" + site.name + ">\n```\n\n",
		module = widgets.moduleOfWidget(site.name),
		body;
	if(widgets.customWidgetOf(site.name, context)) {
		// Checked first, because TiddlyWiki lets a \widget take over the tag
		// before any JavaScript widget gets it.
		var definition = macros.findDefinition("$" + site.name, bodyText),
			where = !definition ? "defined outside this tiddler"
				: (definition.title === null ? "defined in this tiddler" : "defined in " + definitionLink(definition.title));
		body = "**custom widget** `$" + site.name + "`, " + where + "\n";
	} else if(!widgets.isRegistered(site.name)) {
		// TiddlyWiki renders an unregistered widget as nothing at all, so a
		// misspelt name is otherwise silent.
		body = "**No widget named** `$" + site.name + "` **is registered.** It will render as nothing.\n";
	} else {
		body = "**widget** `$" + site.name + "`" +
			(module ? ", defined in " + definitionLink(module) : "") + "\n";
	}
	if(site.attributes.length) {
		body += "\n| Attribute | Written | Value |\n| --- | --- | --- |\n";
		for(var i = 0; i < site.attributes.length; i++) {
			var resolved = widgets.resolveAttribute(site.attributes[i], context),
				value = resolved.value === undefined ? "(undefined)" : String(resolved.value);
			body += "| " + cell(site.attributes[i].name) +
				" | `" + cell(resolved.written) + "`" + (resolved.kind === "string" ? "" : " _(" + resolved.kind + ")_") +
				" | `" + cell(value) + "` |\n";
		}
	} else {
		body += "\nNo attributes.\n";
	}
	var introduced = widgets.variablesOf(site);
	if(introduced.length) {
		body += "\nBinds " + introduced.map(function(n) { return "`" + n + "`"; }).join(", ") +
			" for everything inside it.\n";
	}
	// A filter attribute is NOT run here. Point at the filter and it reports
	// itself; a widget hover is about the widget, and running its filter as well
	// duplicated the answer and buried the render underneath it.
	//
	// What it actually renders, body and all, kept last: the output is the least
	// predictable part and the longest.
	var output = source.renderedTextOf(widget);
	if(output) {
		body += "\n\n**Renders as**\n\n```\n" + truncate(output, MAX_RENDER_CHARS) + "\n```\n";
	}
	return head + body;
}

function truncate(text, limit) {
	return text.length > limit ? text.slice(0, limit) + "\n... (" + text.length + " characters)" : text;
}

// A "|" in a cell ends the column, and a filter is free to contain one.
function cell(value) {
	return String(value === undefined ? "" : value).replace(/\|/g, "\\|");
}

function looksLikeFilter(value) {
	var trimmed = String(value || "").trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]") && bracketsBalanced(trimmed);
}

// The definition may be a shadow, which has no file. The browser can still open
// it, so a core macro is reachable even though nothing on disk holds it.
function definitionLink(title) {
	var uri = source.browsableUri(title);
	return uri ? markdownLink(title, uri) : "`" + title + "`";
}

function hover(uri, text, position) {
	var body = source.bodyOf(uri, text);
	if(position.line < body.firstLine) {
		return null;
	}
	var cursor = source.offsetAt(body.starts, position) - body.offset,
		tree = source.parseWithBodies(body.text),
		// What the wiki would mean at this exact position: the document's own
		// tiddler, unless an enclosing <$let> or <$set> says otherwise. Built
		// once, since it renders and one hover may run two filters.
		at = source.renderAt(source.titleOfDocument(uri, text), body.text, cursor),
		context = at.context;
	var call = innermostSite(macros.callSites(tree), cursor);
	if(call) {
		return {
			contents: { kind: "markdown", value: describeCall(call, body.text, context) },
			range: {
				start: source.positionAt(body.starts, body.offset + call.start),
				end: source.positionAt(body.starts, body.offset + call.end)
			}
		};
	}
	// Filters and widgets compete on range, so a filter attribute wins over the
	// widget holding it: the narrower thing is the one being pointed at.
	var filters = filterSites(tree, body.text),
		widgetsHere = widgets.widgetSites(tree),
		site = innermostSite(filters.concat(widgetsHere), cursor);
	if(site) {
		return {
			contents: {
				kind: "markdown",
				value: site.filter === undefined
					? describeWidget(site, context, renderedWidget(at.widget), body.text)
					: describeFilter(site.filter, context)
			},
			range: {
				start: source.positionAt(body.starts, body.offset + site.start),
				end: source.positionAt(body.starts, body.offset + site.end)
			}
		};
	}
	// A filter still being typed produces no node at all, so the parser cannot
	// see it. That is exactly when a reader most wants to know it is unfinished,
	// so the hand-scanner still covers the line under the cursor.
	var lineText = body.lines[position.line] || "",
		onLine = filterContext(lineText, position.character);
	if(onLine) {
		return lineHover(position, onLine, describeFilter(onLine.text, context));
	}
	// Last, a line that is nothing but a filter. Nothing here says it is one, so
	// it must prove itself: an unbalanced or unparseable run stays silent rather
	// than reporting an error about text that was probably never a filter.
	var bare = bareFilterOnLine(lineText, position.character);
	if(!bare || !bracketsBalanced(bare.text) || runFilter(bare.text, context).error) {
		return null;
	}
	return lineHover(position, bare, describeFilter(bare.text, context));
}

// A definition is not rendered where it is written, so for a widget inside its
// body the render at that position is the rest of the document, not its output.
function renderedWidget(widget) {
	var node = widget && widget.parseTreeNode;
	return node && (node.isMacroDefinition || node.isProcedureDefinition || node.isFunctionDefinition || node.isWidgetDefinition) ? null : widget;
}

function lineHover(position, context, markdown) {
	return {
		contents: { kind: "markdown", value: markdown },
		range: {
			start: { line: position.line, character: context.start },
			end: { line: position.line, character: context.end }
		}
	};
}

exports.hover = hover;
exports.filterContext = filterContext;
exports.bracketsBalanced = bracketsBalanced;
exports.markdownLink = markdownLink;
