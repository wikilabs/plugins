/*\
title: $:/core/modules/commands/inspect/lsp/lsp-pragmas.js
type: application/javascript
module-type: library

Hovering a pragma line: its keyword, the name a definition declares, and each
parameter in its list. A pragma renders nothing where it is written, so no
other hover answers there.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	files = require("$:/core/modules/commands/inspect/lsp/lsp-files.js"),
	scope = require("$:/core/modules/commands/inspect/lsp/lsp-scope.js"),
	calls = require("$:/core/modules/commands/inspect/calls.js");

// One line per keyword, since no tiddler in the wiki describes them.
var KEYWORDS = {
	procedure: "Defines a procedure: wikitext whose parameters are variables inside it.",
	"function": "Defines a function: a filter, called as `[<name>]` or `[function[name]]`, or as a filter operator when its name holds a dot.",
	define: "Defines a macro, the older form of `\\procedure`: its `$param$` placeholders are replaced as text.",
	widget: "Defines a custom widget: `<$name>` renders its body, and `<$slot>` places the widget's own content.",
	end: "Ends the multi-line definition above it; a name written after it must be that definition's.",
	"import": "Imports the definitions of every tiddler the filter lists.",
	parameters: "Declares the parameters this tiddler takes when it is transcluded.",
	whitespace: "`trim` drops the whitespace between widgets, `notrim` keeps it.",
	rules: "`only` or `except`: which wikitext rules apply in this tiddler."
};

// The keywords that declare a named definition.
var DEFINING = ["procedure", "function", "define", "widget"];

function hover(uri, text, position, openDocuments) {
	var body = source.bodyOf(uri, text);
	if(position.line < body.firstLine) {
		return null;
	}
	var pragma = /^(\s*)\\(\w+)/.exec(body.lines[position.line] || "");
	if(!pragma) {
		return null;
	}
	var lineStart = body.starts[position.line] - body.offset,
		cursor = lineStart + position.character,
		keywordStart = lineStart + pragma[1].length,
		keywordEnd = keywordStart + 1 + pragma[2].length,
		definitions = calls.sitesIn(body.text).definitions;
	if(cursor >= keywordStart && cursor <= keywordEnd) {
		return keywordHover(body, pragma[2], keywordStart, keywordEnd, definitions);
	}
	for(var i = 0; i < definitions.length; i++) {
		var definition = definitions[i];
		if(definition.range.start !== keywordStart) {
			continue;
		}
		if(cursor >= definition.start && cursor <= definition.end) {
			return answer(body, definition.start, definition.end, nameHover(uri, text, definition, definitions, openDocuments));
		}
		var hit = parameterRanges(body, definition).find(function(range) { return cursor >= range.start && cursor <= range.end; });
		if(hit) {
			return answer(body, hit.start, hit.end, parameterHover(uri, text, body, definition, hit.param));
		}
	}
	return null;
}

function keywordHover(body, name, start, end, definitions) {
	if(!KEYWORDS[name]) {
		return null;
	}
	var isDefinition = definitions.some(function(definition) { return definition.range.start === start; }),
		value = "```\n\\" + name + "\n```\n\n" + KEYWORDS[name];
	if(DEFINING.includes(name) && !isDefinition) {
		value += "\n\n**Not a definition here:** a pragma counts only where nothing but pragmas precedes it, so TiddlyWiki shows this line as text.";
	}
	return answer(body, start, end, value);
}

function nameHover(uri, text, definition, definitions, openDocuments) {
	var title = source.titleOfDocument(uri, text),
		parent = definition.parent === null ? null : definitions[definition.parent],
		reach = parent ? "local to `" + parent.name + "`" : (calls.importedGlobally(title) ? "global" : "local to this tiddler"),
		hidden = parent ? null : calls.globalDefinition(definition.name),
		value = "**" + definition.kind + "** `" + definition.name + "`, defined here, " + reach + "\n\n";
	if(hidden && hidden.title !== title) {
		value += "`" + hidden.title + "` defines it globally too; inside this tiddler this one wins.\n\n";
	}
	if(definition.params.length) {
		value += "| Parameter | Default |\n| --- | --- |\n" + definition.params.map(function(param) {
			return "| " + cell(param.name) + " | " + (param["default"] === undefined ? "" : "`" + cell(param["default"]) + "`") + " |";
		}).join("\n") + "\n\n";
	} else {
		value += "Takes no parameters.\n\n";
	}
	// Counted by name: which definition a call reaches depends on its caller.
	var documents = Object.assign({}, openDocuments);
	documents[uri] = text;
	var hits = files.sitesNamed(definition.name, documents).filter(function(hit) {
			return !hit.site.definition;
		}),
		here = hits.filter(function(hit) { return files.sameFileKey(hit.uri) === files.sameFileKey(uri); }).length,
		views = hits.filter(function(hit) { return source.isVirtualUri(hit.uri); }).length;
	return value + plural(hits.length, "call") + " of this name: " + here + " here, " + (hits.length - here - views) +
		" in other files, " + views + " in tiddlers without a file.";
}

function parameterHover(uri, text, body, definition, param) {
	var uses;
	if(definition.kind === "macro") {
		uses = placeholderUses(body, definition, param);
	} else {
		uses = bodyUses(uri, text, body, definition, param);
	}
	return "**parameter** `" + param.name + "` of `" + definition.name + "`" +
		(param["default"] === undefined ? ", no default" : ", default `" + cell(param["default"]) + "`") +
		"\n\nNamed " + plural(uses, "time") + " in its body. Definitions it calls can read it too, so no count shows it unused.";
}

// Calls in the body that resolve to this very parameter: an inner binding or a
// nested definition's parameter of the same name is another variable.
function bodyUses(uri, text, body, definition, param) {
	if(!definition.body) {
		return 0;
	}
	var tree = source.parseWithBodies(body.text);
	return files.sitesOfDocument(uri, text).filter(function(site) {
		if(site.definition || site.name !== param.name) {
			return false;
		}
		var binding = scope.resolve(site.name, site.start, tree, body.text);
		return !!binding && binding.kind === "parameter" && binding.scope.start === definition.body.start;
	}).length;
}

// A \define parameter is used as a $name$ placeholder, which no parser sees.
function placeholderUses(body, definition, param) {
	if(!definition.body) {
		return 0;
	}
	return body.text.slice(definition.body.start, definition.body.end).split("$" + param.name + "$").length - 1;
}

// Where each parameter's name sits on the definition's first line. The list is
// read left to right, stepping over each default, so a default that happens to
// hold a parameter's name is never taken for it.
function parameterRanges(body, definition) {
	var lineEnd = body.text.indexOf("\n", definition.end),
		list = body.text.slice(definition.end, lineEnd < 0 ? body.text.length : lineEnd),
		pos = list.indexOf("("),
		ranges = [];
	if(pos < 0) {
		return ranges;
	}
	pos++;
	for(var i = 0; i < definition.params.length; i++) {
		var param = definition.params[i];
		while(pos < list.length && /[\s,]/.test(list.charAt(pos))) {
			pos++;
		}
		if(list.substr(pos, param.name.length) !== param.name) {
			break;
		}
		ranges.push({ param: param, start: definition.end + pos, end: definition.end + pos + param.name.length });
		pos += param.name.length;
		while(pos < list.length && /\s/.test(list.charAt(pos))) {
			pos++;
		}
		if(list.charAt(pos) === ":") {
			pos = skipValue(list, pos + 1);
		}
	}
	return ranges;
}

// Past a parameter's default, in any of the quotings a parameter list allows.
function skipValue(list, pos) {
	while(pos < list.length && /\s/.test(list.charAt(pos))) {
		pos++;
	}
	var closers = [["\"\"\"", "\"\"\""], ["\"", "\""], ["'", "'"], ["[[", "]]"]];
	for(var i = 0; i < closers.length; i++) {
		if(list.substr(pos, closers[i][0].length) === closers[i][0]) {
			var close = list.indexOf(closers[i][1], pos + closers[i][0].length);
			return close < 0 ? list.length : close + closers[i][1].length;
		}
	}
	while(pos < list.length && !/[\s,)]/.test(list.charAt(pos))) {
		pos++;
	}
	return pos;
}

function answer(body, start, end, value) {
	return value === null ? null : {
		contents: { kind: "markdown", value: value },
		range: { start: source.positionAt(body.starts, body.offset + start), end: source.positionAt(body.starts, body.offset + end) }
	};
}

// A "|" in a cell ends the column.
function cell(value) {
	return String(value).replace(/\|/g, "\\|");
}

function plural(count, word) {
	return count + " " + word + (count === 1 ? "" : "s");
}

exports.hover = hover;
