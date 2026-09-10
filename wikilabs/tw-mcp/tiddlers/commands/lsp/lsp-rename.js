/*\
title: $:/core/modules/commands/inspect/lsp/lsp-rename.js
type: application/javascript
module-type: library

Rename: a definition with every call that reaches it, in every file, or a
parameter with its uses, its $param$ substitutions and the named arguments that
fill it. What cannot be renamed safely is refused with the reason.

A parameter can be read by a definition its body calls, which no parse shows,
so parameter edits always open the editor's preview first.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null;

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	references = require("$:/core/modules/commands/inspect/lsp/lsp-references.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// A name a call can write: nothing that ends a name or starts an argument.
var VALID_NAME = /^[^\s<>"'`=:\/|\[\]{}]+$/;

var CONFIRM = "tw-rename-confirm";

// What F2 would rename, as { range, placeholder }, or { error }.
function prepareRename(uri, text, position, openDocuments) {
	var plan = planAt(uri, text, position, openDocuments);
	return plan.error ? plan : { range: plan.origin, placeholder: plan.name };
}

// The WorkspaceEdit renaming what is at position to newName, or { error }.
function rename(uri, text, position, newName, options, openDocuments) {
	var plan = planAt(uri, text, position, openDocuments),
		refused = plan.error || refusal(plan, newName);
	return refused ? { error: refused } : workspaceEdit(plan, newName, uri, options);
}

function planAt(uri, text, position, openDocuments) {
	var documents = Object.assign({}, openDocuments);
	documents[uri] = text;
	var load = loader(documents),
		doc = load(uri),
		site = files.siteAt(doc.sites, position),
		declared = site ? null : parameterDeclaredAt(doc, source.offsetAt(doc.body.starts, position) - doc.body.offset);
	if(declared) {
		return parameterPlan(load, documents, doc, declared.definition, declared.name);
	}
	if(!site) {
		return { error: "Nothing to rename here: put the cursor on a call, a definition's name or a parameter." };
	}
	if(filters.CORE_VARIABLES.includes(site.name)) {
		return { error: "`" + site.name + "` is set by TiddlyWiki itself." };
	}
	var binding = site.definition || site.start < 0 ? null : scope.resolve(site.name, site.start, doc.tree, doc.body.text);
	if(binding && binding.kind === "variable") {
		return { error: "`" + site.name + "` is set by " + binding.by + ": renaming a widget's variable is not supported, since definitions it calls can read it too." };
	}
	if(binding) {
		return parameterPlan(load, documents, doc, doc.definitions.filter(function(d) { return d.body && d.body.start === binding.scope.start; })[0], site.name);
	}
	return definitionPlan(load, documents, doc, site);
}

// Each document read once: open buffer, else the file, else a tiddler's view.
function loader(documents) {
	var cache = Object.create(null);
	return function(docUri) {
		var key = files.sameFileKey(docUri);
		if(!cache[key]) {
			var text = textOf(docUri, documents),
				body = source.bodyOf(docUri, text);
			cache[key] = {
				uri: docUri,
				text: text,
				body: body,
				tree: source.parseWithBodies(body.text),
				sites: files.sitesOfDocument(docUri, text),
				definitions: calls.sitesIn(body.text).definitions,
				title: source.titleOfDocument(docUri, text)
			};
		}
		return cache[key];
	};
}

function textOf(docUri, documents) {
	var open = Object.keys(documents).filter(function(key) { return files.sameFileKey(key) === files.sameFileKey(docUri); })[0];
	if(open !== undefined) {
		return documents[open];
	}
	return source.isVirtualUri(docUri) ? source.virtualText(source.titleOfVirtualUri(docUri)) : fs.readFileSync(source.uriToPath(docUri), "utf8");
}

function rangeIn(doc, start, end) {
	return { start: source.positionAt(doc.body.starts, doc.body.offset + start), end: source.positionAt(doc.body.starts, doc.body.offset + end) };
}

// --- Definitions ---

function definitionPlan(load, documents, doc, site) {
	var target = site.definition ? { doc: doc, definition: doc.definitions.filter(function(d) { return d.start === site.start; })[0] } : definitionOfCall(load, doc, site);
	if(target.error) {
		return target;
	}
	var defDoc = target.doc,
		def = target.definition;
	if(def.kind === "widget") {
		return { error: "Renaming a \\widget is not supported yet: its closing tags are not tracked." };
	}
	var global = def.parent === null && calls.importedGlobally(defDoc.title),
		found = callsTo(load, documents, defDoc, def, global);
	if(found.error) {
		return found;
	}
	return {
		kind: "definition",
		name: def.name,
		origin: site.range,
		edits: [{ uri: defDoc.uri, range: rangeIn(defDoc, def.start, def.end) }].concat(found.calls.map(function(call) {
			return { uri: call.doc.uri, range: call.site.range };
		})),
		conflict: function(newName) {
			if(newName.charAt(0) === "$") {
				return "A name starting with $ is a widget's.";
			}
			if(def.kind === "function" && def.name.includes(".") && !newName.includes(".")) {
				return "`" + def.name + "` can be called as a filter operator, which needs a dot in the name.";
			}
			if(defDoc.definitions.some(function(d) { return d.name === newName && d.parent === def.parent; })) {
				return "`" + newName + "` is already defined beside `" + def.name + "` in `" + defDoc.title + "`.";
			}
			var existing = global ? calls.globalDefinition(newName) : null;
			if(existing) {
				return "`" + newName + "` is already a global, defined in `" + existing.title + "`.";
			}
			return visibleAt(found.calls, newName);
		}
	};
}

// The definition a call reaches, in the document that holds it, or { error }.
function definitionOfCall(load, doc, site) {
	var found = macros.findDefinition(site.name, doc.body.text, site.start);
	if(!found) {
		return { error: "`" + site.name + "` is not defined anywhere TiddlyWiki would look from here." };
	}
	if(found.kind === "javascript") {
		return { error: "`" + site.name + "` is a JavaScript macro, defined in code." };
	}
	if(found.title === null) {
		return { doc: doc, definition: found.site };
	}
	var where = source.documentUriOf(found.title);
	if(!where || source.isVirtualUri(where)) {
		return { error: "`" + site.name + "` is defined in `" + found.title + "`, a tiddler without a file of its own, which cannot be edited." };
	}
	var defDoc = load(where),
		definition = defDoc.definitions.filter(function(d) { return d.parent === null && d.name === site.name; }).pop();
	return definition ? { doc: defDoc, definition: definition } : { error: "`" + site.name + "` is no longer defined in the file of `" + found.title + "`." };
}

// Every call that reaches def: in its own document by the resolver, and for a
// global in every other document whose call TiddlyWiki would send to its title.
function callsTo(load, documents, defDoc, def, global) {
	var found = [],
		error = null;
	defDoc.sites.forEach(function(site) {
		if(!site.definition && site.name === def.name && (site.start < 0 ? global : reaches(defDoc, site, def))) {
			found.push({ doc: defDoc, site: site });
		}
	});
	if(global) {
		files.sitesNamed(def.name, documents).forEach(function(hit) {
			if(hit.site.definition || files.sameFileKey(hit.uri) === files.sameFileKey(defDoc.uri)) {
				return;
			}
			var doc = load(hit.uri);
			if(!callsGlobal(doc, hit.site, defDoc.title)) {
				return;
			}
			if(source.isVirtualUri(hit.uri)) {
				error = error || "`" + def.name + "` is called in `" + doc.title + "`, a tiddler without a file of its own, which cannot be edited.";
			}
			found.push({ doc: doc, site: hit.site });
		});
	}
	return error ? { error: error } : { calls: found };
}

function reaches(doc, site, def) {
	if(scope.resolve(site.name, site.start, doc.tree, doc.body.text)) {
		return false;
	}
	var local = macros.localDefinition(site.name, doc.definitions, site.start);
	return !!local && local.start === def.start;
}

function callsGlobal(doc, site, title) {
	if(site.start >= 0 && scope.resolve(site.name, site.start, doc.tree, doc.body.text)) {
		return false;
	}
	var found = macros.findDefinition(site.name, doc.body.text, site.start);
	return !!found && found.title === title;
}

// A call that newName would already reach: renaming would hand it the wrong definition.
function visibleAt(found, newName) {
	for(var i = 0; i < found.length; i++) {
		var doc = found[i].doc,
			site = found[i].site;
		if(macros.findDefinition(newName, doc.body.text, site.start) || (site.start >= 0 && scope.resolve(newName, site.start, doc.tree, doc.body.text))) {
			return "`" + newName + "` already means something where it would be called, in `" + doc.title + "` line " + (site.range.start.line + 1) + ".";
		}
	}
	return null;
}

// --- Parameters ---

// A parameter under the cursor in a definition's head, as { definition, name }.
function parameterDeclaredAt(doc, cursor) {
	for(var i = 0; i < doc.definitions.length; i++) {
		var definition = doc.definitions[i];
		for(var p = 0; p < definition.params.length; p++) {
			var at = declarationOf(doc, definition, definition.params[p].name);
			if(at && cursor >= at.start && cursor <= at.end) {
				return { definition: definition, name: definition.params[p].name };
			}
		}
	}
	return null;
}

// Where a parameter is declared, between the parentheses on the head line.
function declarationOf(doc, definition, name) {
	var head = doc.body.text.slice(definition.range.start, definition.range.end).split("\n")[0],
		match = new RegExp("[(,\\s]" + $tw.utils.escapeRegExp(name) + "(?=\\s*[:,)])").exec(head);
	return match ? { start: definition.range.start + match.index + 1, end: definition.range.start + match.index + 1 + name.length } : null;
}

function parameterPlan(load, documents, doc, definition, name) {
	if(!definition || definition.kind === "widget") {
		return { error: "Renaming a \\widget's parameters is not supported yet: its attributes are not tracked." };
	}
	var declared = declarationOf(doc, definition, name),
		binding = definition.body ? scope.resolve(name, definition.body.start, doc.tree, doc.body.text) : null,
		edits = [{ uri: doc.uri, range: rangeIn(doc, declared.start, declared.end) }];
	(binding ? references.scopedUses(doc.sites, binding, doc.tree, doc.body) : []).forEach(function(range) {
		edits.push({ uri: doc.uri, range: range });
	});
	// A \define substitutes $name$ and $(name)$ into its body as text.
	if(definition.kind === "macro" && definition.body) {
		var text = doc.body.text.slice(definition.body.start, definition.body.end),
			pattern = new RegExp("\\$(\\(?)" + $tw.utils.escapeRegExp(name) + "\\)?\\$", "g"),
			match;
		while((match = pattern.exec(text)) !== null) {
			var start = definition.body.start + match.index + 1 + match[1].length;
			edits.push({ uri: doc.uri, range: rangeIn(doc, start, start + name.length) });
		}
	}
	var global = definition.parent === null && calls.importedGlobally(doc.title),
		found = callsTo(load, documents, doc, definition, global);
	if(found.error) {
		return found;
	}
	found.calls.forEach(function(call) {
		var at = namedArgument(call.doc, call.site, name);
		if(at !== null) {
			edits.push({ uri: call.doc.uri, range: rangeIn(call.doc, at, at + name.length) });
		}
	});
	return {
		kind: "parameter",
		name: name,
		origin: rangeIn(doc, declared.start, declared.end),
		edits: edits.map(function(edit) { return Object.assign(edit, { confirm: true }); }),
		conflict: function(newName) {
			if(definition.params.some(function(param) { return param.name === newName; })) {
				return "`" + newName + "` is already a parameter of `" + definition.name + "`.";
			}
			if(definition.body && doc.sites.some(function(site) { return site.name === newName && site.start >= definition.body.start && site.start < definition.body.end; })) {
				return "`" + newName + "` is already used inside `" + definition.name + "`, and would then mean the parameter.";
			}
			return null;
		}
	};
}

// Where a call names this parameter as an argument (tag: or tag=), or null.
function namedArgument(doc, site, name) {
	var call = macros.callSites(doc.tree).filter(function(c) { return c.start <= site.start && site.start < c.end; })[0],
		arg = call ? call.args.filter(function(a) { return a.name === name; })[0] : null;
	return arg && arg.start !== undefined ? arg.start + /^\s*/.exec(doc.body.text.slice(arg.start))[0].length : null;
}

// --- The answer ---

function refusal(plan, newName) {
	if(!VALID_NAME.test(newName)) {
		return "`" + newName + "` is not a name a call can write.";
	}
	if(filters.CORE_VARIABLES.includes(newName)) {
		return "`" + newName + "` is set by TiddlyWiki itself.";
	}
	return plan.conflict(newName);
}

// Edits outside the asking document, and every parameter edit, open the
// editor's preview first when the client supports change annotations.
function workspaceEdit(plan, newName, uri, options) {
	var byKey = Object.create(null),
		order = [],
		annotate = !!(options && options.annotations);
	plan.edits.forEach(function(edit) {
		var key = files.sameFileKey(edit.uri);
		if(!byKey[key]) {
			byKey[key] = { uri: edit.uri, edits: [] };
			order.push(key);
		}
		var text = { range: edit.range, newText: newName };
		if(annotate && (edit.confirm || key !== files.sameFileKey(uri))) {
			text.annotationId = CONFIRM;
		}
		byKey[key].edits.push(text);
	});
	if(!annotate) {
		var changes = {};
		order.forEach(function(key) { changes[byKey[key].uri] = byKey[key].edits; });
		return { changes: changes };
	}
	var annotations = {};
	annotations[CONFIRM] = {
		label: "Rename `" + plan.name + "` to `" + newName + "`",
		description: plan.kind === "parameter" ? "Definitions its body calls can read a parameter too, which rename cannot see." : "In another tiddler",
		needsConfirmation: true
	};
	return {
		documentChanges: order.map(function(key) {
			return { textDocument: { uri: byKey[key].uri, version: null }, edits: byKey[key].edits };
		}),
		changeAnnotations: annotations
	};
}

exports.prepareRename = prepareRename;
exports.rename = rename;
