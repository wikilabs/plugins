/*\
title: $:/plugins/wikilabs/devtools/utils.js
type: application/javascript
module-type: library

Shared utilities for source position formatting and parsing.
Single source of truth for the data-pos attribute format.

\*/

"use strict";

var SEPARATOR = " @ ";

// Format a source position into the data-pos attribute value
// Returns "L{start}-L{end} @ tiddlerTitle" or "L{start} @ tiddlerTitle" for single-line
exports.format = function(startLine, endLine, title) {
	var pos = (startLine === endLine) ? "L" + startLine : "L" + startLine + "-L" + endLine;
	if(title) {
		pos += SEPARATOR + title;
	}
	return pos;
};

// Parse a data-pos attribute value
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

// ── DOM helpers ──

// Create element with className and optional text
exports.el = function(tag, cls, text) {
	var e = document.createElement(tag);
	if(cls) e.className = cls;
	if(text) e.textContent = text;
	return e;
};

// Make an element draggable via a handle
// opts: { ignore(e), onStart(left,top), onEnd() }
exports.makeDraggable = function(handle, target, opts) {
	handle.addEventListener("mousedown", function(e) {
		if(opts.ignore && opts.ignore(e)) return;
		e.preventDefault();
		var startX = e.clientX, startY = e.clientY;
		var rect = target.getBoundingClientRect();
		var origLeft = rect.left, origTop = rect.top;
		if(opts.onStart) opts.onStart(origLeft, origTop);
		var onMove = function(me) {
			target.style.left = Math.max(0, origLeft + me.clientX - startX) + "px";
			target.style.top = Math.max(0, origTop + me.clientY - startY) + "px";
		};
		var onUp = function() {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			if(opts.onEnd) opts.onEnd();
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
};

// Make an element resizable via a handle
// opts: { minW, minH, onStart(), onEnd() }
exports.makeResizable = function(handle, target, opts) {
	handle.addEventListener("mousedown", function(e) {
		e.preventDefault();
		e.stopPropagation();
		if(opts.onStart) opts.onStart();
		var startX = e.clientX, startY = e.clientY;
		var origW = target.offsetWidth, origH = target.offsetHeight;
		var onMove = function(me) {
			target.style.width = Math.max(opts.minW || 300, origW + me.clientX - startX) + "px";
			target.style.height = Math.max(opts.minH || 150, origH + me.clientY - startY) + "px";
		};
		var onUp = function() {
			document.removeEventListener("mousemove", onMove);
			document.removeEventListener("mouseup", onUp);
			if(opts.onEnd) opts.onEnd();
		};
		document.addEventListener("mousemove", onMove);
		document.addEventListener("mouseup", onUp);
	});
};

// Icon HTML cache
var iconCache = {};
exports.getIconHTML = function(transclusion) {
	if(!iconCache[transclusion]) {
		iconCache[transclusion] = exports.renderIconHTML(transclusion);
	}
	return iconCache[transclusion];
};

// Create an icon button with SVG at given size
exports.makeIconBtn = function(cls, iconTransclusion, title, size) {
	var btn = exports.el("span", cls);
	btn.innerHTML = exports.getIconHTML(iconTransclusion);
	if(title) btn.title = title;
	var svg = btn.querySelector("svg");
	if(svg) { svg.setAttribute("width", size || "12px"); svg.setAttribute("height", size || "12px"); }
	return btn;
};

// Create an expandable preview panel
// getText: function returning content text
// opts: { anchor, expanded, tallFade, maxHeight, onToggle(exp), onRemove(), onShow() }
exports.makeExpandable = function(getText, opts) {
	var previewEl = null;
	var isExpanded = opts.expanded || false;
	var el = exports.el;

	function show(expanded) {
		previewEl = el("div", "wltc-preview");
		var pre = el("pre", "wltc-preview-code");
		pre.textContent = getText();
		var fade = el("div", opts.tallFade ? "wltc-preview-fade wltc-preview-fade-tall" : "wltc-preview-fade");
		previewEl.appendChild(pre);
		previewEl.appendChild(fade);
		var maxCollapsed = opts.maxHeight || "3.6em";
		function applyState(exp) {
			if(exp) {
				pre.style.maxHeight = "none";
				pre.style.overflow = "auto";
				fade.style.display = "none";
			} else {
				pre.style.maxHeight = maxCollapsed;
				pre.style.overflow = "hidden";
				requestAnimationFrame(function() {
					fade.style.display = pre.scrollHeight > pre.clientHeight ? "" : "none";
				});
			}
		}
		applyState(expanded);
		previewEl.title = "Click to expand/collapse";
		previewEl.addEventListener("click", function() {
			var nowExpanded = pre.style.maxHeight === "none";
			isExpanded = !nowExpanded;
			if(opts.onToggle) opts.onToggle(isExpanded);
			applyState(isExpanded);
		});
		opts.anchor.insertAdjacentElement("afterend", previewEl);
	}

	return {
		toggle: function() {
			if(previewEl) { previewEl.remove(); previewEl = null; if(opts.onRemove) opts.onRemove(); return; }
			show(isExpanded);
			if(opts.onShow) opts.onShow();
		},
		restore: function() { show(isExpanded); },
		isOpen: function() { return !!previewEl; }
	};
};

// Find nearest ancestor with data-pos and parse it
exports.findSourcePos = function(target) {
	var node = target;
	while(node && node !== document.body) {
		var pos = node.getAttribute && node.getAttribute("data-pos");
		if(pos) {
			var parsed = exports.parse(pos);
			if(parsed && parsed.tiddler) {
				var range = node.getAttribute("data-range");
				var charStart = NaN, charEnd = NaN;
				if(range) {
					var parts = range.split(",");
					charStart = parseInt(parts[0], 10);
					charEnd = parseInt(parts[1], 10);
				}
				return {
					element: node, raw: pos, range: parsed.range, tiddler: parsed.tiddler,
					charStart: charStart,
					charEnd: charEnd,
					caller: node.getAttribute("data-caller") || null,
					context: node.getAttribute("data-ctx") || null
				};
			}
		}
		node = node.parentNode;
	}
	return null;
};

// Find the TiddlyWiki widget associated with a DOM element
exports.findWidget = function(target) {
	var node = target;
	while(node && node !== document.body) {
		if(node._twWidget) return node._twWidget;
		node = node.parentNode;
	}
	return null;
};

// Collect variables in scope by walking up the widget tree
exports.collectVariables = function(widget) {
	var seen = {}, vars = [], w = widget;
	while(w) {
		if(w.variables) {
			var keys = Object.keys(w.variables);
			for(var i = 0; i < keys.length; i++) {
				var name = keys[i];
				if(!seen[name]) {
					seen[name] = true;
					var v = w.variables[name];
					vars.push({
						name: name,
						value: v.value !== undefined ? v.value : (v.text !== undefined ? v.text : undefined),
						params: v.params || undefined,
						sourceTitle: v.sourceTitle || undefined,
						isMacro: v.isMacroDefinition || false,
						isProcedure: !!v.isProcedure || (v.configTrimWhiteSpace === true),
						isFunction: !!v.isFunctionDefinition,
						isWidget: !!v.isWidgetDefinition,
						_scopeWidget: widget
					});
				}
			}
		}
		w = w.parentWidget;
	}
	return vars;
};

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
