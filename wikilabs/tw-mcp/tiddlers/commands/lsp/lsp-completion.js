/*\
title: $:/core/modules/commands/inspect/lsp/lsp-completion.js
type: application/javascript
module-type: library

Completion: tiddler titles inside [[...]], {{...}} and widget attributes that take
one, and names where TiddlyWiki expects one (calls, widgets, parameters,
variables, operators, and the tags and fields a filter step names).

This one cannot use the parser, and that is not a compromise: at the moment
completion is asked for, the text reads "[[LSP Ser" with no closing bracket, and
TiddlyWiki parses that as a single text node. Incomplete input is the whole
point of completion, so the cursor context is read from the raw text.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	symbols = require("$:/core/modules/commands/inspect/lsp/lsp-symbols.js"),
	typing = require("$:/core/modules/commands/inspect/lsp/lsp-typing.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js"),
	modules = require("$:/core/modules/commands/inspect/modules.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js");

// LSP CompletionItemKind.
var KIND_FUNCTION = 3,
	KIND_FIELD = 5,
	KIND_VARIABLE = 6,
	KIND_CLASS = 7,
	KIND_PROPERTY = 10,
	KIND_OPERATOR = 24;

// Cap on one response. A wiki of any size would otherwise send its whole title
// list on the first "[[".
var MAX_COMPLETIONS = 200;

// Shortest prefix worth answering. VS Code asks again on the next keystroke only
// if the last answer had items, so one character must already produce a list.
var MIN_PREFIX = 1;

var KIND_REFERENCE = 18;

// A tiddler title separates its words with more than spaces: lsp_link_target
// and $:/core/ui/PageTemplate are each several words to a reader.
var WORD_SEPARATORS = /[\s_\-/:.]+/;

// How an operator's code uses its operand or suffix as a tag or a field name; TiddlyWiki describes
// operators nowhere else. For core these find exactly what the tw5.com docs say (op-parameter, op-suffix).
var OPERAND_USES = {
	tagOperand: [/\b(?:getTiddlersWithTag|hasTag)\(\s*operator\.operand\s*\)/],
	fieldOperand: [
		/\b\w*field\w*\s*=\s*operator\.operand\b/i,
		/\b(?:getFieldString|getFieldList|hasField)\(\s*operator\.operand\s*[,)]/,
		/\bfields\s*,\s*operator\.operand\b|\bfields\[\s*operator\.operand\s*\]/,
		/\bsortTiddlers\(\s*\w+\s*,\s*operator\.operand\b/
	],
	fieldSuffix: [
		/\b\w*field\w*\s*=\s*operator\.suffix\b/i,
		/\b(?:getFieldString|getFieldList|hasField)\(\s*operator\.suffix\s*[,)]/
	]
};

// What each operator's code was found to use, in the wiki's global cache.
var OPERAND_USE_CACHE_KEY = "tw-lsp-operand-uses";

// Every field name with how many tiddlers have it, in the wiki's global cache, which every change clears.
var FIELD_CACHE_KEY = "tw-lsp-field-names";

// What the cursor sits inside, or null when it is not inside an open link.
// Only an UNCLOSED opener counts, so a cursor after a finished [[link]] gets
// nothing rather than the whole title list.
function linkContext(lineText, character) {
	var upto = lineText.slice(0, character),
		link = upto.lastIndexOf("[["),
		trans = upto.lastIndexOf("{{");
	var opener = Math.max(link, trans);
	if(opener < 0) {
		return null;
	}
	var isLink = link > trans;
	var closer = isLink ? "]]" : "}}";
	if(upto.indexOf(closer, opener + 2) >= 0) {
		return null;
	}
	// A filtered transclusion is a filter, not a title. lastIndexOf lands on the
	// SECOND brace of "{{{", so the third is looked for on either side.
	if(!isLink && (upto.charAt(opener + 2) === "{" || upto.charAt(opener - 1) === "{")) {
		return null;
	}
	var start = opener + 2,
		typed = upto.slice(start);
	var pipe = typed.lastIndexOf("|");
	if(pipe >= 0) {
		start = start + pipe + 1;
		typed = typed.slice(pipe + 1);
	}
	// Past a !! the user is naming a field, which this does not complete.
	if(typed.includes("!!") || typed.includes("##")) {
		return null;
	}
	return { start: start, prefix: typed };
}

// System titles stay out of the way until the prefix asks for them, matching
// how the MCP tools treat $:/ by default.
function candidateTitles(prefix) {
	if(prefix.startsWith("$:/")) {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]]");
	}
	return $tw.wiki.filterTiddlers("[!is[system]!has[draft.of]]");
}

// Matching is by PREFIX, never by substring: typing "ink" must not offer
// lsp_link_target, because nobody looks for a title by its middle.
function anyWordStartsWith(lower, term) {
	if(lower.startsWith(term)) {
		return true;
	}
	var words = lower.split(WORD_SEPARATORS);
	for(var i = 0; i < words.length; i++) {
		if(words[i].startsWith(term)) {
			return true;
		}
	}
	return false;
}

function matchesEveryTerm(lower, terms) {
	for(var i = 0; i < terms.length; i++) {
		if(!anyWordStartsWith(lower, terms[i])) {
			return false;
		}
	}
	return true;
}

// A title opening with everything typed ranks above one merely beginning those
// words elsewhere, so "LS S" reaches "LSP Server" without displacing a closer
// match, and "LS " keeps its list because a space starts the next word.
function rankTitles(titles, prefix) {
	var needle = prefix.toLowerCase(),
		terms = needle.split(/\s+/).filter(function(t) { return t; }),
		starts = [],
		wordwise = [];
	for(var i = 0; i < titles.length; i++) {
		var lower = titles[i].toLowerCase();
		if(lower.startsWith(needle)) {
			starts.push(titles[i]);
		} else if(terms.length && matchesEveryTerm(lower, terms)) {
			wordwise.push(titles[i]);
		}
	}
	return starts.concat(wordwise);
}

// --- Names ---

// What the cursor is naming, as { start, candidates } with start in body
// offsets: an operator, variable or function in a filter on this line; else a
// call's or widget's name, a name given as $variable or $name, or a parameter
// the call has not been given yet.
function wanted(body, offset, upto) {
	var filter = typing.filterAt(body.text, offset, upto);
	if(filter !== null) {
		var at = typing.filterPosition(filter),
			suffixed = at.state === "name" ? /^!?([\w\-]+):([\w.\-]*)$/.exec(at.word) : null;
		if(suffixed && operandUse(suffixed[1]).fieldSuffix) {
			return { start: offset - suffixed[2].length, candidates: fieldCandidates() };
		}
		if(at.state === "operand" && at.opener === "[" && at.index === 0) {
			var step = /^!?([\w.\-]*)(?::(.*))?$/.exec(at.operator) || [],
				use = operandUse(step[1] || "");
			if(use.tagOperand) {
				return { start: offset - at.word.length, candidates: tagCandidates(at.word) };
			}
			// has:index names an index, which its code tells apart only by comparing the suffix.
			if(use.fieldOperand && !(step[1] === "has" && step[2] === "index")) {
				return { start: offset - at.word.length, candidates: fieldCandidates() };
			}
		}
		if(at.state === "name" && /^!?[\w.\-]*$/.test(at.word)) {
			return { start: offset - at.word.replace(/^!/, "").length, candidates: operatorCandidates(body.text, offset) };
		}
		if(at.state === "operand" && (at.opener === "<" || (at.opener === "[" && at.operator === "function"))) {
			return {
				start: offset - at.word.length,
				candidates: nameCandidates(body.text, offset).filter(function(candidate) {
					return at.opener === "<" ? candidate.definition !== "widget" : candidate.definition === "function";
				})
			};
		}
		return null;
	}
	var call = typing.callContext(body.text, offset);
	if(!call) {
		return null;
	}
	if(call.inName) {
		return { start: call.nameStart, candidates: call.form === "widget" ? widgetCandidates(body.text, offset) : nameCandidates(body.text, offset).filter(notWidget) };
	}
	if(call.inValue && call.form === "widget" && ((call.name === "transclude" && call.inValue.attribute === "$variable") || (call.name === "macrocall" && call.inValue.attribute === "$name"))) {
		return { start: call.inValue.start, candidates: nameCandidates(body.text, offset).filter(notWidget) };
	}
	if(call.inValue && call.form === "widget" && call.inValue.attribute && widgets.titleAttributes(call.name).includes(call.inValue.attribute)) {
		var typedTitle = body.text.slice(call.inValue.start, offset);
		// As inside [[, one character must be typed before the wiki's titles are listed.
		return { start: call.inValue.start, candidates: typedTitle.replace(/\s+/g, "").length < MIN_PREFIX ? [] : titleCandidates(typedTitle) };
	}
	if(call.argument !== null) {
		return { start: offset - call.argument.length, candidates: parameterCandidates(call, body.text, offset) };
	}
	return null;
}

function notWidget(candidate) {
	return candidate.definition !== "widget";
}

// Titles for an attribute value, typed like those of a link; the type is looked up only for the titles listed.
function titleCandidates(prefix) {
	return candidateTitles(prefix).map(function(title) {
		return { label: title, kind: KIND_REFERENCE, isTitle: true };
	});
}

// Every name a call could reach here, in the order TiddlyWiki looks: what an
// enclosing definition or widget binds, this document's definitions, the global
// ones, JavaScript macros, then the variables core sets.
function nameCandidates(bodyText, offset) {
	var out = [];
	scope.bindingsAt(offset, source.parseWithBodies(bodyText), bodyText).forEach(function(binding) {
		out.push({ label: binding.name, kind: KIND_VARIABLE, detail: binding.kind, documentation: binding.kind === "parameter" ? "parameter of " + binding.of : "set by " + binding.by });
	});
	macros.visibleDefinitions(calls.sitesIn(bodyText).definitions, offset).forEach(function(definition) {
		out.push(definitionCandidate(definition, "defined in this tiddler"));
	});
	macros.importedDefinitions(bodyText, offset).reverse().forEach(function(imported) {
		out.push(definitionCandidate(imported.definition, "imported from " + imported.title));
	});
	calls.globalDefinitions().forEach(function(global) {
		out.push(definitionCandidate(global.definition, "defined in " + global.title));
	});
	Object.keys($tw.macros || {}).forEach(function(name) {
		out.push({ label: name, kind: KIND_FUNCTION, detail: "javascript " + symbols.signature($tw.macros[name].params || []), documentation: "a JavaScript macro", definition: "javascript" });
	});
	filters.CORE_VARIABLES.forEach(function(name) {
		out.push({ label: name, kind: KIND_VARIABLE, detail: "core variable" });
	});
	return out;
}

function definitionCandidate(definition, where) {
	return {
		label: definition.name,
		kind: definition.kind === "widget" ? KIND_CLASS : KIND_FUNCTION,
		detail: definition.kind + " " + symbols.signature(definition.params),
		documentation: where,
		definition: definition.kind
	};
}

// A widget's tag: \widget definitions in reach first, then every registered widget.
function widgetCandidates(bodyText, offset) {
	var custom = nameCandidates(bodyText, offset).filter(function(candidate) {
		return candidate.definition === "widget";
	}).map(function(candidate) {
		return Object.assign({}, candidate, { label: candidate.label.slice(1) });
	});
	return custom.concat(Object.keys(($tw.rootWidget && $tw.rootWidget.widgetClasses) || {}).sort().map(function(name) {
		return { label: name, kind: KIND_CLASS, detail: "widget" };
	}));
}

// A filter step: every operator, then dotted functions in reach, which run as operators.
function operatorCandidates(bodyText, offset) {
	return Object.keys($tw.wiki.getFilterOperators()).filter(function(name) {
		return name !== "[unknown]";
	}).sort().map(function(name) {
		return { label: name, kind: KIND_OPERATOR, detail: "filter operator" };
	}).concat(nameCandidates(bodyText, offset).filter(function(candidate) {
		return candidate.definition === "function" && candidate.label.includes(".");
	}));
}

// Whether the running operator name uses its operand as a tag or field name, or its suffix as a field name.
function operandUse(name) {
	var uses = $tw.wiki.getGlobalCache(OPERAND_USE_CACHE_KEY, function() { return Object.create(null); });
	if(!uses[name]) {
		var code = operatorSource(name);
		uses[name] = {};
		Object.keys(OPERAND_USES).forEach(function(kind) {
			uses[name][kind] = OPERAND_USES[kind].some(function(pattern) { return pattern.test(code); });
		});
	}
	return uses[name];
}

// An operator's function in the code that runs, from its export (or the function the export names)
// to the next line that starts a top-level definition.
function operatorSource(name) {
	var title = $tw.wiki.getFilterOperators()[name] ? modules.moduleOfFilterOperator(name) : null,
		code = title ? widgets.moduleCode(title) : "",
		escaped = $tw.utils.escapeRegExp(name),
		exported = new RegExp("^exports(?:\\." + escaped + "|\\[\\s*([\"'])" + escaped + "\\1\\s*\\])\\s*=\\s*([A-Za-z_$][\\w$]*)?", "m").exec(code);
	if(!exported) {
		return "";
	}
	var identifier = exported[2] && exported[2] !== "function" ? $tw.utils.escapeRegExp(exported[2]) : null,
		written = identifier ? new RegExp("^(?:(?:var|let|const)\\s+" + identifier + "\\s*=|function\\s+" + identifier + "\\s*\\()", "m").exec(code) : null,
		from = written ? written.index : exported.index,
		next = /^(?:exports\b|function\s|var\s|let\s|const\s)/gm;
	next.lastIndex = code.indexOf("\n", from) + 1 || code.length;
	var end = next.exec(code);
	return code.slice(from, end ? end.index : code.length);
}

// The tags the wiki uses, system tags only once the typed text starts with $, and none holding
// the ] that would end the operand.
function tagCandidates(typed) {
	var tagMap = $tw.wiki.getTagMap(),
		system = typed.charAt(0) === "$";
	return Object.keys(tagMap).sort().filter(function(tag) {
		return !tag.includes("]") && (system || !$tw.wiki.isSystemTiddler(tag));
	}).map(function(tag) {
		return { label: tag, kind: KIND_REFERENCE, detail: "tag of " + tiddlerCount(tagMap[tag].length) };
	});
}

function fieldCandidates() {
	var counts = $tw.wiki.getGlobalCache(FIELD_CACHE_KEY, function() {
		var found = Object.create(null);
		function count(tiddler) {
			Object.keys(tiddler.fields).forEach(function(name) {
				found[name] = (found[name] || 0) + 1;
			});
		}
		$tw.wiki.each(count);
		$tw.wiki.eachShadow(function(tiddler, title) {
			if(!$tw.wiki.tiddlerExists(title)) {
				count(tiddler);
			}
		});
		return found;
	});
	return Object.keys(counts).sort().map(function(name) {
		return { label: name, kind: KIND_FIELD, detail: "field of " + tiddlerCount(counts[name]) };
	});
}

function tiddlerCount(n) {
	return n + (n === 1 ? " tiddler" : " tiddlers");
}

// The parameters a call has not been given, by name or by position, written
// the way the call's form names them: tag: in <<call>>, tag= in a widget.
function parameterCandidates(call, bodyText, offset) {
	var callee = typing.calleeOf(call),
		found = callee ? macros.findDefinition(callee, bodyText, offset) : null;
	if(!found) {
		return [];
	}
	var args = call.args.filter(function(arg) { return call.form === "macro" || arg.name.charAt(0) !== "$"; }),
		given = macros.bindArguments(found.params, args, found.kind === "javascript" ? "macro" : found.kind).filter(function(bound) {
			return bound.origin === "named" || bound.origin === "positional";
		}).map(function(bound) { return bound.name; });
	return found.params.filter(function(param) {
		return !given.includes(param.name);
	}).map(function(param) {
		return {
			label: param.name + (call.form === "macro" ? ":" : "="),
			kind: KIND_PROPERTY,
			detail: param["default"] === undefined ? "no default" : "default " + param["default"]
		};
	});
}

// Ranked like titles, with the same protocol rules: the typed text as every
// item's filterText, an explicit range, and always incomplete.
function nameCompletions(uri, text, position, lineText) {
	var body = source.bodyOf(uri, text);
	if(position.line < body.firstLine) {
		return null;
	}
	var offset = source.offsetAt(body.starts, position) - body.offset,
		want = wanted(body, offset, lineText.slice(0, position.character));
	if(!want) {
		return null;
	}
	var byLabel = Object.create(null),
		typed = body.text.slice(want.start, offset);
	want.candidates.forEach(function(candidate) {
		if(!byLabel[candidate.label]) {
			byLabel[candidate.label] = candidate;
		}
	});
	var range = { start: source.positionAt(body.starts, body.offset + want.start), end: position };
	return {
		isIncomplete: true,
		items: rankTitles(Object.keys(byLabel), typed).slice(0, MAX_COMPLETIONS).map(function(label, index) {
			var candidate = byLabel[label],
				tiddler = candidate.isTitle ? $tw.wiki.getTiddler(label) : null;
			return {
				label: label,
				kind: candidate.kind,
				detail: candidate.isTitle ? (tiddler && tiddler.fields.type ? tiddler.fields.type : undefined) : candidate.detail,
				documentation: candidate.documentation,
				filterText: typed,
				sortText: ("0000" + index).slice(-4),
				textEdit: { range: range, newText: label }
			};
		})
	};
}

function completions(uri, text, position) {
	var lines = text.split(/\r?\n/),
		lineText = lines[position.line] || "",
		context = linkContext(lineText, position.character);
	if(!context) {
		return nameCompletions(uri, text, position, lineText) || { isIncomplete: false, items: [] };
	}
	// Reported as incomplete rather than complete, so the editor asks again on
	// the next keystroke instead of caching this emptiness.
	if(context.prefix.replace(/\s+/g, "").length < MIN_PREFIX) {
		return { isIncomplete: true, items: [] };
	}
	var ranked = rankTitles(candidateTitles(context.prefix), context.prefix),
		limit = Math.min(ranked.length, MAX_COMPLETIONS),
		items = [];
	var range = {
		start: { line: position.line, character: context.start },
		end: { line: position.line, character: position.character }
	};
	// What the editor considers the word being completed: the same span the edit
	// replaces. Every item claims exactly this as its filter text.
	var typed = lineText.slice(context.start, position.character);
	for(var i = 0; i < limit; i++) {
		var title = ranked[i],
			tiddler = $tw.wiki.getTiddler(title);
		items.push({
			label: title,
			kind: KIND_REFERENCE,
			// The server has already decided which titles match, so the editor
			// must not decide again. Its matching stops at the space in a title
			// and silently drops most of the list; handing every item the text
			// the user typed makes each an exact match, and sortText carries the
			// ranking chosen above.
			filterText: typed,
			sortText: ("0000" + i).slice(-4),
			textEdit: { range: range, newText: title },
			detail: tiddler && tiddler.fields.type ? tiddler.fields.type : undefined
		});
	}
	// Always incomplete, even when the whole list fits. A complete list lets the
	// client cache it and filter locally, and local filtering breaks on the
	// space in a title: the editor treats it as the end of a word and stops
	// asking. Incomplete makes every keystroke a fresh question to the wiki.
	return { isIncomplete: true, items: items };
}

exports.completions = completions;
exports.linkContext = linkContext;
