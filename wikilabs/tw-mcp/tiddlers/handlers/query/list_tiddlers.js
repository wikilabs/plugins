/*\
title: $:/core/modules/commands/inspect/handlers/query/list_tiddlers.js
type: application/javascript
module-type: library

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
		if(total > 100 && !args.limit) {
			return shared.textResult(shared.formatTitleTree(results, "tiddlers", total));
		}
		var limit = args.limit || 100;
		var truncated = results.length > limit;
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
