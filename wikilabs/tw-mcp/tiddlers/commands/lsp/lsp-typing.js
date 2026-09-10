/*\
title: $:/core/modules/commands/inspect/lsp/lsp-typing.js
type: application/javascript
module-type: library

Text still being typed: the call or widget the cursor is inside, and where it
stands in a filter. The parser cannot help here, since an unclosed <<name or
<$name parses as plain text, so both are read from the raw text before the
cursor, the way title completion reads an open [[.

\*/

"use strict";

var filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js");

// How far back an unclosed call is looked for, at most.
var MAX_LOOKBACK = 4000;

// A value opened inside a call runs to its closer; nothing in it opens a call.
var QUOTES = [["\"\"\"", "\"\"\""], ["{{{", "}}}"], ["[[", "]]"], ["{{", "}}"], ["\"", "\""], ["'", "'"], ["`", "`"]];

// The closing bracket of each filter operand opener.
var OPERAND_CLOSE = { "[": "]", "{": "}", "<": ">", "(": ")", "/": "/" };

// The innermost unclosed <<call or <$widget before offset in text, or null:
// { form: "macro"|"widget", name, nameStart, inName, args: [{name, value,
// positional}], inValue: null | {attribute, start}, argument }, argument being
// the argument name typed so far ("" after a space), else null. Offsets are
// into text; a widget's name is given without its $.
function callContext(text, offset) {
	var frames = [],
		i = lookbackStart(text, offset);
	while(i < offset) {
		var top = frames[frames.length - 1];
		if(top && top.quote) {
			var close = text.indexOf(top.quote, i);
			if(close < 0 || close + top.quote.length > offset) {
				break;
			}
			i = close + top.quote.length;
			top.quote = null;
		} else if(text.startsWith("<<", i)) {
			frames.push({ form: "macro", start: i });
			i += 2;
		} else if(text.startsWith("<$", i)) {
			frames.push({ form: "widget", start: i });
			i += 2;
		} else if(top && top.form === "macro" && text.startsWith(">>", i)) {
			frames.pop();
			i += 2;
		} else if(top && top.form === "widget" && text.charAt(i) === ">") {
			frames.pop();
			i++;
		} else {
			var quote = top ? quoteAt(text, i) : null;
			if(quote) {
				top.quote = quote[1];
				top.quoteAt = i;
				i += quote[0].length;
			} else {
				i++;
			}
		}
	}
	var frame = frames[frames.length - 1];
	return frame ? describeFrame(text, offset, frame) : null;
}

// Where an unclosed call could start: after the last pragma line before offset,
// since a definition's head ends whatever came before it.
function lookbackStart(text, offset) {
	var start = Math.max(0, offset - MAX_LOOKBACK),
		pragma = /(^|\n)\\(?:procedure|define|widget|function|end)\b[^\n]*/g,
		match;
	pragma.lastIndex = start;
	while((match = pragma.exec(text)) !== null && match.index < offset) {
		var lineStart = match.index + match[1].length;
		// On the pragma line itself, a one-line body after the head still counts.
		start = match.index + match[0].length <= offset ? match.index + match[0].length : lineStart;
	}
	return start;
}

function quoteAt(text, i) {
	for(var q = 0; q < QUOTES.length; q++) {
		if(text.startsWith(QUOTES[q][0], i)) {
			return QUOTES[q];
		}
	}
	return null;
}

function describeFrame(text, offset, frame) {
	var written = text.slice(frame.start, frame.quote ? frame.quoteAt : offset),
		head = (frame.form === "macro" ? /^<<([^\s>"':\[\]]*)/ : /^<\$([^\s>\/"'=]*)/).exec(written),
		nameStart = frame.start + 2,
		context = {
			form: frame.form,
			name: head[1],
			nameStart: nameStart,
			inName: !frame.quote && nameStart + head[1].length === offset,
			args: argumentsIn(written.slice(head[0].length), frame.form),
			inValue: null,
			argument: null
		};
	if(frame.quote) {
		// The attribute or parameter whose value the cursor is typing.
		var naming = (frame.form === "macro" ? /([^\s:"'>]+)\s*:\s*$/ : /([^\s=\/>"']+)\s*=\s*$/).exec(written);
		context.inValue = { attribute: naming ? naming[1] : null, start: frame.quoteAt + quoteAt(text, frame.quoteAt)[0].length };
		context.args = argumentsIn(written.slice(head[0].length, naming ? naming.index : written.length), frame.form);
	} else if(!context.inName) {
		var typed = /\s([^\s=:"'>\/]*)$/.exec(written),
			value = (frame.form === "macro" ? /\s([^\s:"'>]+)\s*:\s*([^\s"'>]*)$/ : /\s([^\s=\/>"']+)\s*=\s*([^\s"'>]*)$/).exec(written);
		if(typed) {
			context.argument = typed[1];
			context.args = argumentsIn(written.slice(head[0].length, written.length - typed[1].length), frame.form);
		} else if(value) {
			// An unquoted value, or none yet after name: or name=.
			context.inValue = { attribute: value[1], start: offset - value[2].length };
			context.args = argumentsIn(written.slice(head[0].length, value.index), frame.form);
		}
	}
	return context;
}

// The arguments written so far, as { name, value, positional }.
function argumentsIn(rest, form) {
	var pattern = form === "macro"
			? /\s*(?:([^\s:"'>\[\]]+)\s*:\s*)?("""[\s\S]*?"""|"[^"]*"|'[^']*'|\[\[[\s\S]*?\]\]|<<[\s\S]*?>>|[^\s"'>]+)/g
			: /\s*([^\s=\/>"'`]+)(?:\s*=\s*("""[\s\S]*?"""|"[^"]*"|'[^']*'|`[^`]*`|\{\{\{[\s\S]*?\}\}\}|\{\{[\s\S]*?\}\}|<<[\s\S]*?>>|[^\s"'=>`]+))?/g,
		args = [],
		match;
	while((match = pattern.exec(rest)) !== null && match[0].trim()) {
		if(form === "macro") {
			args.push({ name: match[1] || null, value: unquote(match[2]), positional: !match[1] });
		} else {
			args.push({ name: match[1], value: unquote(match[2] || "true"), positional: false });
		}
	}
	return args;
}

// What a call context calls: a <<call>>'s name, a widget form's $variable or
// $name, else the \widget of its tag (a JavaScript widget declares nothing).
function calleeOf(context) {
	if(context.form === "macro") {
		return context.name;
	}
	var named = function(name) {
		var arg = context.args.filter(function(a) { return a.name === name; })[0];
		return arg ? arg.value : null;
	};
	if(context.name === "transclude") {
		return named("$variable");
	}
	if(context.name === "macrocall") {
		return named("$name");
	}
	return "$" + context.name;
}

// The filter typed so far on a line, up to the cursor: a filter attribute, a
// {{{ }}}, an <%if%> condition or a \function body; null elsewhere.
function filterBefore(upto) {
	var context = filters.filterContext(upto, upto.length);
	if(context) {
		return upto.slice(context.start);
	}
	var match = /<%\s*(?:else)?if\s((?:(?!%>).)*)$/.exec(upto) || /^\s*\\function\s+[^\s(]+\([^)]*\)\s(.*)$/.exec(upto);
	return match ? match[1] : null;
}

function unquote(value) {
	var quote = quoteAt(value, 0);
	return quote && value.endsWith(quote[1]) ? value.slice(quote[0].length, value.length - quote[1].length) : value;
}

// Where the cursor stands at the end of upto, a filter typed so far:
// { state: "name", word } while an operator is named, { state: "operand",
// opener, operator, word, index } inside its index-th operand, else
// { state: "other" }.
function filterPosition(upto) {
	var state = "outside",
		word = "",
		operator = "",
		opener = null,
		index = 0;
	for(var i = 0; i < upto.length; i++) {
		var ch = upto.charAt(i);
		if(state === "outside") {
			if(ch === "[") {
				state = "name";
				word = "";
			} else if(ch === "\"" || ch === "'") {
				state = ch;
			}
		} else if(state === "\"" || state === "'") {
			if(ch === state) {
				state = "outside";
			}
		} else if(state === "name") {
			if(OPERAND_CLOSE[ch]) {
				state = "operand";
				opener = ch;
				operator = word;
				word = "";
				index = 0;
			} else if(ch === "]") {
				state = "outside";
			} else {
				word += ch;
			}
		} else if(state === "operand") {
			if(ch === OPERAND_CLOSE[opener]) {
				state = "after";
			} else {
				word += ch;
			}
		} else if(state === "after") {
			if(ch === "]") {
				state = "outside";
			} else if(ch === ",") {
				state = "comma";
			} else {
				state = "name";
				word = ch;
			}
		} else if(state === "comma") {
			if(OPERAND_CLOSE[ch]) {
				state = "operand";
				opener = ch;
				word = "";
				index++;
			}
		}
	}
	if(state === "name") {
		return { state: "name", word: word };
	}
	if(state === "operand") {
		return { state: "operand", opener: opener, operator: operator, word: word, index: index };
	}
	return { state: "other" };
}

exports.callContext = callContext;
exports.calleeOf = calleeOf;
exports.argumentsIn = argumentsIn;
exports.filterBefore = filterBefore;
exports.filterPosition = filterPosition;
