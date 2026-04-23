/*\
title: $:/core/modules/commands/inspect/handlers/admin.js
type: application/javascript
module-type: library

MCP admin tools — currently: reload_mcp_modules for hot-reload of
plugin JS during development without restarting the server.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

var PLUGIN_NAME = "wikilabs/tw-mcp";
var PLUGIN_TITLE = "$:/plugins/" + PLUGIN_NAME;

// Modules that hold live state and cannot be reloaded without breaking
// running connections, init context, or change listeners.
var EXCLUDE_FROM_RELOAD = {
	"$:/core/modules/commands/mcp.js": "command module, runs once at boot",
	"$:/core/modules/commands/inspect/mcp-lib.js": "holds dispatcher, pipe server, stdin listener",
	"$:/core/modules/commands/inspect/handlers/shared.js": "holds readonlyMode and checkPathAllowed init context",
	"$:/core/modules/commands/inspect/handlers/filesystem.js": "holds reload_tiddlers change listener"
};

// Modules whose exports object identity must be preserved because
// mcp-lib.js captured a reference at require-time.
var PRESERVE_IDENTITY = {
	"$:/core/modules/commands/inspect/mcp-tools.js": true,
	"$:/core/modules/commands/inspect/mcp-handlers.js": true
};

function reloadInPlace(title) {
	var info = $tw.modules.titles[title];
	if(!info) return { error: "not registered in $tw.modules" };
	var text = $tw.wiki.getTiddlerText(title);
	if(!text) return { error: "no text in wiki store" };
	var oldExports = info.exports;
	info.definition = text;
	info.exports = undefined;
	try {
		$tw.modules.execute(title);
	} catch(e) {
		info.exports = oldExports;
		return { error: e.message };
	}
	var newExports = info.exports;
	if(PRESERVE_IDENTITY[title] && oldExports && typeof oldExports === "object" && oldExports !== newExports) {
		var k;
		for(k in oldExports) {
			if(!Object.prototype.hasOwnProperty.call(newExports, k)) {
				delete oldExports[k];
			}
		}
		for(k in newExports) {
			oldExports[k] = newExports[k];
		}
		info.exports = oldExports;
	}
	return { ok: true };
}

module.exports = {
	"reload_mcp_modules": function(args) {
		var denied = shared.checkWritable("reload_mcp_modules");
		if(denied) return denied;
		args = args || {};

		var messages = [];
		var reloaded = [];
		var skipped = [];
		var errors = [];

		// Phase 1: re-read plugin from disk so $tw.wiki has fresh subtiddler text.
		if(args.skip_disk_reload !== true) {
			try {
				var paths = $tw.getLibraryItemSearchPaths(
					$tw.config.pluginsPath,
					$tw.config.pluginsEnvVar
				);
				$tw.loadPlugin(PLUGIN_NAME, paths);
				$tw.wiki.readPluginInfo();
				$tw.wiki.registerPluginTiddlers(null);
				$tw.wiki.unpackPluginTiddlers();
				messages.push("Plugin re-read from disk: " + PLUGIN_TITLE);
			} catch(e) {
				return shared.errorResult("Failed to re-read plugin from disk: " + e.message);
			}
		}

		// Phase 2: collect JS module titles inside the plugin.
		var pluginInfo = $tw.wiki.getPluginInfo(PLUGIN_TITLE);
		if(!pluginInfo || !pluginInfo.tiddlers) {
			return shared.errorResult("Plugin info not found: " + PLUGIN_TITLE);
		}
		var moduleTitles = [];
		Object.keys(pluginInfo.tiddlers).forEach(function(t) {
			var pt = pluginInfo.tiddlers[t];
			if(pt.type === "application/javascript" && pt["module-type"]) {
				moduleTitles.push(t);
			}
		});
		moduleTitles.sort();

		// Phase 3: reload each module, except excluded.
		moduleTitles.forEach(function(title) {
			if(EXCLUDE_FROM_RELOAD[title]) {
				skipped.push(title + " (" + EXCLUDE_FROM_RELOAD[title] + ")");
				return;
			}
			var result = reloadInPlace(title);
			if(result.ok) {
				reloaded.push(title + (PRESERVE_IDENTITY[title] ? " [identity]" : ""));
			} else {
				errors.push(title + ": " + result.error);
			}
		});

		// Build output
		var out = messages.concat([
			"",
			"Reloaded " + reloaded.length + " module(s):"
		]).concat(reloaded.map(function(s) { return "  " + s; }));
		if(skipped.length > 0) {
			out.push("");
			out.push("Skipped " + skipped.length + " (excluded; restart required):");
			skipped.forEach(function(s) { out.push("  " + s); });
		}
		if(errors.length > 0) {
			out.push("");
			out.push("Errors (" + errors.length + "):");
			errors.forEach(function(s) { out.push("  " + s); });
		}
		return errors.length > 0
			? shared.errorResult(out.join("\n"))
			: shared.textResult(out.join("\n"));
	}
};
