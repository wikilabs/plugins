/*\
title: $:/core/modules/commands/inspect/modules.js
type: application/javascript
module-type: library

Where the running JavaScript defines a widget, filter operator, filter run
prefix or JavaScript macro, and which plugins supply a tiddler.

Protocol-neutral like calls.js: it answers in titles and offsets into a
tiddler's text, so --lsp and --mcp can each build on it.

\*/

"use strict";

var CORE_PLUGIN = "$:/core";

// The module whose export is the one running. A later module may overwrite an
// earlier one's name, so identity, not registration order, decides.
function moduleExporting(type, running, pick) {
	var found = null;
	if(running) {
		$tw.modules.forEachModuleOfType(type, function(title, exported) {
			if(pick(exported) === running) {
				found = title;
			}
		});
	}
	return found;
}

function moduleOfWidget(name) {
	var classes = ($tw.rootWidget && $tw.rootWidget.widgetClasses) || {};
	return moduleExporting("widget", classes[name], function(exported) { return exported[name]; });
}

function moduleOfFilterOperator(name) {
	return moduleExporting("filteroperator", $tw.wiki.getFilterOperators()[name], function(exported) { return exported[name]; });
}

function moduleOfRunPrefix(name) {
	return moduleExporting("filterrunprefix", $tw.wiki.getFilterRunPrefixes()[name], function(exported) { return exported[name]; });
}

// A JavaScript macro module exports a single macro, named by its name field.
function moduleOfMacro(name) {
	return moduleExporting("macro", $tw.macros && $tw.macros[name], function(exported) { return exported; });
}

// Where a module defines name, as { start, end } in its text: the constructor
// its export names when that is written in the same module, else the export.
function exportedAt(title, name) {
	var text = $tw.wiki.getTiddlerText(title, ""),
		escaped = $tw.utils.escapeRegExp(name),
		exported = new RegExp("^exports(?:\\." + escaped + "|\\[\\s*([\"'])" + escaped + "\\1\\s*\\])\\s*=\\s*([A-Za-z_$][\\w$]*)?", "m").exec(text);
	if(!exported) {
		return null;
	}
	var identifier = exported[2] !== "function" ? exported[2] : null,
		written = identifier ? new RegExp("^(?:(?:var|let|const)\\s+" + $tw.utils.escapeRegExp(identifier) + "\\s*=|function\\s+" + $tw.utils.escapeRegExp(identifier) + "\\s*\\()", "m").exec(text) : null;
	if(written) {
		var start = written.index + written[0].indexOf(identifier);
		return { start: start, end: start + identifier.length };
	}
	var at = exported.index + exported[0].indexOf(name, "exports".length);
	return { start: at, end: at + name.length };
}

// The active plugins that ship title as a shadow.
function providersOf(title) {
	return $tw.wiki.filterTiddlers("[all[tiddlers+shadows]has[plugin-type]]").filter(function(plugin) {
		var info = $tw.wiki.getPluginInfo(plugin);
		return !!(info && info.tiddlers && $tw.utils.hop(info.tiddlers, title));
	});
}

// Who supplies the running text of title, as a phrase, or "" when there is
// nothing to say: core is always present, so only a plugin is ever named.
function provenance(title) {
	if(!$tw.wiki.isShadowTiddler(title)) {
		return "";
	}
	var source = $tw.wiki.getShadowSource(title),
		replaced = providersOf(title).filter(function(plugin) { return plugin !== source; });
	if($tw.wiki.tiddlerExists(title)) {
		return source === CORE_PLUGIN ? "your tiddler" : "your tiddler, replacing the shadow from " + source;
	}
	if(source === CORE_PLUGIN) {
		return "";
	}
	return "from " + source + (replaced.length ? ", replacing " + replaced.join(", ") : "");
}

exports.moduleOfWidget = moduleOfWidget;
exports.moduleOfFilterOperator = moduleOfFilterOperator;
exports.moduleOfRunPrefix = moduleOfRunPrefix;
exports.moduleOfMacro = moduleOfMacro;
exports.exportedAt = exportedAt;
exports.providersOf = providersOf;
exports.provenance = provenance;
