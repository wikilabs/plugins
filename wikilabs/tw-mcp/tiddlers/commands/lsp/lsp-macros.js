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

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

// Where global macros live, the same set the wiki itself imports.
var GLOBAL_MACROS_FILTER = "[all[shadows+tiddlers]tag[$:/tags/Macro]]";

// --- Calls ---

// Every <<name ...>> call the parser located, in body offsets.
function callSites(tree) {
	var sites = [];
	source.eachNode(tree, function(node) {
		var attributes = node.attributes || {};
		if(node.type !== "transclude" || !attributes.$variable || node.start === undefined) {
			return;
		}
		sites.push({
			name: attributes.$variable.value,
			start: node.start,
			end: node.end,
			args: argumentsOf(attributes)
		});
	});
	return sites;
}

// $variable is the call itself, not an argument; everything else was written by
// the author, positionally when its name is the index.
function argumentsOf(attributes) {
	var args = [];
	for(var key in attributes) {
		if(key === "$variable") {
			continue;
		}
		var attribute = attributes[key];
		args.push({
			name: attribute.isPositional ? null : attribute.name,
			value: attribute.value,
			positional: !!attribute.isPositional
		});
	}
	return args;
}

// --- Definitions ---

function definitionKind(node) {
	if(node.isFunctionDefinition) {
		return "function";
	}
	if(node.isProcedureDefinition) {
		return "procedure";
	}
	return node.isMacroDefinition ? "macro" : null;
}

// The definition of name inside one parsed tree, or null.
function definitionIn(tree, name) {
	var found = null;
	source.eachNode(tree, function(node) {
		if(found || node.type !== "set") {
			return;
		}
		var kind = definitionKind(node),
			attributes = node.attributes || {};
		if(kind && attributes.name && attributes.name.value === name) {
			found = { kind: kind, params: node.params || [], body: attributes.value ? attributes.value.value : "" };
		}
	});
	return found;
}

// A call resolves against the document's own pragmas first, exactly as the
// wiki resolves it: a local definition shadows a global one of the same name.
function findDefinition(name, bodyText) {
	var local = definitionIn(source.parseBody(bodyText), name);
	if(local) {
		local.title = null;
		return local;
	}
	var globals = $tw.wiki.filterTiddlers(GLOBAL_MACROS_FILTER);
	for(var i = 0; i < globals.length; i++) {
		var text = $tw.wiki.getTiddlerText(globals[i], ""),
			hit = text ? definitionIn(source.parseBody(text), name) : null;
		if(hit) {
			hit.title = globals[i];
			return hit;
		}
	}
	if($tw.macros && $tw.macros[name]) {
		return { kind: "javascript", params: $tw.macros[name].params || [], body: "", title: null };
	}
	return null;
}

// --- Binding arguments to parameters ---

// What each declared parameter is worth at this call: the argument given by
// name, else the one given by position, else the declared default.
function bindArguments(params, args) {
	var positional = args.filter(function(arg) { return arg.positional; }),
		named = args.filter(function(arg) { return !arg.positional; }),
		bound = [],
		nextPositional = 0;
	for(var i = 0; i < params.length; i++) {
		var param = params[i],
			match = null,
			origin = "default";
		for(var n = 0; n < named.length; n++) {
			if(named[n].name === param.name) {
				match = named[n].value;
				origin = "named";
			}
		}
		if(match === null && nextPositional < positional.length) {
			match = positional[nextPositional++].value;
			origin = "positional";
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
	return bound;
}

exports.callSites = callSites;
exports.findDefinition = findDefinition;
exports.bindArguments = bindArguments;
exports.definitionIn = definitionIn;
