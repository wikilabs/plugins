/*\
title: $:/core/modules/commands/inspect/lsp/lsp-scope.js
type: application/javascript
module-type: library

What binds a name at a position: a parameter of the definition whose body holds
it, or a variable set by a widget around it. TiddlyWiki looks a name up the same
way when it renders, innermost first, so either one hides any definition of the
same name.

\*/

"use strict";

var calls = require("$:/core/modules/commands/inspect/calls.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js");

// The first source offset anywhere below nodes: where a widget's content starts.
function firstStart(nodes) {
	for(var i = 0; i < (nodes || []).length; i++) {
		if(nodes[i].start !== undefined) {
			return nodes[i].start;
		}
		var inner = firstStart(nodes[i].children);
		if(inner !== undefined) {
			return inner;
		}
	}
	return undefined;
}

// Every definition body and widget content holding offset, innermost first. A
// widget's own attributes lie outside its scope: what it binds reaches its
// content only.
function scopesAt(tree, text, offset) {
	var scopes = [];
	(function walk(nodes) {
		for(var i = 0; i < (nodes || []).length; i++) {
			var node = nodes[i],
				body = calls.definitionBody(node, text);
			if(body && offset >= body.start && offset < body.start + body.text.length) {
				scopes.push({ node: node, definition: true, start: body.start, end: body.start + body.text.length });
			} else if(node.tag && node.start !== undefined && offset < node.end) {
				var content = firstStart(node.children);
				if(content !== undefined && offset >= content) {
					scopes.push({ node: node, definition: false, start: content, end: node.end });
				}
			}
			walk(node.children);
		}
	})(tree);
	return scopes.reverse();
}

// The binding of name at offset, or null when nothing in the document binds it
// there. offset and the result's ranges are offsets into text.
function resolve(name, offset, tree, text) {
	var scopes = scopesAt(tree, text, offset);
	for(var i = 0; i < scopes.length; i++) {
		var scope = scopes[i],
			node = scope.node;
		if(scope.definition) {
			var param = (node.params || []).filter(function(p) { return p.name === name; })[0];
			if(param) {
				return {
					kind: "parameter",
					name: name,
					of: node.attributes.name.value,
					value: param["default"],
					scope: scope,
					declaration: parameterDeclaration(node, text, name)
				};
			}
		} else if(widgets.variablesOf({ name: node.tag.slice(1), attributes: node.orderedAttributes || [] }).includes(name)) {
			return {
				kind: "variable",
				name: name,
				by: calls.conditionalClauses(node, text) ? "<%if%>" : "<" + node.tag + ">",
				scope: scope,
				declaration: variableDeclaration(node, text, name)
			};
		}
	}
	return null;
}

// A parameter is declared between the parentheses on the pragma's first line.
function parameterDeclaration(node, text, name) {
	var line = text.slice(node.start, node.end).split("\n")[0],
		match = new RegExp("[(,\\s]" + $tw.utils.escapeRegExp(name) + "(?=\\s*[:,)])").exec(line);
	return match ? { start: node.start + match.index + 1, end: node.start + match.index + 1 + name.length } : null;
}

// Where a widget names the variable: a $let or $vars attribute of that name, or
// the value of a name, variable or counter attribute.
function variableDeclaration(node, text, name) {
	var attributes = node.attributes || {},
		holder = attributes[name] && ["$let", "$vars", "$parameters"].includes(node.tag) ? attributes[name] : null;
	["name", "variable", "counter"].forEach(function(key) {
		if(!holder && attributes[key] && attributes[key].type === "string" && attributes[key].value === name) {
			holder = attributes[key];
		}
	});
	if(!holder || holder.start === undefined) {
		return null;
	}
	var slice = text.slice(holder.start, holder.end),
		at = holder.name === name ? slice.indexOf(name) : slice.lastIndexOf(name);
	return at < 0 ? null : { start: holder.start + at, end: holder.start + at + name.length };
}

exports.resolve = resolve;
