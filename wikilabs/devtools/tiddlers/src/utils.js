/*\
title: $:/plugins/wikilabs/devtools/utils.js
type: application/javascript
module-type: library

Shared utilities for source position formatting and parsing.
Single source of truth for the data-source-pos attribute format.

\*/

"use strict";

var SEPARATOR = " @ ";

// Format a source position into the data-source-pos attribute value
// Returns "L{start}-L{end} @ tiddlerTitle" or "L{start} @ tiddlerTitle" for single-line
exports.format = function(startLine, endLine, title) {
	var pos = (startLine === endLine) ? "L" + startLine : "L" + startLine + "-L" + endLine;
	if(title) {
		pos += SEPARATOR + title;
	}
	return pos;
};

// Parse a data-source-pos attribute value
// Returns { range: "L81-L84", tiddler: "$:/cards/procedures" } or null
exports.parse = function(posString) {
	if(!posString) return null;
	var idx = posString.indexOf(SEPARATOR);
	if(idx === -1) {
		return { range: posString, tiddler: null };
	}
	return {
		range: posString.slice(0, idx),
		tiddler: posString.slice(idx + SEPARATOR.length)
	};
};

// Parse a range string like "L81-L84" or "L8" into { startLine: 81, endLine: 84 }
exports.parseRange = function(rangeString) {
	if(!rangeString) return null;
	var match = rangeString.match(/^L(\d+)(?:-L(\d+))?$/);
	if(!match) return null;
	var start = parseInt(match[1], 10);
	return { startLine: start, endLine: match[2] ? parseInt(match[2], 10) : start };
};

exports.SEPARATOR = SEPARATOR;

// --- Sourcepos event bus ---
// Shared pub/sub for inter-panel communication that does NOT touch the TW store.
// This avoids triggering the TW refresh cycle (which closes popups, etc.)
// while still allowing panels to stay linked.

var bus = {
	_listeners: {},
	on: function(event, fn) {
		if(!bus._listeners[event]) bus._listeners[event] = [];
		bus._listeners[event].push(fn);
	},
	off: function(event, fn) {
		var list = bus._listeners[event];
		if(!list) return;
		var idx = list.indexOf(fn);
		if(idx !== -1) list.splice(idx, 1);
	},
	emit: function(event, data) {
		var list = bus._listeners[event];
		if(!list) return;
		for(var i = 0; i < list.length; i++) {
			list[i](data);
		}
	}
};

// Shared state (replaces $:/temp tiddlers)
var state = {
	inspectorFilter: "",
	inspectorLinked: true,
	openPreviews: {},
	colorIndex: 0,
	inspectorLayout: { width: 600, height: 350, left: NaN, top: NaN },
	viewerLayout: { width: 600, height: 400, left: -1, top: 60 }
};

exports.bus = bus;
exports.state = state;

// Render a wikitext transclusion safely using TW's widget system.
// TW's element widget already handles:
//   - Unsafe element blacklist ($tw.config.htmlUnsafeElements -> "safe-" prefix)
//   - Event attribute stripping (excludeEventAttributes: true in element.js)
// We only add javascript: URI stripping as an additional safety layer.
exports.renderIconHTML = function(transclusion) {
	var container = document.createElement("div");
	var parser = $tw.wiki.parseText("text/vnd.tiddlywiki", transclusion);
	var widgetNode = $tw.wiki.makeWidget(parser, {document: document});
	widgetNode.render(container, null);
	// Strip javascript: URIs — not covered by TW's element widget
	var allEls = container.getElementsByTagName("*");
	for(var i = 0; i < allEls.length; i++) {
		var attrs = allEls[i].attributes;
		for(var j = attrs.length - 1; j >= 0; j--) {
			if(/^(href|src|action|formaction)$/i.test(attrs[j].name) &&
				/^\s*javascript\s*:/i.test(attrs[j].value || "")) {
				allEls[i].removeAttribute(attrs[j].name);
			}
		}
	}
	return container.innerHTML;
};
