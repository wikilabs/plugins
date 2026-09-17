/*\
title: $:/core/modules/commands/inspect/lsp/lsp-names.js
type: application/javascript
module-type: library

Hints for calls whose name nothing defines, since TiddlyWiki renders a misspelt
name as silence. Variables are set while the wiki renders, out of a static
reader's sight, so a name also counts as known when any tiddler defines it,
declares it as a parameter or sets it with a widget, when a shadow tiddler calls
it, or when a JavaScript module hands it to action strings.

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

// A JavaScript module that may hand variables to wikitext, the names it sets, and
// the keys of its object literals.
var JS_SETS_VARIABLES = /invokeActionString|invokeActions|setVariable\s*\(/,
	SET_VARIABLE = /setVariable\(\s*(["'])([^"']+)\1/,
	OBJECT_KEY = /[{,]\s*(?:(["'])([\w.\-]+)\1|([A-Za-z_$][\w$]*))\s*:(?!:)/;

// A string value worth parsing as wikitext.
var HOLDS_WIKITEXT = /<\$|<<|^\s*\\(?:procedure|define|function|widget)\s/m;

// A quick fix offers names this close: typing slips, not a different name.
var MAX_DISTANCE = 2,
	MAX_DISTANCE_SHORT = 1,
	SHORT_NAME = 4,
	MAX_FIXES = 3;

function hints(uri, text) {
	return unknownSites(uri, text).map(diagnosticOf);
}

// The calls in a document whose name nothing in reach or in the wiki defines.
function unknownSites(uri, text) {
	var sites = files.sitesOfDocument(uri, text).filter(function(site) {
		return !site.definition && isCheckable(site.name);
	});
	if(!sites.length) {
		return [];
	}
	var body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text);
	return sites.filter(function(site) {
		return !inReach(site, body, tree) && !knownNames()[site.name];
	});
}

function diagnosticOf(site) {
	return {
		range: site.range,
		severity: SEVERITY_HINT,
		source: "tiddlywiki",
		message: site.name.charAt(0) === "$" ?
			"`" + site.name + "` is no widget, and no \\widget in this wiki defines it" :
			"`" + site.name + "` is not defined or set anywhere in this wiki"
	};
}

// Quick fixes for the hinted names inside range: each replaces the name with a
// close one that exists, a widget's closing tag included.
function codeActions(uri, text, range, context) {
	if(context && context.only && !context.only.some(function(kind) { return kind === "quickfix" || kind === ""; })) {
		return [];
	}
	var body = source.bodyOf(uri, text),
		tree = source.parseWithBodies(body.text),
		actions = [];
	unknownSites(uri, text).filter(function(site) {
		return overlaps(site.range, range);
	}).forEach(function(site) {
		var ranges = [site.range].concat(closingTagRange(site, body, tree) || []),
			diagnostic = reportedAs(diagnosticOf(site), context);
		closestNames(site.name, candidatesFor(site, body, tree)).forEach(function(name, index) {
			var changes = {};
			changes[uri] = ranges.map(function(where) {
				return { range: where, newText: name };
			});
			actions.push({
				title: "Change to " + name,
				kind: "quickfix",
				diagnostics: [diagnostic],
				isPreferred: index === 0,
				edit: { changes: changes }
			});
		});
	});
	return actions;
}

// The editor's own copy of the diagnostic, which listing undefined calls reported
// as information, so the fix attaches to the entry the editor shows.
function reportedAs(diagnostic, context) {
	return ((context && context.diagnostics) || []).filter(function(given) {
		return given.message === diagnostic.message && !before(given.range.start, diagnostic.range.start) && !before(diagnostic.range.start, given.range.start);
	})[0] || diagnostic;
}

function overlaps(a, b) {
	return !before(a.end, b.start) && !before(b.end, a.start);
}

function before(p, q) {
	return p.line < q.line || (p.line === q.line && p.character < q.character);
}

// The name in </$name> when the widget written at site has a closing tag.
function closingTagRange(site, body, tree) {
	if(site.name.charAt(0) !== "$") {
		return null;
	}
	var found = null,
		closing = "</" + site.name + ">";
	source.eachNode(tree, function(node) {
		if(node.tag === site.name && node.start === site.start - 1 && body.text.slice(node.end - closing.length, node.end) === closing) {
			var at = body.offset + node.end - closing.length + 2;
			found = { start: source.positionAt(body.starts, at), end: source.positionAt(body.starts, at + site.name.length) };
		}
	});
	return found;
}

// Names the call could mean, what is in reach first: a widget tag is offered
// widgets, any other call the names the wiki defines or sets.
function candidatesFor(site, body, tree) {
	var near = [],
		far = Object.keys(knownNames());
	if(site.name.charAt(0) === "$") {
		near = Object.keys(($tw.rootWidget && $tw.rootWidget.widgetClasses) || {}).map(function(name) { return "$" + name; });
	} else {
		near = scope.bindingsAt(site.start, tree, body.text).map(function(binding) { return binding.name; })
			.concat(calls.sitesIn(body.text).definitions.map(function(definition) { return definition.name; }))
			.concat(calls.globalDefinitions().map(function(global) { return global.definition.name; }))
			.concat(Object.keys($tw.macros || {}), filters.CORE_VARIABLES);
	}
	return near.concat(far).filter(function(name) {
		return (name.charAt(0) === "$") === (site.name.charAt(0) === "$");
	});
}

// The closest candidates within reach of a typing slip, nearer first, then in
// candidate order; each name once.
function closestNames(name, candidates) {
	var limit = name.length <= SHORT_NAME ? MAX_DISTANCE_SHORT : MAX_DISTANCE,
		scored = [],
		seen = Object.create(null);
	candidates.forEach(function(candidate, order) {
		if(seen[candidate] || candidate === name) {
			return;
		}
		seen[candidate] = true;
		var distance = editDistance(name, candidate, limit);
		if(distance <= limit) {
			scored.push({ name: candidate, distance: distance, order: order });
		}
	});
	return scored.sort(function(a, b) {
		return a.distance - b.distance || a.order - b.order;
	}).slice(0, MAX_FIXES).map(function(entry) {
		return entry.name;
	});
}

// Insertions, deletions, substitutions and swaps of neighbours needed to turn a
// into b, or limit + 1 once it is certain to exceed limit.
function editDistance(a, b, limit) {
	if(Math.abs(a.length - b.length) > limit) {
		return limit + 1;
	}
	var rows = [];
	for(var i = 0; i <= a.length; i++) {
		rows[i] = [i];
	}
	for(var j = 1; j <= b.length; j++) {
		rows[0][j] = j;
	}
	for(i = 1; i <= a.length; i++) {
		var best = limit + 1;
		for(j = 1; j <= b.length; j++) {
			var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
			rows[i][j] = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
			if(i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) {
				rows[i][j] = Math.min(rows[i][j], rows[i - 2][j - 2] + 1);
			}
			best = Math.min(best, rows[i][j]);
		}
		if(best > limit) {
			return limit + 1;
		}
	}
	return rows[a.length][b.length];
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
		function add(name) {
			known[name] = true;
		}
		$tw.wiki.each(function(tiddler, title) {
			namesSetBy(title).forEach(add);
		});
		$tw.wiki.eachShadow(function(tiddler, title) {
			if(!$tw.wiki.tiddlerExists(title)) {
				namesSetBy(title).forEach(add);
				calls.sitesOfTiddler(title).calls.forEach(function(site) {
					add(site.name);
				});
			}
		});
		namesSetByJavaScript().forEach(add);
		return known;
	});
}

// Names JavaScript hands to wikitext: those given to setVariable, and the keys of
// the object literals in a module that runs action strings, where the variables
// they receive are built (actionValue, status, ...).
function namesSetByJavaScript() {
	var names = [];
	$tw.utils.each($tw.modules.titles, function(info, title) {
		var text = widgets.moduleCode(title);
		if(typeof text !== "string" || !JS_SETS_VARIABLES.test(text)) {
			return;
		}
		eachMatch(SET_VARIABLE, text, function(match) {
			names.push(match[2]);
		});
		eachMatch(OBJECT_KEY, text, function(match) {
			names.push(match[2] || match[3]);
		});
	});
	return names;
}

function eachMatch(pattern, text, fn) {
	var regexp = new RegExp(pattern.source, "g"),
		match;
	while((match = regexp.exec(text)) !== null) {
		fn(match);
	}
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
		namesSetIn(tiddler.fields.text || "", names);
		return names;
	});
}

// What text defines or sets, looking into definition bodies and into string values
// holding wikitext, such as an example's src. The attributes of <$action-sendmessage>
// count too: tm-modal and tm-open-window hand them on as variables.
function namesSetIn(text, names) {
	source.eachNode($tw.wiki.parseText(source.WIKITEXT_TYPE, text).tree, function(node) {
		var body = calls.definitionBody(node, text);
		if(body) {
			names.push(node.attributes.name.value);
			(node.params || []).forEach(function(param) {
				names.push(param.name);
			});
			if(body.kind !== "function") {
				namesSetIn(body.text, names);
			}
			return;
		}
		if(node.tag && node.tag.charAt(0) === "$") {
			widgets.variablesOf({ name: node.tag.slice(1), attributes: node.orderedAttributes || [] }).forEach(function(name) {
				names.push(name);
			});
			if(node.tag === "$action-sendmessage") {
				(node.orderedAttributes || []).forEach(function(attribute) {
					if(attribute.name.charAt(0) !== "$") {
						names.push(attribute.name);
					}
				});
			}
		}
		Object.keys(node.attributes || {}).forEach(function(key) {
			var attribute = node.attributes[key];
			if(attribute.type === "string" && HOLDS_WIKITEXT.test(attribute.value)) {
				namesSetIn(attribute.value, names);
			}
		});
	});
}

exports.hints = hints;
exports.codeActions = codeActions;
exports.closingTagRange = closingTagRange;
