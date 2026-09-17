/*\
title: $:/core/modules/commands/inspect/lsp/lsp-signature.js
type: application/javascript
module-type: library

Signature help: while a call's arguments are typed, the parameter list of the
definition it calls, with the parameter being filled in marked.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	typing = require("$:/core/modules/commands/inspect/lsp/lsp-typing.js");

// Stands for the positional value being typed, to see which parameter it binds.
var PROBE = { name: null, value: " ", positional: true };

function signatureHelp(uri, text, position) {
	var body = source.bodyOf(uri, text);
	if(position.line < body.firstLine) {
		return null;
	}
	var offset = source.offsetAt(body.starts, position) - body.offset,
		call = callAt(body, offset, (body.lines[position.line] || "").slice(0, position.character)),
		found = call && call.callee ? macros.findDefinition(call.callee, body.text, offset) : null;
	if(!found) {
		return null;
	}
	var signature = labelled(call.callee, found.params);
	signature.documentation = { kind: "markdown", value: documentation(found, call) };
	return { signatures: [signature], activeSignature: 0, activeParameter: activeParameter(found, call) };
}

// The call whose arguments the cursor is in, as { callee, args, naming,
// positionalValue } or { callee, byIndex } for an operand: a <<call>> or widget
// form, a dotted function used as an operator, or a variable operand with arguments.
function callAt(body, offset, upto) {
	var filter = typing.filterAt(body.text, offset, upto);
	if(filter !== null) {
		var at = typing.filterPosition(filter);
		if(at.state !== "operand") {
			return null;
		}
		// [x.y[a],[b]: operands bind to parameters by index.
		if(at.operator.includes(".")) {
			return { callee: at.operator, args: [], byIndex: at.index };
		}
		// [<fn "a" b>] calls fn with arguments, as <<fn "a" b>> would.
		var space = at.opener === "<" ? at.word.search(/\s/) : -1;
		return space > 0 ? { callee: at.word.slice(0, space), args: typing.argumentsIn(at.word.slice(space), "macro"), naming: null } : null;
	}
	var context = typing.callContext(body.text, offset);
	// While the name is typed nothing is called yet; a $variable being typed leaves no callee either.
	if(!context || context.inName) {
		return null;
	}
	return {
		callee: typing.calleeOf(context),
		args: context.args.filter(function(arg) { return context.form === "macro" || arg.name.charAt(0) !== "$"; }),
		naming: context.inValue ? context.inValue.attribute : null,
		positionalValue: !!context.inValue && context.inValue.attribute === null
	};
}

// name(a, b:"B"), each parameter given as its [start, end] in that label.
function labelled(name, params) {
	var label = name + "(",
		parameters = [];
	params.forEach(function(param, index) {
		var text = param.name + (param["default"] === undefined ? "" : ":\"" + param["default"] + "\"");
		label += index ? ", " : "";
		parameters.push({ label: [label.length, label.length + text.length] });
		label += text;
	});
	return { label: label + ")", parameters: parameters };
}

// The index of the parameter being filled in, or params.length for none: the
// one named before the cursor, the one a positional value binds to by the
// definition's rule, else the first not yet given.
function activeParameter(found, call) {
	var params = found.params,
		names = params.map(function(param) { return param.name; }),
		kind = found.kind === "javascript" ? "macro" : found.kind,
		indexOf = function(name) {
			var at = names.indexOf(name);
			return at < 0 ? params.length : at;
		};
	if(call.byIndex !== undefined) {
		return Math.min(call.byIndex, params.length);
	}
	if(call.naming) {
		return indexOf(call.naming);
	}
	if(call.positionalValue) {
		var probed = macros.bindArguments(params, call.args.concat([PROBE]), kind).filter(function(bound) {
			return bound.value === PROBE.value && bound.origin === "positional";
		})[0];
		return probed ? indexOf(probed.name) : params.length;
	}
	var given = macros.bindArguments(params, call.args, kind).filter(function(bound) {
		return bound.origin === "named" || bound.origin === "positional";
	}).map(function(bound) { return bound.name; });
	for(var i = 0; i < params.length; i++) {
		if(!given.includes(params[i].name)) {
			return i;
		}
	}
	return params.length;
}

function documentation(found, call) {
	var where = found.kind === "javascript" ? "a JavaScript macro" : (found.title === null ? "defined in this tiddler" : "defined in `" + found.title + "`"),
		undeclared = call.args.filter(function(arg) {
			return arg.name && !found.params.some(function(param) { return param.name === arg.name; });
		}).map(function(arg) { return "`" + arg.name + "`"; });
	return "**" + found.kind + "**, " + where + (undeclared.length ? "\n\nNot declared by this definition: " + undeclared.join(", ") : "");
}

exports.signatureHelp = signatureHelp;
