/*\
title: $:/core/modules/commands/inspect/lsp/lsp-macros.js
type: application/javascript
module-type: library

Hovering a macro or procedure call: what it is, where it is defined, what each
argument binds to, and what a filter argument currently matches.

Both halves come from the parser rather than from pattern matching. A call is a
transclude node carrying $variable, with every argument's own source range and
whether it was positional. A definition is a set node flagged
isMacroDefinition / isProcedureDefinition / isFunctionDefinition, carrying the
declared parameter names and their defaults, which is what lets a positional
argument be reported by the name it binds to.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// The import scopes of the last few trees, each read once however many calls ask.
var recentImports = [],
	RECENT_MAX = 8;

// --- Calls ---

// Every call the parser located, in body offsets: <<name ...>>, and the widget
// forms <$transclude $variable> and <$macrocall $name>, which keep their tag so
// a hover can describe the widget as well.
function callSites(tree) {
	var sites = [];
	(function visit(nodes) {
		for(var i = 0; i < (nodes || []).length; i++) {
			var node = nodes[i],
				attributes = node.attributes || {},
				named = node.type === "macrocall" ? attributes.$name : (node.type === "transclude" ? attributes.$variable : null);
			if(named && named.type === "string" && node.start !== undefined) {
				sites.push({
					name: named.value,
					start: node.start,
					end: node.end,
					tag: node.tag || null,
					args: argumentsOf(attributes, !!node.tag)
				});
			}
			// A <<var>> attribute value is a call of its own, inside the attribute.
			for(var key in attributes) {
				if(attributes[key].type === "macro" && attributes[key].value) {
					visit([attributes[key].value]);
				}
			}
			visit(node.children);
		}
	})(tree);
	return sites;
}

// $variable is the call itself, not an argument, and on a widget form every $
// attribute configures the widget. The rest are arguments, positional when the
// name is the index.
function argumentsOf(attributes, isWidget) {
	var args = [];
	for(var key in attributes) {
		if(key === "$variable" || (isWidget && key.charAt(0) === "$")) {
			continue;
		}
		var attribute = attributes[key];
		args.push({
			name: attribute.isPositional ? null : attribute.name,
			// As written: a <<var>>, {{ref}} or {{{ filter }}} value is a parse
			// node, not text, and only text can be shown or run as a filter.
			value: widgets.writtenOf(attribute),
			positional: !!attribute.isPositional,
			// Where the argument is written, whitespace before its value included.
			start: attribute.start
		});
	}
	return args;
}

// --- Definitions ---

// What a call at offset (body coordinates) resolves to, the way the wiki resolves
// it: a definition of this document, nested ones innermost first, then one an
// \import or <$importvariables> around the call brings in, then a global, then a
// JavaScript macro. site is the definition's entry from calls.js.
function findDefinition(name, bodyText, offset) {
	var local = localDefinition(name, calls.sitesIn(bodyText).definitions, offset);
	if(local) {
		return { kind: local.kind, params: local.params, title: null, site: local };
	}
	var imported = offset === undefined ? null : importedDefinitions(bodyText, offset).filter(function(entry) {
		return entry.definition.name === name;
	}).pop();
	if(imported) {
		return { kind: imported.definition.kind, params: imported.definition.params, title: imported.title, site: imported.definition, imported: true };
	}
	var global = calls.globalDefinition(name);
	if(global) {
		return { kind: global.definition.kind, params: global.definition.params, title: global.title, site: global.definition };
	}
	if($tw.macros && $tw.macros[name]) {
		return { kind: "javascript", params: $tw.macros[name].params || [], title: null };
	}
	return null;
}

// Every top-level definition the imports around offset bring in, as [{ title, definition }]: the innermost
// import last, and within one filter a later title after an earlier one, as core importvariables.js
// overwrites them.
function importedDefinitions(bodyText, offset) {
	var found = [];
	importScopes(source.parseWithBodies(bodyText)).forEach(function(scope) {
		if(offset < scope.start || offset > scope.end) {
			return;
		}
		$tw.wiki.filterTiddlers(scope.filter).forEach(function(title) {
			calls.sitesOfTiddler(title).definitions.forEach(function(definition) {
				if(definition.parent === null) {
					found.push({ title: title, definition: definition });
				}
			});
		});
	});
	return found;
}

// Each \import and <$importvariables> of a tree as { filter, start, end }, outermost first. A \import pragma's
// node spans its own line, and what follows it in the tiddler is nested inside it, so a scope ends where
// its last descendant does.
function importScopes(tree) {
	for(var i = 0; i < recentImports.length; i++) {
		if(recentImports[i].tree === tree) {
			return recentImports[i].scopes;
		}
	}
	var scopes = [];
	(function visit(nodes) {
		(nodes || []).forEach(function(node) {
			var filter = node.type === "importvariables" && node.attributes && node.attributes.filter;
			if(filter && filter.type === "string" && node.start !== undefined) {
				scopes.push({ filter: filter.value, start: node.start, end: extentOf(node) });
			}
			visit(node.children);
		});
	})(tree);
	recentImports.unshift({ tree: tree, scopes: scopes });
	recentImports.length = Math.min(recentImports.length, RECENT_MAX);
	return scopes;
}

function extentOf(node) {
	var end = node.end || 0;
	(node.children || []).forEach(function(child) {
		end = Math.max(end, extentOf(child));
	});
	return end;
}

// A top-level definition is visible anywhere in the document, a nested one from
// where it is written to the end of its parent's body; the deepest visible one
// wins, of equals the last. Without an offset, a top-level one is preferred.
function localDefinition(name, definitions, offset) {
	var best = null,
		bestRank = -1;
	definitions.forEach(function(definition) {
		if(definition.name !== name) {
			return;
		}
		var depth = depthOf(definition, definitions),
			parent = definition.parent === null ? null : definitions[definition.parent],
			visible = !parent || offset === undefined || (offset >= definition.range.start && offset < parent.body.end),
			rank = offset === undefined ? (depth === 0 ? 1 : 0) : depth;
		if(visible && rank >= bestRank) {
			best = definition;
			bestRank = rank;
		}
	});
	return best;
}

// Every definition of this document visible at a cursor, the deepest first; a
// cursor at the very end of a body is still inside it.
function visibleDefinitions(definitions, offset) {
	return definitions.filter(function(definition) {
		var parent = definition.parent === null ? null : definitions[definition.parent];
		return !parent || (offset >= definition.range.start && offset <= parent.body.end);
	}).sort(function(a, b) {
		return depthOf(b, definitions) - depthOf(a, definitions);
	});
}

function depthOf(definition, definitions) {
	var depth = 0;
	while(definition.parent !== null) {
		definition = definitions[definition.parent];
		depth++;
	}
	return depth;
}

// --- Binding arguments to parameters ---

// What each declared parameter is worth at this call: the argument given by
// name, else a positional one, else the declared default. A procedure or custom
// widget gives parameter i the positional argument numbered i (core
// transclude.js), a macro or function the next one not yet taken (core widget.js).
function bindArguments(params, args, kind) {
	var positional = args.filter(function(arg) { return arg.positional; }),
		named = args.filter(function(arg) { return !arg.positional; }),
		byIndex = kind === "procedure" || kind === "widget",
		taken = [],
		bound = [],
		nextPositional = 0;
	for(var i = 0; i < params.length; i++) {
		var param = params[i],
			match = null,
			origin = "default",
			slot = byIndex ? i : nextPositional;
		for(var n = 0; n < named.length; n++) {
			if(named[n].name === param.name) {
				match = named[n].value;
				origin = "named";
			}
		}
		if(match === null && slot < positional.length) {
			match = positional[slot].value;
			origin = "positional";
			taken[slot] = true;
			nextPositional = slot + 1;
		}
		if(match === null) {
			match = param["default"];
			if(match === undefined) {
				continue;
			}
		}
		bound.push({ name: param.name, value: match, origin: origin });
	}
	// An argument the definition never declared is still worth showing, because
	// a misspelled parameter name is exactly the mistake this should reveal.
	for(var u = 0; u < named.length; u++) {
		if(!params.some(function(p) { return p.name === named[u].name; })) {
			bound.push({ name: named[u].name, value: named[u].value, origin: "undeclared" });
		}
	}
	// TiddlyWiki drops a positional argument no parameter takes, without a word.
	positional.forEach(function(arg, index) {
		if(!taken[index]) {
			bound.push({ name: null, value: arg.value, origin: "ignored" });
		}
	});
	return bound;
}

exports.callSites = callSites;
exports.findDefinition = findDefinition;
exports.importedDefinitions = importedDefinitions;
exports.localDefinition = localDefinition;
exports.visibleDefinitions = visibleDefinitions;
exports.bindArguments = bindArguments;
