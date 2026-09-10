/*\
title: $:/core/modules/commands/inspect/lsp/lsp-references.js
type: application/javascript
module-type: library

Find references: every place the macro, procedure, function or widget under the
cursor is called, across every document the editor can open (lsp-files.js).

The call sites come from tw-mcp-core's calls.js, which knows nothing about LSP;
this file adds the editor's view of them, and keeps a parameter or a widget's
variable to its own scope.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js");

function references(uri, text, position, context, openDocuments) {
	var here = files.sitesOfDocument(uri, text),
		target = files.siteAt(here, position);
	if(!target) {
		return null;
	}
	var includeDeclaration = !!(context && context.includeDeclaration),
		body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text),
		binding = target.definition ? null : scope.resolve(target.name, target.start, tree, body.text);
	if(binding) {
		return scopedReferences(uri, here, binding, tree, body, includeDeclaration);
	}
	var documents = Object.assign({}, openDocuments);
	documents[uri] = text;
	return files.sitesNamed(target.name, documents).filter(function(hit) {
		return includeDeclaration || !hit.site.definition;
	}).map(function(hit) {
		return { uri: hit.uri, range: hit.site.range };
	}).sort(byPosition);
}

// A parameter or a widget's variable is that name only inside its own scope in
// this document, and an inner binding of the same name hides it.
function scopedReferences(uri, sites, binding, tree, body, includeDeclaration) {
	var locations = scopedUses(sites, binding, tree, body).map(function(range) {
			return { uri: uri, range: range };
		}),
		declared = declarationRange(binding, body);
	if(includeDeclaration && declared) {
		locations.push({ uri: uri, range: declared });
	}
	return locations.sort(byPosition);
}

// The ranges of every use of a binding in its own scope.
function scopedUses(sites, binding, tree, body) {
	return sites.filter(function(site) {
		if(site.definition || site.name !== binding.name) {
			return false;
		}
		var own = scope.resolve(site.name, site.start, tree, body.text);
		return own && own.scope.node === binding.scope.node;
	}).map(function(site) {
		return site.range;
	});
}

// Where a binding is declared, or null for a variable no attribute names.
function declarationRange(binding, body) {
	if(!binding.declaration) {
		return null;
	}
	return {
		start: source.positionAt(body.starts, body.offset + binding.declaration.start),
		end: source.positionAt(body.starts, body.offset + binding.declaration.end)
	};
}

function byPosition(a, b) {
	if(a.uri !== b.uri) {
		return a.uri < b.uri ? -1 : 1;
	}
	return (a.range.start.line - b.range.start.line) || (a.range.start.character - b.range.start.character);
}

exports.references = references;
exports.scopedUses = scopedUses;
exports.declarationRange = declarationRange;
exports.sameFileKey = files.sameFileKey;
