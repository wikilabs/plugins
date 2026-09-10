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
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js");

// Variables TiddlyWiki itself sets, which no definition in the wiki declares.
var CORE_VARIABLES = ["currentTiddler", "..currentTiddler", "storyTiddler", "thisTiddler", "transclusion", "actionTiddler", "modifier", "condition", "namespace"];

// Titles listed in one hover. A filter over a large wiki would otherwise render
// its whole result set into a popup.
var MAX_HOVER_TITLES = 50;

var FILTER_ERROR_TITLE = "$:/language/Error/Filter";

// A definition's parameters exist only in a call, so a filter evaluated where the
// definition is written sees them empty.
var UNBOUND_NOTE = "\n\n_Evaluated where it is written: the enclosing definition's parameters are not set here._";

// A rendered body can be a whole page; a hover is not the place for it.
var MAX_RENDER_CHARS = 600;

// --- Locating filters through the parser ---

// Every filter the parser can locate, in offsets relative to the body: a filter
// attribute in any quoting, a {{{ }}} value of any attribute, a \function body,
// and each condition of an <%if%> block.
function filterSites(tree, body) {
	var sites = [];
	source.eachNode(tree, function(node) {
		var attributes = node.attributes || {};
		for(var key in attributes) {
			var attribute = attributes[key];
			if(attribute.start === undefined) {
				continue;
			}
			if(calls.isFilterAttribute(key) && (attribute.type === "string" || attribute.type === "substituted")) {
				sites.push({
					filter: attribute.type === "string" ? attribute.value : attribute.rawValue,
					substituted: attribute.type === "substituted",
					start: attribute.start,
					end: attribute.end
				});
			} else if(attribute.type === "filtered") {
				sites.push({ filter: attribute.filter, start: attribute.start, end: attribute.end });
			}
		}
		(calls.conditionalClauses(node, body) || []).forEach(function(clause) {
			if(clause.filter) {
				sites.push({ filter: clause.filter, condition: true, start: clause.start, end: clause.end });
			}
		});
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

// Each <%if%> block, for the hover that says which clause renders.
function conditionalBlocks(tree, body) {
	var blocks = [];
	source.eachNode(tree, function(node) {
		var clauses = calls.conditionalClauses(node, body);
		if(clauses) {
			blocks.push({ clauses: clauses, start: node.start, end: node.end });
		}
	});
	return blocks;
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

function describeFilter(filterString, context, substituted) {
	var trimmed = filterString.trim();
	if(!trimmed) {
		return "Empty filter.";
	}
	var head = "```\n" + trimmed + "\n```\n\n";
	// A backtick value runs only once $(variable)$ and ${ filter }$ are filled
	// in, so that is the filter shown and run.
	if(substituted && context) {
		var resolved = $tw.wiki.getSubstitutedText(filterString, context).trim();
		if(resolved !== trimmed) {
			head += "Substituted here:\n\n```\n" + resolved + "\n```\n\n";
			trimmed = resolved;
		}
	}
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
// over the filter argument nested inside it. A name a parameter or an enclosing
// widget binds is that binding, whatever definition shares the name.
function describeCall(site, body, context, tree) {
	var head = "```\n" + site.name + "\n```\n\n",
		binding = scope.resolve(site.name, site.start, tree, body.text);
	if(binding) {
		return head + describeBinding(binding, body, context);
	}
	var bodyText = body.text,
		definition = macros.findDefinition(site.name, bodyText, site.start);
	if(!definition) {
		return head + describeUnbound(site.name, context);
	}
	var where = definition.title === null
			? (definition.kind === "javascript" ? "a JavaScript macro" : "defined in this tiddler")
			: "defined in " + definitionLink(definition.title),
		body = "**" + definition.kind + "** `" + site.name + "`, " + where + "\n\n",
		bound = macros.bindArguments(definition.params, site.args, definition.kind);
	if(!bound.length) {
		body += "Takes no parameters.\n";
	} else {
		// Markdown, not wikitext: hover contents are declared as markdown, and a
		// markdown table is nothing without its header separator row.
		body += "| Parameter | Value | Given as |\n| --- | --- | --- |\n";
		for(var i = 0; i < bound.length; i++) {
			body += "| " + cell(bound[i].name === null ? "" : bound[i].name) + " | `" + cell(bound[i].value) + "` | " + bound[i].origin + " |\n";
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

function describeBinding(binding, body, context) {
	if(binding.kind === "parameter") {
		return "**parameter** `" + binding.name + "` of `" + binding.of + "`" +
			(binding.value === undefined ? ", no default" : ", default `" + cell(binding.value) + "`") +
			"\n\nEach call gives it a value; where the definition is written it is not set.\n";
	}
	var line = source.positionAt(body.starts, body.offset + binding.scope.node.start).line + 1,
		value = context ? context.getVariable(binding.name) : undefined;
	return "**variable** `" + binding.name + "`, set by `" + binding.by + "` on line " + line +
		(value === undefined ? "" : "\n\nHere: `" + cell(value) + "`") + "\n";
}

// Neither bound here nor defined anywhere: a variable TiddlyWiki sets itself, one
// the rendering context supplies, or a name only a caller can provide.
function describeUnbound(name, context) {
	var value = context ? context.getVariable(name) : undefined,
		here = value === undefined ? "" : ", here `" + cell(value) + "`";
	if(CORE_VARIABLES.includes(name) || name.startsWith("tv-")) {
		return "**core variable** `" + name + "`" + here + "\n";
	}
	if(value !== undefined) {
		return "**variable** `" + name + "`, set outside this tiddler" + here + "\n";
	}
	return "**Not set here.** No definition, parameter or enclosing widget binds `" + name +
		"` at this position, so only a caller can give it a value.\n";
}

// An <%if%> block: each clause in order, and which one renders here.
function describeConditional(block, context) {
	var out = "```\n<%if%>\n```\n\n**conditional**: the first clause whose filter yields a result renders, and `<<condition>>` holds that result.\n\n" +
			"| Clause | Filter | Here |\n| --- | --- | --- |\n",
		decided = false;
	block.clauses.forEach(function(clause) {
		var here;
		if(decided) {
			here = "not reached";
		} else if(!clause.filter) {
			here = "**renders**";
			decided = true;
		} else if(!bracketsBalanced(clause.filter)) {
			here = "unfinished";
		} else {
			var outcome = runFilter(clause.filter, context);
			decided = !!(outcome.error || outcome.titles.length);
			here = decided ? "**renders**" + (outcome.error ? " (an error message counts as a result)" : "") : "false";
		}
		out += "| `" + clause.keyword + "` | " + (clause.filter ? "`" + cell(clause.filter) + "`" : "") + " | " + here + " |\n";
	});
	return decided ? out : out + "\nNo clause holds, so nothing renders here.\n";
}

// What one condition decides, below its filter hover.
function conditionVerdict(filter, context) {
	if(!bracketsBalanced(filter.trim())) {
		return "";
	}
	var outcome = runFilter(filter.trim(), context);
	if(outcome.error) {
		return "\n\nAs a condition it holds anyway: the error message is a result.";
	}
	return outcome.titles.length
		? "\n\nAs a condition: **true**, so its branch renders, with `<<condition>>` = `" + cell(outcome.titles[0]) + "`."
		: "\n\nAs a condition: **false**, so the next clause is tried.";
}

// A widget hover: what it is, whether anything registers it, and what each
// attribute is worth here rather than as written.
function describeWidget(site, context, widget, bodyText, callText) {
	var head = "```\n<$" + site.name + ">\n```\n\n",
		module = modules.moduleOfWidget(site.name),
		body;
	if(widgets.customWidgetOf(site.name, context)) {
		// Checked first, because TiddlyWiki lets a \widget take over the tag
		// before any JavaScript widget gets it.
		var definition = macros.findDefinition("$" + site.name, bodyText, site.start),
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
	// The call a <$transclude> or <$macrocall> makes still comes before the render.
	if(callText) {
		body += "\n---\n\n" + callText;
	}
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

// A definition's home: its file, else the wiki in the browser, plus the editor's
// read-only view of a tiddler with no file, and the plugin supplying it, if any.
function definitionLink(title) {
	var uri = source.browsableUri(title),
		view = source.documentUriOf(title),
		from = modules.provenance(title);
	return (uri ? markdownLink(title, uri) : "`" + title + "`") +
		(view && source.isVirtualUri(view) ? " (" + markdownLink("open in editor", view) + ")" : "") +
		(from ? ", " + from : "");
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
	var call = innermostSite(macros.callSites(tree), cursor),
		widgetsHere = widgets.widgetSites(tree, body.text);
	if(call) {
		// A <$transclude> or <$macrocall> is a widget as well as a call, so the
		// widget is described and the call it makes follows.
		var asWidget = call.tag && widgetsHere.find(function(w) { return w.start === call.start; }),
			described = describeCall(call, body, context, tree);
		return {
			contents: {
				kind: "markdown",
				value: asWidget ? describeWidget(asWidget, context, renderedWidget(at.widget), body.text, described) : described
			},
			range: {
				start: source.positionAt(body.starts, body.offset + call.start),
				end: source.positionAt(body.starts, body.offset + call.end)
			}
		};
	}
	// Filters, widgets and <%if%> blocks compete on range, so the narrowest thing
	// under the cursor is the one described.
	var filters = filterSites(tree, body.text),
		site = innermostSite(filters.concat(widgetsHere, conditionalBlocks(tree, body.text)), cursor),
		unbound = at.widget && !renderedWidget(at.widget) ? UNBOUND_NOTE : "",
		value;
	if(site) {
		if(site.clauses) {
			value = describeConditional(site, context) + unbound;
		} else if(site.filter === undefined) {
			value = describeWidget(site, context, renderedWidget(at.widget), body.text);
		} else {
			value = describeFilter(site.filter, context, site.substituted) + (site.condition ? conditionVerdict(site.filter, context) : "") + unbound;
		}
		return {
			contents: { kind: "markdown", value: value },
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
exports.filterSites = filterSites;
exports.filterContext = filterContext;
exports.bracketsBalanced = bracketsBalanced;
exports.markdownLink = markdownLink;
