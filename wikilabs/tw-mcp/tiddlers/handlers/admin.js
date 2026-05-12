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

// Map module-type to the $tw.Wiki.prototype cache TW builds lazily from
// $tw.modules.applyMethods. After a re-execute the cache holds stale
// function references; deleting the property forces the next
// getFilterOperators/getFilterRunPrefixes to rebuild from the now-fresh
// $tw.modules.types map.
var CACHE_INVALIDATE_MAP = {
	"filteroperator": "filterOperators",
	"filterrunprefix": "filterRunPrefixes"
};

function reloadInPlace(title, moduleType) {
	var text = $tw.wiki.getTiddlerText(title);
	if(!text) return { error: "no text in wiki store" };
	var info = $tw.modules.titles[title];
	if(!info) {
		// Module added since boot — register it now so it can be executed.
		$tw.modules.titles[title] = info = {
			moduleType: moduleType,
			definition: text,
			exports: undefined
		};
	}
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
		newExports = oldExports;
	}
	// $tw.modules.types[<type>][<title>] holds the per-type exports map that
	// applyMethods walks. $tw.modules.execute updates info.exports but does NOT
	// touch the types map, so re-point it explicitly.
	if(moduleType && $tw.modules.types[moduleType]) {
		$tw.modules.types[moduleType][title] = newExports;
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
				// Replicate $tw.loadPlugin without its bare addTiddler. Use
				// the syncer's storeTiddler instead, which adds the tiddler
				// AND updates the syncer's tiddlerInfo.changeCount to match
				// the bumped wiki.changeCount. The syncer's later sync check
				// (`wiki.getChangeCount > tiddlerInfo.changeCount`) is then
				// false, so the bundle is never persisted to the edition's
				// tiddlers/ folder. Fallback to addTiddler if no syncer is
				// active (eg headless `--build`).
				var pluginPath = $tw.findLibraryItem(PLUGIN_NAME, paths);
				if(!pluginPath) {
					return shared.errorResult("Plugin folder not found: " + PLUGIN_NAME);
				}
				var pluginFields = $tw.loadPluginFolder(pluginPath);
				if(!pluginFields) {
					return shared.errorResult("Failed to load plugin from folder: " + pluginPath);
				}
				if($tw.syncer) {
					$tw.syncer.storeTiddler(pluginFields);
				} else {
					$tw.wiki.addTiddler(pluginFields);
				}
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
		var touchedTypes = Object.create(null);
		moduleTitles.forEach(function(title) {
			if(EXCLUDE_FROM_RELOAD[title]) {
				skipped.push(title + " (" + EXCLUDE_FROM_RELOAD[title] + ")");
				return;
			}
			var moduleType = pluginInfo.tiddlers[title]["module-type"];
			var result = reloadInPlace(title, moduleType);
			if(result.ok) {
				reloaded.push(title + (PRESERVE_IDENTITY[title] ? " [identity]" : ""));
				if(moduleType && CACHE_INVALIDATE_MAP[moduleType]) {
					touchedTypes[moduleType] = true;
				}
			} else {
				errors.push(title + ": " + result.error);
			}
		});

		// Phase 4: invalidate Wiki.prototype caches whose source module-types
		// were touched. The next getFilterOperators / getFilterRunPrefixes
		// call rebuilds from the now-fresh $tw.modules.types map.
		var invalidatedCaches = [];
		Object.keys(touchedTypes).forEach(function(mt) {
			var protoKey = CACHE_INVALIDATE_MAP[mt];
			if(Object.prototype.hasOwnProperty.call($tw.Wiki.prototype, protoKey)) {
				delete $tw.Wiki.prototype[protoKey];
				invalidatedCaches.push(protoKey + " (" + mt + ")");
			}
		});

		// Build output
		var out = messages.concat([
			"",
			"Reloaded " + reloaded.length + " module(s):"
		]).concat(reloaded.map(function(s) { return "  " + s; }));
		if(invalidatedCaches.length > 0) {
			out.push("");
			out.push("Invalidated " + invalidatedCaches.length + " Wiki.prototype cache(s):");
			invalidatedCaches.forEach(function(s) { out.push("  " + s); });
		}
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
