/*\
title: $:/core/modules/commands/inspect/lsp/lsp-links.js
type: application/javascript
module-type: library

Link diagnostics: which links and transclusions point at a tiddler that does
not exist, found in the parse tree, which already knows code, comments and
filters from links.

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

// Every link and transclusion target in a document body, as { target, start, end } in body offsets around
// the target text: [[X]], [[caption|X]], <$link to="X"/>, {{X}} and {{X||template}}.
function targetsIn(bodyText) {
	var found = [];
	source.eachNode(source.parseWithBodies(bodyText), function(node) {
		if(node.start === undefined || !node.attributes) {
			return;
		}
		var attribute, at;
		if(node.type === "link" && (node.rule === "prettylink" || node.tag === "$link")) {
			attribute = node.attributes.to;
			// The attribute records where it is written, value last.
			at = isLiteral(attribute) && attribute.start !== undefined ? attribute.start + bodyText.slice(attribute.start, attribute.end).lastIndexOf(attribute.value) : -1;
		} else if(node.type === "tiddler" && /^transclude/.test(node.rule || "")) {
			attribute = node.attributes.tiddler;
			// A transclusion's attributes record no range, but its target comes first after the braces.
			at = isLiteral(attribute) ? bodyText.indexOf(attribute.value, node.start) : -1;
		}
		if(at >= 0 && at < node.end) {
			found.push({ target: attribute.value, start: at, end: at + attribute.value.length });
		}
	});
	return found;
}

function isLiteral(attribute) {
	return !!attribute && attribute.type === "string" && !!attribute.value;
}

function diagnostics(uri, text) {
	var body = source.bodyOf(uri, text),
		out = [];
	targetsIn(body.text).forEach(function(link) {
		var title = isCheckable(link.target) ? titleOfTarget(link.target) : "";
		if(title && !tiddlerExists(title)) {
			out.push({
				range: {
					start: source.positionAt(body.starts, body.offset + link.start),
					end: source.positionAt(body.starts, body.offset + link.end)
				},
				severity: SEVERITY_WARNING,
				source: "tiddlywiki",
				message: "No tiddler titled '" + title + "'"
			});
		}
	});
	return out;
}

exports.diagnostics = diagnostics;
exports.targetsIn = targetsIn;
exports.titleOfTarget = titleOfTarget;
