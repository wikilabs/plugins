/*\
title: $:/core/modules/commands/inspect/lsp/lsp-definition.js
type: application/javascript
module-type: library

Go to definition. On a call: the definition the wiki would use at that call, or
for a parameter or a widget's variable the place it is declared. On a link: the
file that holds the tiddler, a shadow's plugin source file, else its view.

A definition may live in this document, in another .tid file, in a shadow or
in the JavaScript behind a widget or macro; the last two open as read-only
views. No file is searched for: $tw.boot.files is the map TiddlyWiki saves
through, so a renamed file, a FileSystemPaths subfolder and a .meta sidecar all
come out right.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js");

// --- Links ---

/**
 * Every link and transclusion target in document offsets.
 * @param {object} body - from source.bodyOf
 * @returns {Array<{target: string, from: number, to: number}>} Sites
 */
function linkSites(body) {
	return links.targetsIn(body.text).map(function(link) {
		return { target: link.target, from: body.offset + link.start, to: body.offset + link.end };
	});
}

/**
 * The link whose target text holds the cursor, the tightest when a transclusion sits inside a link.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @param {{line: number, character: number}} position - cursor
 * @returns {(string|null)} Target
 */
function targetAt(uri, text, position) {
	var body = source.bodyOf(uri, text),
		cursor = source.offsetAt(body.starts, position),
		gathered = linkSites(body),
		best = null;
	for(var i = 0; i < gathered.length; i++) {
		var site = gathered[i];
		if(cursor >= site.from && cursor <= site.to) {
			if(!best || (site.to - site.from) < (best.to - best.from)) {
				best = site;
			}
		}
	}
	return best ? best.target : null;
}

// --- Calls ---

/**
 * The call under the cursor and where it is defined, each target { uri, range, full }.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @param {{line: number, character: number}} position - cursor
 * @param {object} [openDocuments] - open documents by URI
 * @returns {(object|null)} { origin, targets }, null off any call
 */
function callTargets(uri, text, position, openDocuments) {
	var site = files.siteAt(files.sitesOfDocument(uri, text), position);
	if(!site || site.definition) {
		return null;
	}
	var body = source.bodyOf(uri, text),
		binding = scope.resolve(site.name, site.start, source.parseWithBodies(body.text), body.text);
	if(binding) {
		return { origin: site.range, targets: [declarationTarget(uri, body, binding)] };
	}
	var found = macros.findDefinition(site.name, body.text, site.start),
		target = null;
	if(found && found.kind === "javascript") {
		target = moduleTarget(modules.moduleOfMacro(site.name), "run");
	} else if(found && found.title === null) {
		target = {
			uri: uri,
			range: rangeIn(body, found.site.start, found.site.end),
			full: rangeIn(body, found.site.range.start, found.site.range.end)
		};
	} else if(found) {
		target = tiddlerTarget(found.title, site.name);
	} else if(site.name.charAt(0) === "$") {
		// A widget that no \widget definition takes over is the JavaScript one.
		target = moduleTarget(modules.moduleOfWidget(site.name.slice(1)), site.name.slice(1));
	}
	if(target) {
		return { origin: site.range, targets: [target] };
	}
	// TiddlyWiki would find nothing here, so every definition of the name is
	// offered: a caller may be what brings one into scope.
	var documents = Object.assign({}, openDocuments);
	documents[uri] = text;
	return {
		origin: site.range,
		targets: files.sitesNamed(site.name, documents).filter(function(hit) { return hit.site.definition; }).map(function(hit) {
			return { uri: hit.uri, range: hit.site.range, full: hit.site.full };
		})
	};
}

/**
 * The JavaScript behind the filter operator or run prefix under the cursor; a dotted operator is a call, which callTargets answers first.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @param {{line: number, character: number}} position - cursor
 * @returns {(object|null)} { origin, targets }
 */
function operatorTargets(uri, text, position) {
	var body = source.bodyOf(uri, text),
		hit = filters.filterPartAt(source.parseWithBodies(body.text), body.text, source.offsetAt(body.starts, position) - body.offset);
	if(!hit) {
		return null;
	}
	var isPrefix = hit.part.prefix !== undefined,
		name = isPrefix ? filters.runPrefixName(hit.part) : hit.part.operator,
		target = moduleTarget(isPrefix ? modules.moduleOfRunPrefix(name) : modules.moduleOfFilterOperator(name), name);
	return target ? { origin: rangeIn(body, hit.start, hit.end), targets: [target] } : null;
}

/**
 * The protocol range of two body offsets.
 * @param {object} body - from source.bodyOf
 * @param {number} start - body offset
 * @param {number} end - body offset
 * @returns {object} LSP range
 */
function rangeIn(body, start, end) {
	return { start: source.positionAt(body.starts, body.offset + start), end: source.positionAt(body.starts, body.offset + end) };
}

/**
 * A declared name, or for a variable no attribute names (the currentTiddler of a <$list>) the tag of the widget that sets it.
 * @param {string} uri - document URI
 * @param {object} body - from source.bodyOf
 * @param {object} binding - from scope.resolve
 * @returns {object} Target { uri, range, full }
 */
function declarationTarget(uri, body, binding) {
	var start, end;
	if(binding.declaration) {
		start = binding.declaration.start;
		end = binding.declaration.end;
	} else {
		start = binding.scope.node.start;
		end = start + 1 + (binding.scope.node.tag || "").length;
	}
	var range = rangeIn(body, start, end);
	return { uri: uri, range: range, full: range };
}

/**
 * A global's definition in the document the editor opens for its tiddler, read from there since a saved file can be ahead of the wiki.
 * @param {string} title - defining tiddler
 * @param {string} name - definition name
 * @returns {(object|null)} Target { uri, range, full }
 */
function tiddlerTarget(title, name) {
	var where = source.documentUriOf(title),
		sites;
	if(!where) {
		return null;
	}
	if(!source.isVirtualUri(where)) {
		sites = files.sitesOfFile(source.fileOfTitle(title));
	} else {
		sites = files.sitesOfView(title);
	}
	// The last top-level one, since a later definition overwrites an earlier.
	var hit = sites.filter(function(site) { return site.definition && site.topLevel && site.name === name; }).pop();
	return hit ? { uri: where, range: hit.range, full: hit.full } : null;
}

/**
 * The JavaScript behind a widget or macro, at its constructor or its export.
 * @param {(string|null)} title - module title
 * @param {string} exportName - export name
 * @returns {(object|null)} Target { uri, range, full }
 */
function moduleTarget(title, exportName) {
	var at = title ? modules.exportedAt(title, exportName) : null;
	if(!at) {
		return null;
	}
	var starts = source.lineStarts($tw.wiki.getTiddlerText(title, "")),
		range = { start: source.positionAt(starts, at.start), end: source.positionAt(starts, at.end) };
	return { uri: source.documentUriOf(title), range: range, full: range };
}

/**
 * LocationLinks with the whole definition to peek at for a client that understands them, else the definition's name.
 * @param {object} call - { origin, targets }
 * @param {object} [options] - linkSupport
 * @returns {(object|object[])} Locations or links
 */
function respond(call, options) {
	if(options && options.linkSupport) {
		return call.targets.map(function(target) {
			return { originSelectionRange: call.origin, targetUri: target.uri, targetRange: target.full, targetSelectionRange: target.range };
		});
	}
	var locations = call.targets.map(function(target) { return { uri: target.uri, range: target.range }; });
	return locations.length === 1 ? locations[0] : locations;
}

/**
 * Go to definition: a call's definition, an operator's JavaScript, or the tiddler a link names.
 * @param {string} uri - document URI
 * @param {string} text - document text
 * @param {{line: number, character: number}} position - cursor
 * @param {object} [options] - linkSupport
 * @param {object} [openDocuments] - open documents by URI
 * @returns {(object|object[]|null)} Location, locations or links
 */
function definition(uri, text, position, options, openDocuments) {
	var call = callTargets(uri, text, position, openDocuments);
	if(call) {
		return call.targets.length ? respond(call, options) : null;
	}
	var operator = operatorTargets(uri, text, position);
	if(operator) {
		return respond(operator, options);
	}
	var target = targetAt(uri, text, position);
	if(!target) {
		return null;
	}
	// Any file of the tiddler, an image included, else its read-only view.
	var title = links.titleOfTarget(target),
		targetUri = source.uriOfTitle(title) || source.documentUriOf(title);
	if(!targetUri) {
		return null;
	}
	// The whole file is the definition, so the range is its first character.
	return {
		uri: targetUri,
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 }
		}
	};
}

exports.definition = definition;
exports.targetAt = targetAt;
