/*\
title: $:/core/modules/commands/inspect/handlers/query/find_calls.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: find_calls — every call and definition of a macro, procedure,
function or widget, from calls.js, grouped by tiddler with hashline anchors.

It answers from the wiki rather than from files, so shadow tiddlers count, and
it shares nothing with --lsp but calls.js, so either works without the other.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	hashline = require("$:/core/modules/commands/inspect/hashline.js");

var SNIPPET_CAP = 200;

// One tiddler's matching sites as output lines, one per source line, with every
// form found on that line.
function linesOf(title, name, includeDefinitions) {
	var sites = calls.sitesOfTiddler(title),
		found = sites.calls.filter(function(s) { return s.name === name; });
	if(includeDefinitions) {
		found = found.concat(sites.definitions.filter(function(s) { return s.name === name; }).map(function(s) {
			return { start: s.start, form: "definition" };
		}));
	}
	if(!found.length) {
		return null;
	}
	var text = $tw.wiki.getTiddlerText(title, ""),
		byLine = Object.create(null),
		order = [];
	found.sort(function(a, b) { return a.start - b.start; }).forEach(function(site) {
		var line = shared.lineAt(text, site.start);
		if(!byLine[line.number]) {
			byLine[line.number] = { line: line, forms: [] };
			order.push(line.number);
		}
		if(!byLine[line.number].forms.includes(site.form)) {
			byLine[line.number].forms.push(site.form);
		}
	});
	return {
		calls: found.filter(function(s) { return s.form !== "definition"; }).length,
		definitions: found.filter(function(s) { return s.form === "definition"; }).length,
		lines: order.map(function(n) {
			var entry = byLine[n];
			return "  " + hashline.formatLineTag(n, entry.line.text) + " [" + entry.forms.join(", ") + "]: " + shared.lineSnippet(entry.line, SNIPPET_CAP);
		})
	};
}

function plural(count, word) {
	return count + " " + word + (count === 1 ? "" : "s");
}

module.exports = {
	"find_calls": function(args) {
		if(!args.name) {
			return shared.errorResult("find_calls: missing required argument 'name'");
		}
		var scoped = shared.scopedTitles(args);
		if(scoped.errorResult) {
			return scoped.errorResult;
		}
		var includeDefinitions = args.include_definitions !== false,
			maxTotal = args.max_total || 200,
			blocks = [],
			callCount = 0,
			definitionCount = 0,
			truncated = false;
		for(var i = 0; i < scoped.titles.length; i++) {
			var found = linesOf(scoped.titles[i], args.name, includeDefinitions);
			if(!found) {
				continue;
			}
			// A tiddler is shown whole or not at all, so no block is cut short.
			if(callCount + definitionCount + found.calls + found.definitions > maxTotal) {
				truncated = true;
				break;
			}
			blocks.push(scoped.titles[i] + "\n" + found.lines.join("\n"));
			callCount += found.calls;
			definitionCount += found.definitions;
		}
		if(!blocks.length) {
			return shared.textResult(truncated ? "(no calls within max_total " + maxTotal + ")" : "(no calls)");
		}
		var output = blocks.join("\n\n") + "\n\n" + plural(callCount, "call") + ", " +
			plural(definitionCount, "definition") + " in " + plural(blocks.length, "tiddler");
		if(truncated) {
			output += "\n(truncated at " + maxTotal + "; narrow filter or raise max_total)";
		}
		return shared.textResult(output);
	}
};

// MCP tool definition, advertised via mcp-handlers getToolDefinitions().
module.exports["find_calls"].definition = {
	"description": "Call sites of a macro/procedure/function/widget. Output per tiddler: title header, indented '<n>#<hash> [forms]: line' (anchor → edit_tiddler `pos`); forms: macro, macrocall, transclude, widget, filter, definition. Footer: 'N calls, D definitions in M tiddlers'; '(truncated...)' when capped. Empty: '(no calls)'. Covers every call form incl. filters and definition bodies; not names built at render time. Shadows only if filter includes them, e.g. '[all[shadows+tiddlers]]'.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"name": {
				"type": "string",
				"description": "Macro, procedure, function or widget name; a widget keeps its '$'"
			},
			"filter": {
				"type": "string",
				"description": "TW filter scope; default '[all[tiddlers]!is[system]]' or '[all[tiddlers]]' when include_system"
			},
			"include_system": {
				"type": "boolean",
				"default": false
			},
			"include_definitions": {
				"type": "boolean",
				"default": true,
				"description": "Also list the \\define, \\procedure, \\function or \\widget pragma declaring the name"
			},
			"max_total": {
				"type": "number",
				"default": 200,
				"description": "Cap on calls plus definitions; a tiddler is listed whole or not at all"
			}
		},
		"required": [
			"name"
		]
	}
};
