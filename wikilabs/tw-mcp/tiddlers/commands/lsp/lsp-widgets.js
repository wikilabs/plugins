/*\
title: $:/core/modules/commands/inspect/lsp/lsp-widgets.js
type: application/javascript
module-type: library

Hovering a widget: what it is, whether it exists, which module defines it, what
each attribute is worth, and which variables it introduces.

An attribute is not always a literal. It may be an indirect reference, a macro
call or a filtered value, and the interesting half is what those RESOLVE to at
this position, which only a booted wiki can say.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// Widgets whose every attribute becomes a variable of the same name, and those
// naming one variable in an attribute.
var VARIABLE_WIDGETS = { let: true, vars: true, parameters: true };
var NAMING_ATTRIBUTE = { set: "name", qualify: "name", wikify: "name" };

// The module that exports each widget name, built once. The widget modules
// have already been executed at boot to build widgetClasses, so this only
// reads what is cached.
var moduleByWidget = null;

function moduleOfWidget(name) {
	if(!moduleByWidget) {
		moduleByWidget = Object.create(null);
		var modules = $tw.modules.types.widget || {};
		for(var title in modules) {
			var exported = $tw.modules.execute(title);
			for(var key in exported) {
				if(!moduleByWidget[key]) {
					moduleByWidget[key] = title;
				}
			}
		}
	}
	return moduleByWidget[name] || null;
}

function isRegistered(name) {
	var classes = $tw.rootWidget && $tw.rootWidget.widgetClasses;
	return !!(classes && classes[name]);
}

// A \widget definition in scope takes over a tag the way makeChildWidget in
// core widget.js decides: always for a dotted name, and for a registered
// widget's name unless the wiki runs in safe mode.
function customWidgetOf(name, context) {
	if(!context || (name.indexOf(".") === -1 && !(isRegistered(name) && !$tw.safeMode))) {
		return null;
	}
	var info = context.getVariableInfo("$" + name, { allowSelfAssigned: true }),
		variable = info && info.srcVariable;
	return variable && variable.value && variable.isWidgetDefinition ? variable : null;
}

// Every widget written in angle-bracket syntax. A node's tag is what the author
// typed, so a widget nobody registered still appears here, which is the point:
// a misspelt widget name is silent in TiddlyWiki.
function widgetSites(tree, text) {
	var sites = [];
	source.eachNode(tree, function(node) {
		if(!node.tag || node.tag.charAt(0) !== "$" || node.start === undefined) {
			return;
		}
		// An <%if%> block is a $list nobody wrote; it gets a hover of its own.
		if(text !== undefined && calls.conditionalClauses(node, text)) {
			return;
		}
		sites.push({
			name: node.tag.slice(1),
			type: node.type,
			start: node.start,
			end: node.end,
			attributes: node.orderedAttributes || toOrdered(node.attributes)
		});
	});
	return sites;
}

function toOrdered(attributes) {
	var out = [];
	for(var name in attributes || {}) {
		out.push(attributes[name]);
	}
	return out;
}

// An attribute as the author wrote it, whatever its kind.
function writtenOf(attribute) {
	switch(attribute.type) {
		case "indirect":
			return "{{" + attribute.textReference + "}}";
		case "macro": {
			var variable = attribute.value && attribute.value.attributes && attribute.value.attributes.$variable;
			return "<<" + (variable ? variable.value : "") + ">>";
		}
		case "filtered":
			return "{{{" + attribute.filter + "}}}";
		case "substituted":
			return "`" + attribute.rawValue + "`";
		default:
			return attribute.value;
	}
}

// What an attribute is worth here. Only a string is its own value; the other
// three kinds are the ones a reader cannot evaluate by eye.
function resolveAttribute(attribute, context) {
	switch(attribute.type) {
		case "indirect":
			return {
				kind: "indirect",
				written: writtenOf(attribute),
				value: $tw.wiki.getTextReference(attribute.textReference, "", currentOf(context))
			};
		case "macro": {
			var variable = attribute.value && attribute.value.attributes && attribute.value.attributes.$variable;
			var name = variable ? variable.value : "";
			return {
				kind: "macro",
				written: writtenOf(attribute),
				value: context && name ? context.getVariable(name) : undefined
			};
		}
		case "filtered":
			return {
				kind: "filtered",
				written: writtenOf(attribute),
				value: $tw.wiki.filterTiddlers(attribute.filter, context || undefined).join(" ")
			};
		case "substituted":
			return {
				kind: "substituted",
				written: writtenOf(attribute),
				value: context ? $tw.wiki.getSubstitutedText(attribute.rawValue, context) : undefined
			};
		default:
			return { kind: attribute.type || "string", written: writtenOf(attribute), value: attribute.value };
	}
}

function currentOf(context) {
	return context ? context.getVariable("currentTiddler") : undefined;
}

// The variables this widget introduces, so a <$let> says what it binds.
function variablesOf(site) {
	var byName = {};
	site.attributes.forEach(function(attribute) {
		byName[attribute.name] = attribute;
	});
	if(VARIABLE_WIDGETS[site.name]) {
		// On $parameters a $ attribute configures the widget rather than naming one.
		return site.attributes.map(function(a) { return a.name; }).filter(function(name) {
			return site.name !== "parameters" || name.charAt(0) !== "$";
		});
	}
	var naming = NAMING_ATTRIBUTE[site.name];
	if(naming) {
		return literal(byName[naming]) ? [literal(byName[naming])] : [];
	}
	if(site.name === "list") {
		var names = [literal(byName.variable) || "currentTiddler"];
		if(literal(byName.counter)) {
			names.push(literal(byName.counter));
		}
		return names;
	}
	return site.name === "tiddler" ? ["currentTiddler"] : [];
}

function literal(attribute) {
	return attribute && attribute.type === "string" ? attribute.value : null;
}

exports.widgetSites = widgetSites;
exports.resolveAttribute = resolveAttribute;
exports.writtenOf = writtenOf;
exports.variablesOf = variablesOf;
exports.moduleOfWidget = moduleOfWidget;
exports.isRegistered = isRegistered;
exports.customWidgetOf = customWidgetOf;
