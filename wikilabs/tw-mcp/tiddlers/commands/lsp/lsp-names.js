/*\
title: $:/core/modules/commands/inspect/lsp/lsp-names.js
type: application/javascript
module-type: library

Hints for calls whose name nothing defines, since TiddlyWiki renders a misspelt
name as silence. Variables are set while the wiki renders, out of a static
reader's sight, so a name also counts as known when any tiddler defines it,
declares it as a parameter or sets it with a widget, or when a shadow tiddler
calls it: the core and plugins call what their JavaScript sets.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

var SEVERITY_HINT = 4;

// Every name the wiki knows, in its global cache, which every change clears.
var KNOWN_CACHE_KEY = "tw-lsp-known-names";

// The names one tiddler defines or sets, in its own cache.
var SET_CACHE_KEY = "tw-lsp-names-set";

function hints(uri, text) {
	var sites = files.sitesOfDocument(uri, text).filter(function(site) {
		return !site.definition && isCheckable(site.name);
	});
	if(!sites.length) {
		return [];
	}
	var body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text),
		out = [];
	sites.forEach(function(site) {
		if(inReach(site, body, tree) || knownNames()[site.name]) {
			return;
		}
		out.push({
			range: site.range,
			severity: SEVERITY_HINT,
			source: "tiddlywiki",
			message: site.name.charAt(0) === "$" ?
				"`" + site.name + "` is no widget, and no \\widget in this wiki defines it" :
				"`" + site.name + "` is not defined or set anywhere in this wiki"
		});
	});
	return out;
}

// TiddlyWiki sets its core variables and tv- settings itself, and __name__ is a
// \define parameter read as a variable.
function isCheckable(name) {
	return !filters.CORE_VARIABLES.includes(name) && !name.startsWith("tv-") && !/^__.+__$/.test(name);
}

// What the wiki would find at the call itself, as go to definition resolves it.
function inReach(site, body, tree) {
	if(scope.resolve(site.name, site.start, tree, body.text) || macros.findDefinition(site.name, body.text, site.start)) {
		return true;
	}
	if(site.name.charAt(0) === "$") {
		return widgets.isRegistered(site.name.slice(1));
	}
	return !!$tw.wiki.getFilterOperators()[site.name];
}

function knownNames() {
	return $tw.wiki.getGlobalCache(KNOWN_CACHE_KEY, function() {
		var known = Object.create(null);
		function note(title, isShadow) {
			namesSetBy(title).forEach(function(name) {
				known[name] = true;
			});
			if(isShadow) {
				calls.sitesOfTiddler(title).calls.forEach(function(site) {
					known[site.name] = true;
				});
			}
		}
		$tw.wiki.each(function(tiddler, title) {
			note(title, false);
		});
		$tw.wiki.eachShadow(function(tiddler, title) {
			if(!$tw.wiki.tiddlerExists(title)) {
				note(title, true);
			}
		});
		return known;
	});
}

// Definitions, their parameters, and the variables of every widget, bodies included.
function namesSetBy(title) {
	var tiddler = $tw.wiki.getTiddler(title);
	if(!tiddler || (tiddler.fields.type || source.WIKITEXT_TYPE) !== source.WIKITEXT_TYPE) {
		return [];
	}
	return $tw.wiki.getCacheForTiddler(title, SET_CACHE_KEY, function() {
		var names = [];
		calls.sitesOfTiddler(title).definitions.forEach(function(definition) {
			names.push(definition.name);
			definition.params.forEach(function(param) {
				names.push(param.name);
			});
		});
		widgetVariablesIn(tiddler.fields.text || "", names);
		return names;
	});
}

function widgetVariablesIn(text, names) {
	source.eachNode($tw.wiki.parseText(source.WIKITEXT_TYPE, text).tree, function(node) {
		var body = calls.definitionBody(node, text);
		if(body && body.kind !== "function") {
			widgetVariablesIn(body.text, names);
		} else if(node.tag && node.tag.charAt(0) === "$") {
			widgets.variablesOf({ name: node.tag.slice(1), attributes: node.orderedAttributes || [] }).forEach(function(name) {
				names.push(name);
			});
		}
	});
}

exports.hints = hints;
