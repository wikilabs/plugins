/*\
title: $:/core/modules/commands/inspect/lsp/lsp-links.js
type: application/javascript
module-type: library

Link diagnostics: which links and transclusions point at a tiddler that does
not exist.

The scanning here is hand-written rather than driven by the parser. That is a
known compromise: TiddlyWiki's transclude rule records no source offsets, so a
{{target}} cannot be located through the parse tree at all. Links could be, and
moving them there would also cover <$link to="..."> — see lsp-filters.js for
what the parser-driven version looks like.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

var SEVERITY_WARNING = 2;

// A link target may carry a field or index suffix that is not part of the title.
function titleOfTarget(target) {
	var title = target;
	var field = title.indexOf("!!");
	if(field >= 0) {
		title = title.slice(0, field);
	}
	var index = title.indexOf("##");
	if(index >= 0) {
		title = title.slice(0, index);
	}
	return title.trim();
}

function tiddlerExists(title) {
	return $tw.wiki.tiddlerExists(title) || $tw.wiki.isShadowTiddler(title);
}

// Targets we must not report on: an external address, a transclusion of the
// current tiddler, and anything assembled at render time from a variable.
function isCheckable(target) {
	if(!target.trim()) {
		return false;
	}
	if(target.includes("://") || target.startsWith("//") || target.startsWith("mailto:")) {
		return false;
	}
	return !(target.includes("$(") || target.includes("<<"));
}

// One line's worth of link targets, as {target, line, start, end} where start
// and end bracket the target text itself rather than its delimiters.
// Hand-scanned rather than matched by regex so that a filtered transclusion
// ({{{ ... }}}) and inline code can be stepped over instead of parsed.
function scanLine(text, lineNumber, found) {
	var i = 0;
	while(i < text.length) {
		var ch = text.charAt(i);
		if(ch === "`") {
			var closeTick = text.indexOf("`", i + 1);
			i = closeTick < 0 ? text.length : closeTick + 1;
			continue;
		}
		if(ch === "[" && text.charAt(i + 1) === "[") {
			var closeLink = text.indexOf("]]", i + 2);
			if(closeLink < 0) {
				return;
			}
			pushTarget(text.slice(i + 2, closeLink), i + 2, lineNumber, found, "|");
			i = closeLink + 2;
			continue;
		}
		if(ch === "{" && text.charAt(i + 1) === "{") {
			if(text.charAt(i + 2) === "{") {
				var closeFilter = text.indexOf("}}}", i + 3);
				i = closeFilter < 0 ? text.length : closeFilter + 3;
				continue;
			}
			var closeTrans = text.indexOf("}}", i + 2);
			if(closeTrans < 0) {
				return;
			}
			pushTarget(text.slice(i + 2, closeTrans), i + 2, lineNumber, found, "||");
			i = closeTrans + 2;
			continue;
		}
		i++;
	}
}

// The target is the segment after the caption separator for a link, and before
// the template separator for a transclusion.
function pushTarget(body, offset, lineNumber, found, separator) {
	var start = offset,
		text = body;
	if(separator === "|") {
		var pipe = body.lastIndexOf("|");
		if(pipe >= 0) {
			start = offset + pipe + 1;
			text = body.slice(pipe + 1);
		}
	} else {
		var template = body.indexOf("||");
		if(template >= 0) {
			text = body.slice(0, template);
		}
	}
	found.push({
		target: text,
		line: lineNumber,
		start: start,
		end: start + text.length
	});
}

function scanLinks(lines, firstLine) {
	var found = [],
		inFence = false;
	for(var i = firstLine; i < lines.length; i++) {
		if(/^\s*```/.test(lines[i])) {
			inFence = !inFence;
			continue;
		}
		if(!inFence) {
			scanLine(lines[i], i, found);
		}
	}
	return found;
}

function diagnostics(uri, text) {
	var body = source.bodyOf(uri, text),
		links = scanLinks(body.lines, body.firstLine),
		out = [];
	for(var i = 0; i < links.length; i++) {
		var link = links[i];
		if(!isCheckable(link.target)) {
			continue;
		}
		var title = titleOfTarget(link.target);
		if(title && !tiddlerExists(title)) {
			out.push({
				range: {
					start: { line: link.line, character: link.start },
					end: { line: link.line, character: link.end }
				},
				severity: SEVERITY_WARNING,
				source: "tiddlywiki",
				message: "No tiddler titled '" + title + "'"
			});
		}
	}
	return out;
}

exports.diagnostics = diagnostics;
exports.scanLinks = scanLinks;
exports.titleOfTarget = titleOfTarget;
