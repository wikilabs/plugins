/*\
title: $:/core/modules/commands/inspect/handlers/query/list_tiddlers.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: list_tiddlers — convenience over run_filter for common
listing tasks (plugin contents, overridden shadows, tag, system inclusion).

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"list_tiddlers": function(args) {
		var filter;
		if(args.plugin) {
			filter = "[[" + shared.sanitiseFilterOperand(args.plugin) + "]plugintiddlers[]sort[title]]";
		} else if(args.overwrittenShadows) {
			filter = "[is[tiddler]is[shadow]sort[title]]";
		} else if(args.tag) {
			filter = "[tag[" + shared.sanitiseFilterOperand(args.tag) + "]]";
		} else if(args.includeSystem) {
			filter = "[all[tiddlers]sort[title]]";
		} else {
			filter = "[all[tiddlers]!is[system]sort[title]]";
		}
		var results = $tw.wiki.filterTiddlers(filter);
		var total = results.length;
		var limit = args.limit || 100;
		var truncated = total > limit;
		if(args.flat) {
			var flatList = truncated ? results.slice(0, limit) : results;
			var flatOut = flatList.join("\n");
			if(truncated) {
				flatOut += "\n\n(" + total + " total, showing first " + limit + ")";
			}
			return shared.textResult(flatOut);
		}
		if(total > 100 && !args.limit) {
			return shared.textResult(shared.formatTitleTree(results, "tiddlers", total));
		}
		if(truncated) {
			results = results.slice(0, limit);
		}
		var output = shared.formatTitleTree(results);
		if(truncated) {
			output += "\n\n(" + total + " total, showing first " + limit + ")";
		}
		return shared.textResult(output);
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["list_tiddlers"].definition = {
	"description": "Namespace tree summary of tiddler titles with common-prefix header. flat:true returns newline-separated titles instead. Filter flags mutually exclusive, priority: plugin > overwrittenShadows > tag > includeSystem (only highest applies). limit caps result (default 100, truncation footer when exceeded).",
	"inputSchema": {
		"type": "object",
		"properties": {
			"tag": {
				"type": "string",
				"description": "Filter by tag"
			},
			"plugin": {
				"type": "string",
				"description": "List plugin subtiddlers"
			},
			"overwrittenShadows": {
				"type": "boolean",
				"default": false
			},
			"limit": {
				"type": "number",
				"default": 100
			},
			"includeSystem": {
				"type": "boolean",
				"default": false
			},
			"flat": {
				"type": "boolean",
				"default": false,
				"description": "Return raw newline-separated titles instead of namespace tree summary"
			}
		},
		"required": []
	}
};
