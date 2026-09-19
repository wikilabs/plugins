/*\
title: $:/core/modules/commands/inspect/handlers/query/run_filter.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: run_filter — evaluate a TW filter expression and
return matching titles, one per line. Caps at 500 results.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"run_filter": function(args) {
		if(args.filter && args.filter.length > shared.MAX_FILTER_LENGTH) {
			return shared.errorResult("Filter too long (" + args.filter.length + " chars). Maximum: " + shared.MAX_FILTER_LENGTH);
		}
		try {
			var results = $tw.wiki.filterTiddlers(args.filter);
			var maxResults = 500;
			var total = results.length;
			var output;
			if(total === 0) {
				output = "(no results)";
			} else if(total <= maxResults) {
				output = results.join("\n");
			} else {
				output = results.slice(0, maxResults).join("\n") + "\n\n(" + total + " total, showing first " + maxResults + ")";
			}
			return shared.textResult(output);
		} catch(e) {
			return shared.errorResult("Filter error: " + e.message );
		}
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["run_filter"].definition = {
	"description": "Execute TW filter expression. Returns titles, one per line, capped at 500 (then a last line '(N total, showing first 500)'). Empty: '(no results)'. Filter max 10000 chars.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"filter": {
				"type": "string",
				"description": "TiddlyWiki filter expression"
			}
		},
		"required": [
			"filter"
		]
	}
};
