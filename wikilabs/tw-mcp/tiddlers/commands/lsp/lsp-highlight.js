/*\
title: $:/core/modules/commands/inspect/lsp/lsp-highlight.js
type: application/javascript
module-type: library

Document highlight: with the cursor on a name, every place in this document
where it means the same thing. A parameter or a widget's variable lights up in
its own scope, a definition's name wherever the wiki would call that definition.

The editor asks on every cursor move, so only the buffer is read, never disk.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	references = require("$:/core/modules/commands/inspect/lsp/lsp-references.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// LSP DocumentHighlightKind: a declaration or definition writes, a use reads.
var READ = 2,
	WRITE = 3;

// Whatever the wiki supplies from outside this document: a global, a JavaScript
// macro, or nothing at all.
var OUTSIDE = { outside: true };

function documentHighlights(uri, text, position) {
	var sites = files.sitesOfDocument(uri, text),
		target = files.siteAt(sites, position);
	if(!target) {
		return null;
	}
	var body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text),
		binding = target.definition ? null : scope.resolve(target.name, target.start, tree, body.text);
	if(binding) {
		var found = references.scopedUses(sites, binding, tree, body).map(function(range) {
				return { range: range, kind: READ };
			}),
			declared = references.declarationRange(binding, body);
		if(declared) {
			found.push({ range: declared, kind: WRITE });
		}
		return found.sort(byPosition);
	}
	var definitions = calls.sitesIn(body.text).definitions,
		meaning = meaningOf(target, definitions, tree, body);
	return sites.filter(function(site) {
		return site.name === target.name && meaningOf(site, definitions, tree, body) === meaning;
	}).map(function(site) {
		return { range: site.range, kind: site.definition ? WRITE : READ };
	}).sort(byPosition);
}

// What a name means where it is written: the definition it is or calls here, the
// scope of a binding that hides every definition, or OUTSIDE.
function meaningOf(site, definitions, tree, body) {
	if(site.definition) {
		return definitions.filter(function(definition) { return definition.start === site.start; })[0];
	}
	// A header field is rendered elsewhere, out of reach of this body's definitions.
	if(site.start < 0) {
		return OUTSIDE;
	}
	var binding = scope.resolve(site.name, site.start, tree, body.text);
	if(binding) {
		return binding.scope.node;
	}
	return macros.localDefinition(site.name, definitions, site.start) || OUTSIDE;
}

function byPosition(a, b) {
	return (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character);
}

exports.documentHighlights = documentHighlights;
