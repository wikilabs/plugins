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
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js");

// Widgets whose every attribute becomes a variable of the same name, and those
// naming one variable in an attribute.
var VARIABLE_WIDGETS = { let: true, vars: true, parameters: true };
var NAMING_ATTRIBUTE = { set: "name", qualify: "name", wikify: "name" };

// The attributes each widget's code treats as a tiddler title, in the wiki's global cache.
var TITLE_ATTRIBUTES_CACHE_KEY = "tw-lsp-title-attributes";

// Wiki and tiddler methods whose first argument is a title.
var TITLE_CALLS = "(?:getTiddler|getTiddlerText|tiddlerExists|isShadowTiddler|getTiddlerDataCached|getTiddlerData|deleteTiddler|parseTiddler|getTiddlerList|getTiddlerAsJson|renderTiddler|getCacheForTiddler|isDraftModified|getChangeCount|findDraft|generateDraftTitle|getTiddlersWithTag|sortByList|setText|setTiddlerData)\\(\\s*";

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
		var names = [literal(byName.variable) || "currentTiddler"],
			counter = literal(byName.counter);
		// Core list.js sets <counter>-first and <counter>-last beside the counter.
		if(counter) {
			names.push(counter, counter + "-first", counter + "-last");
		}
		return names;
	}
	return site.name === "tiddler" ? ["currentTiddler"] : [];
}

function literal(attribute) {
	return attribute && attribute.type === "string" ? attribute.value : null;
}

// The attributes a registered widget's code treats as a tiddler title. TiddlyWiki describes attributes
// nowhere else, so it is read from how the code uses each one.
function titleAttributes(name) {
	var cache = $tw.wiki.getGlobalCache(TITLE_ATTRIBUTES_CACHE_KEY, function() { return Object.create(null); });
	if(!cache[name]) {
		var title = isRegistered(name) ? modules.moduleOfWidget(name) : null;
		cache[name] = title ? titleAttributesIn(codeWithRequired(title)) : [];
	}
	return cache[name];
}

// A module's code followed by the libraries it requires, since a widget may read its attributes in a
// shared factory, as edit-text does. A required widget module describes another widget.
function codeWithRequired(title) {
	var code = moduleCode(title),
		required = /require\(\s*["']([^"']+)["']\s*\)/g,
		match,
		all = code;
	while((match = required.exec(code)) !== null) {
		var info = $tw.modules.titles[match[1]];
		if(info && info.moduleType !== "widget") {
			all += "\n" + moduleCode(match[1]);
		}
	}
	return all;
}

// The code that runs: the definition the module was made from, not a tiddler edited since.
function moduleCode(title) {
	var info = $tw.modules.titles[title];
	return info && typeof info.definition === "string" ? info.definition : $tw.wiki.getTiddlerText(title, "");
}

// An attribute read on a line that falls back to the current tiddler, or kept in a property or variable
// that is used as a title, directly or through one more variable.
function titleAttributesIn(code) {
	var found = [],
		match;
	function add(attribute) {
		if(!found.includes(attribute)) {
			found.push(attribute);
		}
	}
	code.split("\n").forEach(function(line) {
		if(/getVariable\(\s*"currentTiddler"/.test(line)) {
			eachMatch(/getAttribute\(\s*"([^"]+)"/g, line, function(read) {
				add(read[1]);
			});
		}
	});
	var kept = /(?:(?:var|let|const|,)\s*|this\.)([\w$]+)\s*=\s*(?:self|this)\.getAttribute\(\s*"([^"]+)"/g;
	while((match = kept.exec(code)) !== null) {
		var holder = (match[0].startsWith("this.") ? "this\\." : "\\b") + $tw.utils.escapeRegExp(match[1]),
			used = usedAsTitle(code, holder),
			aliases = new RegExp("(?:(?:var|let|const|,)\\s*|[;{(\\s])([\\w$]+)\\s*=\\s*" + holder + "\\b", "g"),
			alias;
		while(!used && (alias = aliases.exec(code)) !== null) {
			used = usedAsTitle(code, "\\b" + $tw.utils.escapeRegExp(alias[1]));
		}
		if(used) {
			add(match[2]);
		}
	}
	return found;
}

function usedAsTitle(code, expression) {
	return new RegExp(TITLE_CALLS + expression + "\\s*[,)]|\\btitle:\\s*" + expression + "\\b|navigateTo:\\s*" + expression +
		"\\b|\\$?tiddler:\\s*\\{\\s*type:\\s*\"string\",\\s*value:\\s*" + expression + "\\b|setVariable\\(\\s*\"currentTiddler\"\\s*,\\s*" + expression + "\\b").test(code);
}

function eachMatch(pattern, text, fn) {
	var match;
	while((match = pattern.exec(text)) !== null) {
		fn(match);
	}
}

exports.widgetSites = widgetSites;
exports.resolveAttribute = resolveAttribute;
exports.writtenOf = writtenOf;
exports.variablesOf = variablesOf;
exports.isRegistered = isRegistered;
exports.customWidgetOf = customWidgetOf;
exports.titleAttributes = titleAttributes;
