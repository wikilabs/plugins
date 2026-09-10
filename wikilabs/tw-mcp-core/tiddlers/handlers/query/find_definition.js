/*\
title: $:/core/modules/commands/inspect/handlers/query/find_definition.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: find_definition — where a macro, procedure, function, widget,
filter operator, filter run prefix or JavaScript macro is defined, from calls.js
and modules.js, grouped by tiddler with hashline anchors.

It answers from the wiki, so shadows and the running JavaScript count, and it
shares nothing with --lsp but those two libraries.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js"),
	hashline = require("$:/core/modules/commands/inspect/hashline.js");

var SNIPPET_CAP = 200;

// Definitions are often shadows, core macros above all, so those count by default.
var DEFAULT_SCOPE = "[all[shadows+tiddlers]]";

function entryLine(title, offset, kinds) {
	var line = shared.lineAt($tw.wiki.getTiddlerText(title, ""), offset);
	return "  " + hashline.formatLineTag(line.number, line.text) + " [" + kinds + "]: " + shared.lineSnippet(line, SNIPPET_CAP);
}

// A tiddler's heading, naming the plugin that supplies it when one does.
function heading(title) {
	var from = modules.provenance(title);
	return title + (from ? "  (" + from + ")" : "");
}

// The wikitext definitions of name, the one the wiki imports marked global.
function wikitextBlocks(name, titles) {
	var global = calls.globalDefinition(name),
		blocks = [];
	titles.forEach(function(title) {
		var lines = calls.sitesOfTiddler(title).definitions.filter(function(definition) {
			return definition.name === name;
		}).map(function(definition) {
			var isGlobal = !!global && global.title === title && global.definition.start === definition.start;
			return entryLine(title, definition.start, definition.kind + (isGlobal ? ", global" : ""));
		});
		if(lines.length) {
			blocks.push({ text: heading(title) + "\n" + lines.join("\n"), count: lines.length });
		}
	});
	return blocks;
}

// The running JavaScript behind name: a widget is written with its $, a run
// prefix with its colon, anything else may be a filter operator or a macro.
function javascriptBlocks(name) {
	var blocks = [];
	function add(title, kind, exported) {
		if(title) {
			var at = modules.exportedAt(title, exported);
			blocks.push({ text: heading(title) + "\n" + entryLine(title, at ? at.start : 0, kind), count: 1 });
		}
	}
	if(name.charAt(0) === "$") {
		add(modules.moduleOfWidget(name.slice(1)), "JavaScript widget", name.slice(1));
	} else if(name.charAt(0) === ":") {
		add(modules.moduleOfRunPrefix(name.slice(1)), "run prefix", name.slice(1));
	} else {
		add(modules.moduleOfFilterOperator(name), "filter operator", name);
		add(modules.moduleOfMacro(name), "JavaScript macro", "run");
	}
	return blocks;
}

function plural(count, word) {
	return count + " " + word + (count === 1 ? "" : "s");
}

module.exports = {
	"find_definition": function(args) {
		if(!args.name) {
			return shared.errorResult("find_definition: missing required argument 'name'");
		}
		var scoped = shared.scopedTitles({ filter: args.filter || DEFAULT_SCOPE });
		if(scoped.errorResult) {
			return scoped.errorResult;
		}
		var blocks = wikitextBlocks(args.name, scoped.titles).concat(javascriptBlocks(args.name));
		if(!blocks.length) {
			return shared.textResult("(no definition)");
		}
		var count = blocks.reduce(function(sum, block) { return sum + block.count; }, 0);
		return shared.textResult(blocks.map(function(block) { return block.text; }).join("\n\n") + "\n\n" +
			plural(count, "definition") + " in " + plural(blocks.length, "tiddler"));
	}
};

// MCP tool definition, advertised via mcp-handlers getToolDefinitions().
module.exports["find_definition"].definition = {
	"description": "Where a name is defined: \\procedure/\\function/\\define/\\widget pragmas, JavaScript widgets ('$list'), filter operators ('compare'), run prefixes (':else') and JavaScript macros. Output per tiddler: title, plus the supplying plugin when not core; indented '<n>#<hash> [kinds]: line' (anchor → edit_tiddler `pos`). 'global' marks the definition the wiki imports. Footer: 'N definitions in M tiddlers'. Empty: '(no definition)'.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"name": {
				"type": "string",
				"description": "Name as written in a call; a widget keeps its '$', a run prefix its ':'"
			},
			"filter": {
				"type": "string",
				"description": "TW filter scope for wikitext definitions; default '[all[shadows+tiddlers]]'"
			}
		},
		"required": [
			"name"
		]
	}
};
