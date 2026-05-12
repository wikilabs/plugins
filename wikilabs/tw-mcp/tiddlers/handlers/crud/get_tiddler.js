/*\
title: $:/core/modules/commands/inspect/handlers/crud/get_tiddler.js
type: application/javascript
module-type: library

MCP tool handler: get_tiddler — single-tiddler read. Returns title-first
.tid/JSON/hashline forms; for plugin tiddlers shows the shadow-subtiddler
tree instead of the bundled text.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var crudShared = require("$:/core/modules/commands/inspect/handlers/crud/_shared.js");

module.exports = {
	"get_tiddler": function(args) {
		var tiddler = $tw.wiki.getTiddler(args.title);
		if(!tiddler) {
			return shared.errorResult("Tiddler not found: " + args.title);
		}
		if(shared.isPluginTiddler(tiddler)) {
			var pluginInfo = $tw.wiki.getPluginInfo(args.title);
			var shadowTitles = pluginInfo && pluginInfo.tiddlers ? Object.keys(pluginInfo.tiddlers).sort() : [];
			var readmeTitle = args.title + "/readme";
			var readmeIdx = shadowTitles.indexOf(readmeTitle);
			if(readmeIdx > 0) {
				shadowTitles.splice(readmeIdx, 1);
				shadowTitles.unshift(readmeTitle);
			}
			var output = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]}) + "\n\n" + shared.formatTitleTree(shadowTitles, "shadow tiddlers");
			return shared.textResult(output);
		}
		var includeText = !!args.detailed || !!args.lines;
		var unsafe = crudShared.hasUnsafeFields(tiddler);
		if(args.format === "json") {
			return shared.textResult(shared.jsonStringify(crudShared.extractFieldsObject(tiddler, {includeText: includeText})));
		} else if(args.format === "tid") {
			var output = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]});
			if(includeText && tiddler.fields.text !== undefined) {
				output += "\n\n" + tiddler.fields.text;
			}
			return shared.textResult(output);
		} else {
			// Default (hashline): title-first tid headers for safe fields, JSON for unsafe, hashlined text
			var header;
			if(unsafe) {
				header = shared.jsonStringify(crudShared.extractFieldsObject(tiddler, {includeText: false}));
			} else {
				header = crudShared.formatFieldsBlock(tiddler, {exclude: ["text"]});
			}
			var output = header;
			if(includeText && tiddler.fields.text !== undefined) {
				var hashline = require("$:/core/modules/commands/inspect/hashline.js");
				output += "\n\n" + hashline.formatHashLines(tiddler.fields.text);
			}
			return shared.textResult(output);
		}
	}
};
