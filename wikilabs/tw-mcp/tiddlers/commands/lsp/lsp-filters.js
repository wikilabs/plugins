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
	modules = require("$:/core/modules/commands/inspect/modules.js"),
	pragmas = require("$:/core/modules/commands/inspect/lsp/lsp-pragmas.js");

// Variables TiddlyWiki itself sets, which no definition in the wiki declares.
var CORE_VARIABLES = ["currentTiddler", "..currentTiddler", "storyTiddler", "thisTiddler", "transclusion", "actionTiddler", "modifier", "condition", "namespace"];

// Titles listed in one hover. A filter over a large wiki would otherwise render
// its whole result set into a popup.
var MAX_HOVER_TITLES = 50;

var FILTER_ERROR_TITLE = "$:/language/Error/Filter";

// Each named run prefix: its page on tiddlywiki.com and what it does.
var RUN_PREFIXES = {
	or: { page: "Or", does: "adds its results to the output, without duplicates" },
	and: { page: "And", does: "runs on the output so far and replaces it with its result" },
	except: { page: "Except", does: "removes its results from the output so far" },
	"else": { page: "Else", does: "runs only when the output so far is empty" },
	all: { page: "All", does: "adds its results, duplicates included" },
	"let": { page: "Let", does: "assigns the output so far to a variable named by its own first result, and empties the output" },
	filter: { page: "Filter", does: "keeps each title for which the run yields anything" },
	map: { page: "Map", does: "replaces each title with the run's first result for it" },
	reduce: { page: "Reduce", does: "folds the output into one value, the result so far in `accumulator`" },
	sort: { page: "Sort", does: "sorts the output by the run's result for each title" },
	cascade: { page: "Cascade", does: "replaces each title with the first result of the filters its run lists" },
	intersection: { page: "Intersection", does: "keeps only the titles its run also yields" },
	then: { page: "then", does: "replaces a non-empty output with its result, unless that is empty" }
};

// The named prefix each shorthand runs (core filters.js compileFilter).
var SHORTHAND_PREFIXES = { "+": "and", "-": "except", "~": "else", "=": "all", "=>": "let" };

// A definition's parameters exist only in a call, so a filter evaluated where the
// definition is written sees them empty.
var UNBOUND_NOTE = "\n\n_Evaluated where it is written: the enclosing definition's parameters are not set here._";

// A rendered body can be a whole page; a hover is not the place for it.
var MAX_RENDER_CHARS = 600;

// --- Locating filters through the parser ---

/**
 * Every filter the parser locates, in body offsets: filter attributes, {{{ }}} values, \function bodies and <%if%> conditions.
 * @param {object[]} tree - parse tree
 * @param {string} body - body text
 * @returns {object[]} Sites as { filter, start, end, substituted?, condition? }
 */
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

/**
 * Each <%if%> block, for the hover that says which clause renders.
 * @param {object[]} tree - parse tree
 * @param {string} body - body text
 * @returns {object[]} Blocks as { clauses, start, end, spots }
 */
function conditionalBlocks(tree, body) {
	var blocks = [];
	source.eachNode(tree, function(node) {
		var clauses = calls.conditionalClauses(node, body);
		if(clauses) {
			blocks.push({ clauses: clauses, start: node.start, end: node.end, spots: markerSpots(clauses, node, body) });
		}
	});
	return blocks;
}

/**
 * Where a block answers a hover: each clause's marker and its <%endif%>, never what it renders.
 * @param {object[]} clauses - from calls.conditionalClauses
 * @param {object} node - the block's $list
 * @param {string} body - body text
 * @returns {Array<{start: number, end: number}>} Spots
 */
function markerSpots(clauses, node, body) {
	var spots = clauses.map(function(clause) {
		return { start: clause.at, end: body.indexOf("%>", clause.at) + 2 };
	});
	var last = body.lastIndexOf("<%", node.end - 1);
	if(/^<%\s*endif\s*%>$/.test(body.slice(last, node.end))) {
		spots.push({ start: last, end: node.end });
	}
	return spots;
}

/**
 * The part of a site that answers a hover at offset: one of its spots, else its whole range.
 * @param {object} site - filter, widget, call or block site
 * @param {number} offset - body offset
 * @returns {(object|null)} Spot
 */
function spotAt(site, offset) {
	return (site.spots || [site]).find(function(spot) {
		return offset >= spot.start && offset < spot.end;
	}) || null;
}

/**
 * The site with the smallest spot under the cursor, so an inner filter wins over its enclosing widget.
 * @param {object[]} sites - candidate sites
 * @param {number} offset - body offset
 * @returns {(object|null)} Site
 */
function innermostSite(sites, offset) {
	var best = null,
		bestSize = Infinity;
	for(var i = 0; i < sites.length; i++) {
		var spot = spotAt(sites[i], offset);
		if(spot && spot.end - spot.start < bestSize) {
			best = sites[i];
			bestSize = spot.end - spot.start;
		}
	}
	return best;
}

/**
 * The run prefix or operator under the cursor in a filter site.
 * @param {object} site - filter site
 * @param {string} bodyText - body text
 * @param {number} cursor - body offset
 * @returns {({part: object, start: number, end: number}|null)} Part in body offsets
 */
function partIn(site, bodyText, cursor) {
	var at = site.start + bodyText.slice(site.start, site.end).lastIndexOf(site.filter),
		parts = calls.filterParts(site.filter),
		hit = parts ? parts.prefixes.concat(parts.operators).filter(function(part) {
			return cursor >= at + part.start && cursor < at + part.end;
		})[0] : null;
	return hit ? { part: hit, start: at + hit.start, end: at + hit.end } : null;
}

/**
 * The run prefix or operator under the cursor anywhere in the body.
 * @param {object[]} tree - parse tree
 * @param {string} bodyText - body text
 * @param {number} cursor - body offset
 * @returns {({part: object, start: number, end: number}|null)} Part in body offsets
 */
function filterPartAt(tree, bodyText, cursor) {
	var site = innermostSite(filterSites(tree, bodyText), cursor);
	return site ? partIn(site, bodyText, cursor) : null;
}

/**
 * The named prefix a run prefix stands for.
 * @param {object} part - prefix part from calls.filterParts
 * @returns {string} Prefix name
 */
function runPrefixName(part) {
	return part.named || SHORTHAND_PREFIXES[part.prefix];
}

// --- The fallback, for a filter that does not parse yet ---

/**
 * A filter on a line, finished or still being typed: a {{{ }}} or a filter= or filter: value.
 * @param {string} lineText - the line
 * @param {number} character - cursor column
 * @returns {({text: string, start: number, end: number}|null)} Filter in line columns
 */
function filterContext(lineText, character) {
	return filterInBraces(lineText, character) || filterInAttribute(lineText, character);
}

/**
 * The filtered transclusion around a column, finished or not.
 * @param {string} lineText - the line
 * @param {number} character - cursor column
 * @returns {({text: string, start: number, end: number}|null)} Filter in line columns
 */
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

/**
 * The filter or subfilter value around a column, in any quoting including backticks, finished or not.
 * @param {string} lineText - the line
 * @param {number} character - cursor column
 * @returns {({text: string, start: number, end: number}|null)} Filter in line columns
 */
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

/**
 * A line that is nothing but a filter, such as one in a code block or a filter-valued config tiddler.
 * @param {string} lineText - the line
 * @param {number} character - cursor column
 * @returns {({text: string, start: number, end: number}|null)} Filter in line columns
 */
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

/**
 * Tells whether a filter's brackets balance, so a half-typed filter is not reported as matching nothing.
 * @param {string} filterString - filter
 * @returns {boolean} True if balanced
 */
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

/**
 * Runs a filter, telling a filter error apart from a real tiddler of that title.
 * @param {string} filterString - filter
 * @param {object} [context] - widget at the position
 * @returns {({titles: string[]}|{error: string})} Titles or error
 */
function runFilter(filterString, context) {
	var errorTiddler = $tw.wiki.getTiddler(FILTER_ERROR_TITLE),
		prefix = ((errorTiddler && errorTiddler.fields.text) || "Filter error") + ": ",
		results = $tw.wiki.filterTiddlers(filterString, context || undefined);
	if(results.length === 1 && results[0].startsWith(prefix) && !$tw.wiki.tiddlerExists(results[0])) {
		return { error: results[0].slice(prefix.length) };
	}
	return { titles: results };
}

/**
 * A markdown link, escaping the characters that would end it early.
 * @param {string} text - link text
 * @param {string} uri - target
 * @returns {string} Markdown
 */
function markdownLink(text, uri) {
	return "[" + text.replace(/[[\]]/g, "\\$&") + "](" + uri.replace(/[()]/g, function(ch) {
		return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
	}) + ")";
}

/**
 * A title linked to its file, or plain text when it has none, as for a shadow tiddler.
 * @param {string} title - tiddler title
 * @returns {string} Markdown
 */
function titleLink(title) {
	var uri = source.uriOfTitle(title);
	return uri ? markdownLink(title, uri) : title;
}

/**
 * The hover for a filter: the filter, its substituted form, and what it matches here.
 * @param {string} filterString - filter
 * @param {object} [context] - widget at the position
 * @param {boolean} [substituted] - a backtick value
 * @returns {string} Markdown
 */
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

/**
 * The hover for a run prefix or operator: the code that runs it, or the field test TiddlyWiki makes for an unknown name.
 * @param {object} part - from calls.filterParts
 * @param {string} bodyText - body text
 * @param {number} offset - body offset
 * @returns {string} Markdown
 */
function describePart(part, bodyText, offset) {
	if(part.prefix !== undefined) {
		var name = runPrefixName(part),
			known = RUN_PREFIXES[name],
			prefixModule = modules.moduleOfRunPrefix(name);
		if(!prefixModule) {
			return "**Unknown run prefix** `" + part.prefix + "`: the filter yields an error message instead of titles.\n";
		}
		return "**run prefix** `" + part.prefix + "`" + (part.named ? "" : ", short for `:" + name + "`") + (known ? ": " + known.does : "") +
			"\n\nDefined in " + definitionLink(prefixModule) + (known ? coreDoc(prefixModule, known.page + " Filter Run Prefix") : "") + "\n";
	}
	var module = modules.moduleOfFilterOperator(part.operator);
	if(module) {
		return "**filter operator** `" + part.operator + "`" + (part.suffix === null ? "" : ", suffix `" + part.suffix + "`") + (part.negated ? ", negated by `!`" : "") +
			"\n\nDefined in " + definitionLink(module) + coreDoc(module, part.operator + " Operator") + operatorModuleDescription(module) + "\n";
	}
	var field = part.suffix || part.operator,
		operands = part.step.slice(part.operator.length + (part.suffix === null ? 0 : part.suffix.length + 1)),
		test = "TiddlyWiki tests the field `" + field + "` instead, as `[" + (part.negated ? "!" : "") + "field:" + field + operands + "]`.";
	if(part.operator.includes(".")) {
		var found = macros.findDefinition(part.operator, bodyText, offset);
		if(found) {
			return "**" + found.kind + "** `" + part.operator + "`, called as a filter operator, " + (found.title === null ? "defined in this tiddler" : "defined in " + definitionLink(found.title)) + "\n";
		}
		return "**No definition of** `" + part.operator + "` **is visible here.** Unless a caller supplies one, " + test + "\n";
	}
	return "**Not a filter operator.** " + test + " A misspelt operator looks exactly like this.\n";
}

/**
 * The header description of an operator's module, which may export several operators.
 * @param {string} module - module title
 * @returns {string} Markdown quote, or empty
 */
function operatorModuleDescription(module) {
	var description = widgets.moduleDescription(module);
	if(!description) {
		return "";
	}
	var count = Object.keys($tw.modules.execute(module)).length;
	return (count > 1 ? "\n\nIts module's header, shared by " + count + " operators:" : "") + "\n\n" +
		description.replace(/</g, "\\<").split(/\r?\n/).map(function(line) {
			return line ? "> " + line : ">";
		}).join("\n");
}

/**
 * A tiddlywiki.com link for a core module's page; a plugin's or an overridden module gets none.
 * @param {string} module - module title
 * @param {string} page - tiddlywiki.com title
 * @returns {string} Markdown, or empty
 */
function coreDoc(module, page) {
	return isCore(module)
		? ", documented at " + markdownLink("tiddlywiki.com", "https://tiddlywiki.com/#" + encodeURIComponent(page))
		: "";
}

/**
 * Tells whether a title is core's own shadow, not overridden.
 * @param {string} [title] - tiddler or module title
 * @returns {boolean} True for unchanged core
 */
function isCore(title) {
	return !!title && $tw.wiki.getShadowSource(title) === "$:/core" && !$tw.wiki.tiddlerExists(title);
}

/**
 * A tiddlywiki.com link opening the page tagged `tag` whose caption is `name`, else the tag's overview page.
 * @param {string} tag - "Widgets" or "Core Macros"
 * @param {string} name - widget or macro name
 * @returns {string} Markdown
 */
function docByCaption(tag, name) {
	// An empty permalink target with a story filter opens what the filter finds (core startup/story.js).
	var filter = "[tag[" + tag + "]field:caption[" + name + "]] ~[[" + tag + "]]";
	return ", documented at " + markdownLink("tiddlywiki.com", "https://tiddlywiki.com/#:" + encodeURIComponent(filter));
}

/**
 * The hover for a call, arguments and filter results together, or for the binding its name resolves to.
 * @param {object} site - call site
 * @param {object} body - document body
 * @param {object} [context] - widget at the position
 * @param {object[]} tree - parse tree
 * @returns {string} Markdown
 */
function describeCall(site, body, context, tree) {
	// Each description names the call itself, so no heading repeats it.
	var binding = scope.resolve(site.name, site.start, tree, body.text);
	if(binding) {
		return describeBinding(binding, body, context);
	}
	var bodyText = body.text,
		definition = macros.findDefinition(site.name, bodyText, site.start);
	if(!definition) {
		return describeUnbound(site.name, context);
	}
	var where = definition.title === null
			? (definition.kind === "javascript" ? "a JavaScript macro" : "defined in this tiddler")
			: "defined in " + definitionLink(definition.title),
		fromCore = isCore(definition.kind === "javascript" ? modules.moduleOfMacro(site.name) : definition.title),
		body = "**" + definition.kind + "** `" + site.name + "`, " + where + (fromCore ? docByCaption("Core Macros", site.name) : "") + "\n\n",
		bound = macros.bindArguments(definition.params, site.args, definition.kind);
	if(!bound.length && !definition.params.length) {
		body += "Takes no parameters.\n";
	}
	if(bound.length) {
		// Markdown, not wikitext: hover contents are declared as markdown, and a
		// markdown table is nothing without its header separator row.
		body += "| Parameter | Value | Given as |\n| --- | --- | --- |\n";
		for(var i = 0; i < bound.length; i++) {
			body += "| " + cell(bound[i].name === null ? "" : bound[i].name) + " | `" + cell(bound[i].value) + "` | " + bound[i].origin + " |\n";
		}
	}
	if(definition.params.length) {
		body += (bound.length ? "\n" : "") + "Runs as:\n\n```\n" + callAsRun(site.name, definition.params, bound) + "\n```\n";
	}
	// A parameter holding a filter is the one a reader wants evaluated, and it
	// is why this hover exists rather than just naming the macro.
	for(var f = 0; f < bound.length; f++) {
		if(looksLikeFilter(bound[f].value)) {
			body += "\n" + describeFilter(bound[f].value, context);
			break;
		}
	}
	return body;
}

/**
 * The call with every declared parameter named and the value it gets here.
 * @param {string} name - callee
 * @param {object[]} params - declared parameters
 * @param {object[]} bound - from macros.bindArguments
 * @returns {string} Wikitext call
 */
function callAsRun(name, params, bound) {
	return "<<" + name + params.map(function(param) {
		var given = bound.filter(function(entry) { return entry.name === param.name && entry.origin !== "undeclared"; })[0];
		return " " + param.name + ":" + quoteArgument(given ? String(given.value) : "");
	}).join("") + ">>";
}

// The first quoting a macro argument's value does not contain.
var ARGUMENT_QUOTES = [["\"", "\""], ["'", "'"], ["\"\"\"", "\"\"\""], ["[[", "]]"]];

/**
 * A macro argument in the first quoting its value does not contain.
 * @param {string} value - argument value
 * @returns {string} Quoted value
 */
function quoteArgument(value) {
	var quote = ARGUMENT_QUOTES.find(function(pair) { return !value.includes(pair[1]); }) || ARGUMENT_QUOTES[2];
	return quote[0] + value + quote[1];
}

/**
 * The hover for a name a parameter or an enclosing widget binds.
 * @param {object} binding - from scope.resolve
 * @param {object} body - document body
 * @param {object} [context] - widget at the position
 * @returns {string} Markdown
 */
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

/**
 * The hover for a name nothing binds here: a core variable, one set outside, or one only a caller can give.
 * @param {string} name - variable name
 * @param {object} [context] - widget at the position
 * @returns {string} Markdown
 */
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

/**
 * The hover for an <%if%> block: each clause and which one renders here.
 * @param {object} block - from conditionalBlocks
 * @param {object} [context] - widget at the position
 * @returns {string} Markdown
 */
function describeConditional(block, context) {
	var out = "**conditional**: the first clause whose filter yields a result renders, and `<<condition>>` holds that result.\n\n" +
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

/**
 * What one condition decides, below its filter hover.
 * @param {string} filter - condition filter
 * @param {object} [context] - widget at the position
 * @returns {string} Markdown, or empty
 */
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

/**
 * The hover for a widget: what it is, what registers it, and each attribute's value here.
 * @param {object} site - widget site
 * @param {object} [context] - widget at the position
 * @param {object} [widget] - rendered widget
 * @param {string} bodyText - body text
 * @param {string} [callText] - description of the call it makes
 * @returns {string} Markdown
 */
function describeWidget(site, context, widget, bodyText, callText) {
	var module = modules.moduleOfWidget(site.name),
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
			(module ? ", defined in " + definitionLink(module) + (isCore(module) ? docByCaption("Widgets", site.name) : "") : "") + "\n";
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
	return body;
}

/**
 * Text cut to a limit, saying how long it was.
 * @param {string} text - text
 * @param {number} limit - maximum characters
 * @returns {string} Text
 */
function truncate(text, limit) {
	return text.length > limit ? text.slice(0, limit) + "\n... (" + text.length + " characters)" : text;
}

/**
 * A value safe in a markdown table cell, since a filter may contain a |.
 * @param {*} value - any value
 * @returns {string} Escaped text
 */
function cell(value) {
	return String(value === undefined ? "" : value).replace(/\|/g, "\\|");
}

/**
 * Tells whether a value is a whole, balanced filter.
 * @param {*} value - any value
 * @returns {boolean} True if it looks like a filter
 */
function looksLikeFilter(value) {
	var trimmed = String(value || "").trim();
	return trimmed.startsWith("[") && trimmed.endsWith("]") && bracketsBalanced(trimmed);
}

/**
 * A definition's home: its file or the browser wiki, the editor view, the supplying plugin and the shadows it replaces.
 * @param {string} title - tiddler or module title
 * @returns {string} Markdown
 */
function definitionLink(title) {
	var uri = source.browsableUri(title),
		view = source.documentUriOf(title),
		from = modules.provenance(title),
		hidden = modules.hiddenVersions(title);
	return (uri ? markdownLink(title, uri) : "`" + title + "`") +
		(view && source.isVirtualUri(view) ? " (" + markdownLink("open in editor", view) + ")" : "") +
		(from ? ", " + from : "") +
		(hidden.length ? "; versions that do not run: " + hidden.map(function(plugin) {
			return markdownLink(plugin, source.virtualUri(title, plugin));
		}).join(", ") : "");
}

/**
 * The LSP hover at a position: a pragma, call, filter, widget or <%if%> block, narrowest first.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @param {{line: number, character: number}} position - cursor
 * @param {object} [openDocuments] - open documents by URI
 * @returns {(object|null)} LSP hover
 */
function hover(uri, text, position, openDocuments) {
	// A pragma line hovers as its keyword, name or parameter, which nothing below knows.
	var pragma = pragmas.hover(uri, text, position, openDocuments);
	if(pragma) {
		return pragma;
	}
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
	var widgetsHere = widgets.widgetSites(tree, body.text),
		// A <$transclude> or <$macrocall> is a widget as well as a call, so it answers on its tags.
		callsHere = macros.callSites(tree).map(function(site) {
			var tagged = site.tag && widgetsHere.find(function(w) { return w.start === site.start; });
			return tagged ? Object.assign({}, site, { spots: tagged.spots }) : site;
		}),
		call = innermostSite(callsHere, cursor);
	if(call) {
		// The widget is described and the call it makes follows.
		var asWidget = call.tag && widgetsHere.find(function(w) { return w.start === call.start; }),
			described = describeCall(call, body, context, tree),
			callSpot = spotAt(call, cursor);
		return {
			contents: {
				kind: "markdown",
				value: asWidget ? describeWidget(asWidget, context, renderedWidget(at.widget), body.text, described) : described
			},
			range: {
				start: source.positionAt(body.starts, body.offset + callSpot.start),
				end: source.positionAt(body.starts, body.offset + callSpot.end)
			}
		};
	}
	// Filters, widgets and <%if%> blocks compete on range, so the narrowest thing
	// under the cursor is the one described.
	var filters = filterSites(tree, body.text),
		site = innermostSite(filters.concat(widgetsHere, conditionalBlocks(tree, body.text)), cursor),
		unbound = at.widget && !renderedWidget(at.widget) ? UNBOUND_NOTE : "",
		value,
		span = site && spotAt(site, cursor);
	if(site) {
		if(site.clauses) {
			value = describeConditional(site, context) + unbound;
		} else if(site.filter === undefined) {
			value = describeWidget(site, context, renderedWidget(at.widget), body.text);
		} else {
			value = describeFilter(site.filter, context, site.substituted) + (site.condition ? conditionVerdict(site.filter, context) : "") + unbound;
			// An operator or run prefix explains itself, then the filter it is part of.
			var part = partIn(site, body.text, cursor);
			if(part) {
				value = describePart(part.part, body.text, part.start) + "\n---\n\n" + value;
				span = part;
			}
		}
		return {
			contents: { kind: "markdown", value: value },
			range: {
				start: source.positionAt(body.starts, body.offset + span.start),
				end: source.positionAt(body.starts, body.offset + span.end)
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

/**
 * The widget rendered at a position, or null inside a definition body, which is not rendered where it is written.
 * @param {object} [widget] - widget at the position
 * @returns {(object|null)} Widget
 */
function renderedWidget(widget) {
	var node = widget && widget.parseTreeNode;
	return node && (node.isMacroDefinition || node.isProcedureDefinition || node.isFunctionDefinition || node.isWidgetDefinition) ? null : widget;
}

/**
 * A hover over a range of one line.
 * @param {{line: number, character: number}} position - cursor
 * @param {{start: number, end: number}} context - columns
 * @param {string} markdown - hover text
 * @returns {object} LSP hover
 */
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
exports.filterPartAt = filterPartAt;
exports.runPrefixName = runPrefixName;
exports.CORE_VARIABLES = CORE_VARIABLES;
exports.filterContext = filterContext;
exports.bracketsBalanced = bracketsBalanced;
exports.markdownLink = markdownLink;
