/*\
title: $:/plugins/wikilabs/devtools/click-handler.js
type: application/javascript
module-type: startup

Click handler: right-click shows sourcepos context menu.
Ctrl+right-click passes through to native browser context menu.

\*/

"use strict";

var sourcePosUtils = require("$:/plugins/wikilabs/devtools/utils.js");
var sourceViewer = require("$:/plugins/wikilabs/devtools/source-viewer.js");

// Reuse DOM helpers from source-viewer
var el = sourceViewer.el;
var makeDraggable = sourceViewer.makeDraggable;
var makeResizable = sourceViewer.makeResizable;

exports.name = "sourcepos-click";
exports.after = ["sourcepos"];
exports.platforms = ["browser"];
exports.synchronous = true;

var renderIconHTML = sourcePosUtils.renderIconHTML;
var bus = sourcePosUtils.bus;
var sharedState = sourcePosUtils.state;

// ── Icon cache ──

var iconCache = {};
function getIconHTML(transclusion) {
	if(!iconCache[transclusion]) {
		iconCache[transclusion] = renderIconHTML(transclusion);
	}
	return iconCache[transclusion];
}

// ── DOM helpers ──

function findSourcePos(target) {
	var node = target;
	while(node && node !== document.body) {
		var pos = node.getAttribute && node.getAttribute("data-source-pos");
		if(pos) {
			var parsed = sourcePosUtils.parse(pos);
			if(parsed && parsed.tiddler) {
				return {
					element: node, raw: pos, range: parsed.range, tiddler: parsed.tiddler,
					charStart: parseInt(node.getAttribute("data-source-start"), 10),
					charEnd: parseInt(node.getAttribute("data-source-end"), 10),
					caller: node.getAttribute("data-source-caller") || null,
					context: node.getAttribute("data-source-context") || null
				};
			}
		}
		node = node.parentNode;
	}
	return null;
}

function findWidget(target) {
	var node = target;
	while(node && node !== document.body) {
		if(node._twWidget) return node._twWidget;
		node = node.parentNode;
	}
	return null;
}

function collectVariables(widget) {
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
}

// Create an icon button with SVG at given size
function makeIconBtn(cls, iconTransclusion, title, size) {
	var btn = el("span", cls);
	btn.innerHTML = getIconHTML(iconTransclusion);
	if(title) btn.title = title;
	var svg = btn.querySelector("svg");
	if(svg) { svg.setAttribute("width", size || "12px"); svg.setAttribute("height", size || "12px"); }
	return btn;
}

// Create an expandable preview panel (used for tiddler previews and definition previews)
function makeExpandable(getText, opts) {
	var previewEl = null;
	var isExpanded = opts.expanded || false;

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
			if(previewEl) {
				previewEl.remove();
				previewEl = null;
				if(opts.onRemove) opts.onRemove();
				return;
			}
			show(isExpanded);
			if(opts.onShow) opts.onShow();
		},
		restore: function() { show(isExpanded); },
		isOpen: function() { return !!previewEl; }
	};
}

// ── Variable Inspector ──

var INSPECTOR_COLORS = [
	"rgba(100, 180, 255, 0.9)", "rgba(100, 220, 100, 0.9)",
	"rgba(255, 180, 60, 0.9)", "rgba(220, 100, 255, 0.9)",
	"rgba(255, 255, 80, 0.9)", "rgba(80, 220, 220, 0.9)"
];

var TYPE_COLORS = { widget: "#7a2a7a", fn: "#7a2a5a", proc: "#2a7a2a", macro: "#7a5a2a", def: "#2a5a7a", "var": "#555" };
var TYPE_KEYWORDS = { "var": true, "macro": true, "proc": true, "def": true, "fn": true, "widget": true };

function getNextColorIndex() {
	var idx = sharedState.colorIndex;
	sharedState.colorIndex = idx + 1;
	return idx;
}

function isInspectorLinked() { return sharedState.inspectorLinked; }
function setInspectorLinked(val) { sharedState.inspectorLinked = val; bus.emit("linked-changed", val); }
function getOpenPreviews() { return sharedState.openPreviews; }
function setOpenPreviews(obj) { sharedState.openPreviews = obj; bus.emit("previews-changed", obj); }

function getInspectorLayout() {
	var s = sharedState.inspectorLayout;
	return { width: Math.max(300, s.width || 600), height: Math.max(150, s.height || 350), left: s.left, top: s.top };
}

function saveInspectorLayout(props) {
	for(var k in props) sharedState.inspectorLayout[k] = parseInt(props[k], 10);
	bus.emit("layout-changed", sharedState.inspectorLayout);
}

function getVarType(v) {
	if(v.isWidget) return "widget";
	if(v.isFunction) return "fn";
	if(v.isProcedure) return "proc";
	if(v.isMacro) return "macro";
	if(v.params) return "def";
	return "var";
}

// Evaluate a macro body, returning a DocumentFragment with coloured spans
function evaluateMacroBody(body, varsArray) {
	var varMap = Object.create(null);
	for(var i = 0; i < varsArray.length; i++) {
		if(varsArray[i].value !== undefined) varMap[varsArray[i].name] = String(varsArray[i].value);
	}
	var frag = document.createDocumentFragment();
	var lastIndex = 0, re = /\$\(([^)]+)\)\$/g, m;
	while((m = re.exec(body)) !== null) {
		if(m.index > lastIndex) frag.appendChild(document.createTextNode(body.substring(lastIndex, m.index)));
		var span = document.createElement("span");
		if(varMap[m[1]] !== undefined) {
			span.textContent = varMap[m[1]];
			span.className = "wltc-subst-match";
		} else {
			span.textContent = "$(" + m[1] + ")$";
			span.className = "wltc-subst-missing";
			span.title = m[1] + " (not in scope)";
		}
		frag.appendChild(span);
		lastIndex = re.lastIndex;
	}
	if(lastIndex < body.length) frag.appendChild(document.createTextNode(body.substring(lastIndex)));
	return frag;
}

function showVariableInspector(vars, anchorX, anchorY, originElement, widget) {
	var layout = getInspectorLayout();
	var colorIdx = getNextColorIndex() % INSPECTOR_COLORS.length;
	var highlightColorClass = "sourcepos-highlight-color-" + colorIdx;
	var panelColor = INSPECTOR_COLORS[colorIdx];
	var existingPanels = document.querySelectorAll(".sourcepos-var-inspector");
	var offsetN = existingPanels.length;

	var panel = el("div", "sourcepos-var-inspector wltc-panel");
	panel.style.zIndex = 100001 + offsetN;
	panel.style.width = layout.width + "px";
	panel.style.height = layout.height + "px";
	panel.style.borderTop = "3px solid " + panelColor;

	// Header
	var header = el("div", "wltc-panel-header");
	var colorDot = el("span", "wltc-color-dot");
	colorDot.style.background = panelColor;
	header.appendChild(colorDot);
	var headerLabel = el("span", null, "Variables in scope (" + vars.length + ")");

	// Origin tracking
	var originSourcePos = originElement && originElement.getAttribute("data-source-pos");
	var originSourceStart = originElement && originElement.getAttribute("data-source-start");
	var originSourceContext = originElement && (originElement.getAttribute("data-source-context") || "");
	var originSourceCaller = originElement && (originElement.getAttribute("data-source-caller") || "");
	var originTagName = originElement && originElement.tagName;
	var disconnected = false;
	var disconnectedBadge = el("span", "wltc-disconnected-badge", " \u26A0 disconnected");

	function setDisconnected(val) {
		disconnected = val;
		colorDot.style.opacity = val ? "0.3" : "1";
		panel.style.borderTopStyle = val ? "dashed" : "solid";
		disconnectedBadge.style.display = val ? "inline" : "none";
	}

	function isWidgetAlive(w) {
		var current = w, maxDepth = 500;
		while(current && maxDepth-- > 0) {
			if(current === $tw.rootWidget) return true;
			current = current.parentWidget;
		}
		return false;
	}

	function isElementConnected(e) {
		if(!e || !document.body.contains(e)) return false;
		if(e._twWidget && !isWidgetAlive(e._twWidget)) return false;
		return true;
	}

	function relocateOrigin() {
		if(originElement && isElementConnected(originElement)) {
			if(disconnected) setDisconnected(false);
			return true;
		}
		if(originElement && document.body.contains(originElement) && !isElementConnected(originElement)) {
			if(!disconnected) setDisconnected(true);
			return false;
		}
		if(!originSourcePos) return false;
		var all = document.querySelectorAll("[data-source-pos]");
		for(var ci = 0; ci < all.length; ci++) {
			var c = all[ci];
			if(c.getAttribute("data-source-pos") !== originSourcePos) continue;
			if(originTagName && c.tagName !== originTagName) continue;
			if(originSourceStart && c.getAttribute("data-source-start") !== originSourceStart) continue;
			if((c.getAttribute("data-source-context") || "") !== originSourceContext) continue;
			if((c.getAttribute("data-source-caller") || "") !== originSourceCaller) continue;
			if(!isElementConnected(c)) continue;
			originElement = c;
			if(originElement._twWidget) widget = originElement._twWidget;
			setDisconnected(false);
			return true;
		}
		if(!disconnected) setDisconnected(true);
		return false;
	}

	header.appendChild(headerLabel);
	header.appendChild(disconnectedBadge);

	// Header buttons
	var headerBtns = el("span", "wltc-btn-group");
	var filterInput = document.createElement("input");
	filterInput.type = "text";
	filterInput.placeholder = "filter...";
	filterInput.className = "wltc-inspector-filter";
	headerBtns.appendChild(filterInput);

	var linkBtn = el("span", "wltc-inspector-link-btn", "\uD83D\uDD17");
	linkBtn.title = "Link filter across panels";
	function updateLinkStyle() { linkBtn.style.opacity = isInspectorLinked() ? "1" : "0.4"; }
	updateLinkStyle();
	linkBtn.addEventListener("click", function() {
		var nowLinked = !isInspectorLinked();
		setInspectorLinked(nowLinked);
		updateLinkStyle();
		if(nowLinked) {
			sharedState.inspectorFilter = filterInput.value;
			bus.emit("filter-changed", filterInput.value);
		}
	});
	headerBtns.appendChild(linkBtn);

	var closeBtn = el("span", "wltc-btn-close", "\u2715");
	closeBtn.addEventListener("click", function() {
		if(panel._unhighlightOrigin) panel._unhighlightOrigin();
		if(panel._cleanup) panel._cleanup();
		panel.remove();
	});
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);
	panel.appendChild(header);

	// Content
	var content = el("div", "wltc-inspector-content");
	panel.appendChild(content);

	var expandedState = {};

	// Lazy evaluation observer
	var lazyObserver = null;
	function getLazyObserver() {
		if(!lazyObserver) {
			lazyObserver = new IntersectionObserver(function(entries) {
				for(var i = 0; i < entries.length; i++) {
					if(entries[i].isIntersecting) {
						var target = entries[i].target;
						if(target._lazyEval) { target._lazyEval(); delete target._lazyEval; }
						lazyObserver.unobserve(target);
					}
				}
			}, { root: content, threshold: 0 });
		}
		return lazyObserver;
	}

	// Render variable list
	function renderVars(filter) {
		if(lazyObserver) lazyObserver.disconnect();
		content.innerHTML = "";
		var filterLower = (filter || "").toLowerCase().trim();
		var filterTerms = filterLower ? filterLower.split(/\s+/) : [];
		var shown = 0, lastSourceTitle = "\0";

		for(var i = 0; i < vars.length; i++) {
			var v = vars[i];

			// Filter matching
			if(filterTerms.length > 0) {
				var varType = getVarType(v);
				var nameLower = v.name.toLowerCase();
				var valLower = (v.value !== undefined) ? String(v.value).toLowerCase() : "";
				var isLocal = !v.sourceTitle;
				var matched = isLocal ? false : true;
				for(var fi = 0; fi < filterTerms.length; fi++) {
					var term = filterTerms[fi];
					var isTypeMatch = TYPE_KEYWORDS[term] ? (term === varType) : (nameLower.indexOf(term) !== -1 || valLower.indexOf(term) !== -1);
					if(isLocal) {
						if(isTypeMatch) { matched = true; break; }
					} else {
						var termMatch = TYPE_KEYWORDS[term] ? (term === varType) : (nameLower.indexOf(term) !== -1 || valLower.indexOf(term) !== -1);
						if(!termMatch) { matched = false; break; }
					}
				}
				if(!matched) continue;
			}

			// Source separator
			var curSource = v.sourceTitle || "(local)";
			if(curSource !== lastSourceTitle) {
				lastSourceTitle = curSource;
				content.appendChild(el("div", "wltc-var-separator", curSource === "(local)" ? "\u2500\u2500 local scope" : "\u2500\u2500 " + curSource));
			}
			shown++;

			var row = el("div", "wltc-var-row");

			// Type badge
			var badge = el("span", "wltc-var-badge", getVarType(v));
			badge.style.background = TYPE_COLORS[getVarType(v)] || "#555";
			row.appendChild(badge);

			// Name
			row.appendChild(el("span", "wltc-var-name", v.name));

			// Params + lazy macro eval
			if(v.params) {
				var paramStr = "(" + v.params.map(function(p) { return p.name + (p["default"] ? ":" + p["default"] : ""); }).join(", ") + ")";
				row.appendChild(el("span", "wltc-var-params", paramStr));
				if(v.value !== undefined && v.value.indexOf("\n") === -1) {
					(function(varEntry, parentRow) {
						var evalEl = el("span", "wltc-var-value");
						evalEl.setAttribute("data-flex-fill", "1");
						parentRow.appendChild(evalEl);
						parentRow._lazyEval = function() {
							evalEl.appendChild(document.createTextNode("= "));
							evalEl.appendChild(evaluateMacroBody(varEntry.value, vars));
						};
						getLazyObserver().observe(parentRow);
					})(v, row);
				}
			} else if(v.value !== undefined) {
				var val = String(v.value).replace(/\n/g, "\\n");
				if(val.length > 80) val = val.substring(0, 80) + "\u2026";
				var valEl = el("span", "wltc-var-value", "= " + val);
				valEl.setAttribute("data-flex-fill", "1");
				row.appendChild(valEl);
			}

			// Spacer if no flex:1 value element
			if(!row.querySelector("[data-flex-fill]")) {
				row.appendChild(el("span", "wltc-var-spacer"));
			}

			content.appendChild(row);

			// Tiddler preview + open buttons
			if(v.value !== undefined && !v.params && ($tw.wiki.tiddlerExists(String(v.value)) || $tw.wiki.isShadowTiddler(String(v.value)))) {
				(function(varName, title, parentRow) {
					var expandable = makeExpandable(
						function() { return $tw.wiki.getTiddlerText(title, ""); },
						{
							anchor: parentRow,
							expanded: expandedState[varName] || false,
							onToggle: function(exp) { expandedState[varName] = exp; },
							onRemove: function() {
								delete expandedState[varName];
								var p = getOpenPreviews(); delete p[varName]; setOpenPreviews(p);
							},
							onShow: function() {
								var p = getOpenPreviews(); p[varName] = true; setOpenPreviews(p);
							}
						}
					);
					var previewBtn = makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "Preview " + title);
					previewBtn.addEventListener("click", function(e) { e.stopPropagation(); expandable.toggle(); });
					parentRow.appendChild(previewBtn);
					if(getOpenPreviews()[varName]) expandable.restore();

					var openBtn = makeIconBtn("wltc-var-action-btn", "{{$:/core/images/link}}", "Open " + title);
					openBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						new $tw.Story().navigateTiddler(title);
					});
					parentRow.appendChild(openBtn);
				})(v.name, String(v.value), row);
			}

			// Definition preview
			if(v.params && v.value !== undefined) {
				(function(varEntry, parentRow) {
					var defKey = "def:" + varEntry.name;
					var expandable = makeExpandable(
						function() {
							var defType = varEntry.isProcedure ? "procedure" : varEntry.isMacro ? "define" : varEntry.isFunction ? "function" : "define";
							var ps = varEntry.params ? varEntry.params.map(function(p) { return p.name + (p["default"] ? ":" + p["default"] : ""); }).join(",") : "";
							return "\\" + defType + " " + varEntry.name + "(" + ps + ")\n" + String(varEntry.value) + "\n\\end";
						},
						{
							anchor: parentRow,
							expanded: expandedState[defKey] || false,
							tallFade: true,
							maxHeight: "6em",
							onToggle: function(exp) { expandedState[defKey] = exp; },
							onRemove: function() { delete expandedState[defKey]; }
						}
					);
					var defBtn = makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "View definition of " + varEntry.name);
					defBtn.addEventListener("click", function(e) { e.stopPropagation(); expandable.toggle(); });
					parentRow.appendChild(defBtn);
					if(expandedState[defKey] !== undefined) expandable.restore();
				})(v, row);
			}

			// Eval button for functions
			if(v.isFunction && v._scopeWidget) {
				(function(varEntry, parentRow) {
					var resultEl = null;
					var evalBtn = makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "Evaluate " + varEntry.name);
					evalBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						if(resultEl) { resultEl.remove(); resultEl = null; return; }
						try {
							var varInfo = varEntry._scopeWidget.getVariableInfo(varEntry.name);
							var filterText = varEntry.value || "(empty)";
							var resultList = varInfo.resultList || [];
							var resultText = varInfo.text !== undefined ? varInfo.text : "";
							resultEl = el("pre", "wltc-eval-result");
							var lines = "filter: " + filterText;
							lines += resultList.length > 0
								? "\nresult (" + resultList.length + "): " + resultList.join(", ")
								: "\nresult: " + (resultText || "(empty)");
							resultEl.textContent = lines;
							resultEl.title = "Click to dismiss";
							resultEl.addEventListener("click", function() { resultEl.remove(); resultEl = null; });
							parentRow.insertAdjacentElement("afterend", resultEl);
						} catch(err) {
							resultEl = el("pre", "wltc-eval-error", "Error: " + err.message);
							resultEl.addEventListener("click", function() { resultEl.remove(); resultEl = null; });
							parentRow.insertAdjacentElement("afterend", resultEl);
						}
					});
					parentRow.appendChild(evalBtn);
				})(v, row);
			}
		}

		if(shown === 0) {
			content.appendChild(el("div", "wltc-empty-state",
				filterLower ? "No variables match \"" + filter + "\"" : "No variables in scope"));
		}
		headerLabel.textContent = "Variables in scope (" + shown + (filterLower ? "/" + vars.length : "") + ")";
	}

	// Initialize filter
	if(sharedState.inspectorFilter) filterInput.value = sharedState.inspectorFilter;
	renderVars(filterInput.value);

	filterInput.addEventListener("input", function() {
		renderVars(filterInput.value);
		if(isInspectorLinked()) {
			sharedState.inspectorFilter = filterInput.value;
			bus.emit("filter-changed", filterInput.value);
		}
	});

	// Bus listeners
	var panelAlive = true;
	function guardedHandler(fn) {
		return function() {
			if(!panelAlive || !document.body.contains(panel)) return;
			fn.apply(null, arguments);
		};
	}

	var onFilterChanged = guardedHandler(function(newFilter) {
		if(isInspectorLinked() && filterInput.value !== newFilter) {
			filterInput.value = newFilter;
			renderVars(newFilter);
		}
	});
	var onLinkedChanged = guardedHandler(function() { updateLinkStyle(); });
	var onLayoutChanged = guardedHandler(function(lay) {
		if(isInspectorLinked()) {
			if(panel.offsetWidth !== lay.width) panel.style.width = Math.max(300, lay.width) + "px";
			if(panel.offsetHeight !== lay.height) panel.style.height = Math.max(150, lay.height) + "px";
		}
	});

	bus.on("filter-changed", onFilterChanged);
	bus.on("linked-changed", onLinkedChanged);
	bus.on("layout-changed", onLayoutChanged);

	var onPageRefreshed = function() {
		if(!panelAlive || !document.body.contains(panel) || sharedState.isResizing) return;
		var connected = relocateOrigin();
		updateLinkStyle();
		if(connected) {
			blinkAndHighlight();
			if(widget) vars = collectVariables(widget);
			renderVars(filterInput.value);
		}
	};
	$tw.hooks.addHook("th-page-refreshed", onPageRefreshed);

	panel._cleanup = function() {
		panelAlive = false;
		bus.off("filter-changed", onFilterChanged);
		bus.off("linked-changed", onLinkedChanged);
		bus.off("layout-changed", onLayoutChanged);
	};

	// Resize handle
	var resizeHandle = el("div", "wltc-panel-resize");
	resizeHandle.appendChild(el("div", "wltc-panel-grip"));
	panel.appendChild(resizeHandle);
	document.body.appendChild(panel);

	// Position
	var cascade = offsetN * 24;
	var left, top;
	if(!isNaN(layout.left) && !isNaN(layout.top)) {
		left = layout.left + cascade;
		top = layout.top + cascade;
	} else {
		left = anchorX + cascade;
		top = anchorY + cascade;
		if(left + layout.width > window.innerWidth) left = Math.max(0, left - layout.width);
		if(top + layout.height > window.innerHeight) top = Math.max(0, top - layout.height);
	}
	panel.style.left = left + "px";
	panel.style.top = top + "px";

	// Bring to front
	panel.addEventListener("mousedown", function() {
		var all = document.querySelectorAll(".sourcepos-var-inspector");
		for(var pi = 0; pi < all.length; pi++) all[pi].style.zIndex = "100001";
		panel.style.zIndex = "100002";
	});

	// Drag & resize
	makeDraggable(header, panel, {
		ignore: function(e) { return e.target === closeBtn || e.target === filterInput; },
		onEnd: function() {
			saveInspectorLayout({ left: String(parseInt(panel.style.left, 10)), top: String(parseInt(panel.style.top, 10)) });
		}
	});
	makeResizable(resizeHandle, panel, {
		onStart: function() { sharedState.isResizing = true; },
		onEnd: function() {
			sharedState.isResizing = false;
			saveInspectorLayout({ width: String(panel.offsetWidth), height: String(panel.offsetHeight) });
		}
	});

	// Escape to close
	var panelHovered = false;
	panel.addEventListener("mouseenter", function() { panelHovered = true; });
	panel.addEventListener("mouseleave", function() { panelHovered = false; });
	var onEscape = function(e) {
		if(e.key === "Escape" && panelHovered) {
			if(panel._unhighlightOrigin) panel._unhighlightOrigin();
			if(panel._cleanup) panel._cleanup();
			panel.remove();
			document.removeEventListener("keydown", onEscape, true);
		}
	};
	document.addEventListener("keydown", onEscape, true);

	// Blink & highlight origin
	var blinkTimer = null;
	panel._unhighlightOrigin = function() {
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		if(originElement) originElement.classList.remove(highlightColorClass, "sourcepos-highlight-blink");
	};
	function blinkAndHighlight() {
		if(!originElement || !document.body.contains(originElement)) return;
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		originElement.classList.remove("sourcepos-highlight-blink", highlightColorClass);
		var count = 0;
		(function doBlink() {
			if(count < 6) {
				originElement.classList.toggle("sourcepos-highlight-blink");
				count++;
				blinkTimer = setTimeout(doBlink, 150);
			} else {
				originElement.classList.remove("sourcepos-highlight-blink");
				originElement.classList.add(highlightColorClass);
				blinkTimer = null;
			}
		})();
	}
	panel._blinkAndHighlight = blinkAndHighlight;
	blinkAndHighlight();
	filterInput.focus();
}

// ── Context Menu ──

function makeMenuItem(text, onClick) {
	var item = el("div", "wltc-menu-item", text);
	item.addEventListener("click", function(e) {
		e.stopPropagation();
		e.preventDefault();
		onClick(e);
	});
	return item;
}

// Open tiddler in edit mode and select source range
function editAndSelect(info, removeMenu) {
	var title = info.tiddler;
	var story = new $tw.Story();
	var tiddler = $tw.wiki.getTiddler(title);
	var draftTitle;
	if(tiddler && tiddler.fields["draft.of"]) {
		draftTitle = title;
	} else {
		draftTitle = $tw.wiki.findDraft(title);
		if(!draftTitle) {
			story.navigateTiddler(title);
			draftTitle = $tw.wiki.generateDraftTitle(title);
			$tw.wiki.addTiddler(new $tw.Tiddler(
				{text: ""}, tiddler,
				{ title: draftTitle, "draft.title": title, "draft.of": title },
				$tw.wiki.getModificationFields()
			));
			var storyList = story.getStoryList();
			var idx = storyList.indexOf(title);
			if(idx !== -1) { storyList[idx] = draftTitle; } else { storyList.unshift(draftTitle); }
			story.saveStoryList(storyList);
		}
	}
	var animDuration = parseInt($tw.wiki.getTiddlerText("$:/config/AnimationDuration", "400"), 10) || 400;
	var selectRange = function(retries) {
		var sel = "[data-tiddler-title=\"" + draftTitle.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]") + "\"]";
		var tiddlerEl = document.querySelector(sel);
		if(!tiddlerEl) { if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		var textarea = null;
		var iframe = tiddlerEl.querySelector("iframe.tc-edit-texteditor-body") || tiddlerEl.querySelector("iframe.tc-edit-texteditor");
		if(iframe && iframe.contentDocument) textarea = iframe.contentDocument.querySelector("textarea");
		if(!textarea) textarea = tiddlerEl.querySelector("textarea.tc-edit-texteditor-body") || tiddlerEl.querySelector("textarea.tc-edit-texteditor");
		if(!textarea) { if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		if(!textarea.value && retries > 0) { setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		var startChar = isNaN(info.charStart) ? 0 : info.charStart;
		var endChar = isNaN(info.charEnd) ? 0 : info.charEnd;
		textarea.focus();
		textarea.setSelectionRange(startChar, endChar);
		var lineNumber = textarea.value.substring(0, startChar).split("\n").length;
		var ownerWindow = textarea.ownerDocument.defaultView || window;
		var lineHeight = parseFloat(ownerWindow.getComputedStyle(textarea).lineHeight) || 16;
		var editorEl = iframe || textarea;
		var selectionScreenY = editorEl.getBoundingClientRect().top + lineNumber * lineHeight;
		if(selectionScreenY < 0 || selectionScreenY > window.innerHeight) {
			window.scrollBy({ top: selectionScreenY - (window.innerHeight / 3), behavior: "instant" });
		}
	};
	setTimeout(function() { selectRange(5); }, animDuration + 100);
	if(removeMenu) removeMenu();
}

// ── Startup ──

exports.startup = function() {
	// Patch TW's popup handler to ignore clicks inside our panels
	var origHandleEvent = $tw.popup.handleEvent.bind($tw.popup);
	$tw.popup.handleEvent = function(event) {
		if(event.type === "click" && event.target.closest &&
			event.target.closest(".sourcepos-var-inspector, #sourcepos-source-viewer, #sourcepos-context-menu")) {
			return;
		}
		return origHandleEvent(event);
	};

	// ── Hover tooltip ──
	var hoverTimer = null, tooltip = null;
	function removeTooltip() {
		if(hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
		if(tooltip) { tooltip.remove(); tooltip = null; }
	}

	document.addEventListener("mouseover", function(event) {
		if(!$tw.wiki.trackSourcePositions || sharedState.isResizing) return;
		var info = findSourcePos(event.target);
		if(!info) { removeTooltip(); return; }
		var mouseX = event.clientX, mouseY = event.clientY;
		removeTooltip();
		hoverTimer = setTimeout(function() {
			hoverTimer = null;
			var text = info.raw;
			var context = info.element.getAttribute("data-source-context");
			if(context) text += "  \u00BB " + context;
			if(info.caller) {
				var callerLines = info.caller.split("\n");
				var short = callerLines.filter(function(c) { return !context || c.indexOf(context) === -1; });
				if(short.length > 3) { short = short.slice(0, 3); short.push("\u2190 +" + (callerLines.length - 3) + " more"); }
				if(short.length > 0) text += "\n" + short.join("\n");
			}
			tooltip = el("div", "wltc-tooltip");
			tooltip.appendChild(el("div", "wltc-tooltip-header", text.split("\n")[0]));
			var restLines = text.split("\n").slice(1).join("\n");
			if(restLines) tooltip.appendChild(el("div", "wltc-tooltip-body", restLines));
			document.body.appendChild(tooltip);
			var rect = info.element.getBoundingClientRect();
			var tipH = tooltip.offsetHeight, tipW = tooltip.offsetWidth;
			var left = Math.max(4, Math.min(rect.left, window.innerWidth - tipW - 4));
			if(rect.top - tipH - 4 >= 0) {
				tooltip.style.left = left + "px";
				tooltip.style.top = (rect.top - tipH - 4) + "px";
			} else {
				tooltip.style.left = Math.min(mouseX + 8, window.innerWidth - tipW - 4) + "px";
				tooltip.style.top = Math.min(mouseY + 16, window.innerHeight - tipH - 4) + "px";
			}
		}, 400);
	}, true);

	document.addEventListener("mouseout", function(event) {
		if(!event.relatedTarget || !findSourcePos(event.relatedTarget)) removeTooltip();
	}, true);

	// ── Context menu ──
	document.addEventListener("contextmenu", function(event) {
		if(!$tw.wiki.trackSourcePositions || event.ctrlKey) return;
		var info = findSourcePos(event.target);
		if(!info) return;
		var existing = document.getElementById("sourcepos-context-menu");
		if(existing) existing.remove();
		event.preventDefault();

		var menu = el("div", "wltc-menu");
		menu.id = "sourcepos-context-menu";
		var closeMenu, closeOnEscape;
		var removeMenu = function() {
			menu.remove();
			document.removeEventListener("click", closeMenu, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
		var menuX = event.clientX, menuY = event.clientY;
		var rangeInfo = sourcePosUtils.parseRange(info.range);

		// Header
		var header = el("div", "wltc-menu-header");
		header.appendChild(el("span", null, info.raw));

		if(rangeInfo) {
			var editBtn = makeIconBtn("wltc-menu-btn-icon", "{{$:/core/images/edit-button}}", "Edit at " + info.range, "14px");
			editBtn.addEventListener("click", function() { editAndSelect(info, removeMenu); });
			header.appendChild(editBtn);

			var viewBtn = makeIconBtn("wltc-menu-btn-icon", "{{$:/core/images/preview-open}}", "Show source", "14px");
			viewBtn.addEventListener("click", function() {
				sourceViewer.addEntry(info, function() { editAndSelect(info); });
				removeMenu();
			});
			header.appendChild(viewBtn);
		}

		var menuCloseBtn = el("span", "wltc-menu-btn", "\u2715");
		menuCloseBtn.addEventListener("click", function() { removeMenu(); });
		header.appendChild(menuCloseBtn);
		menu.appendChild(header);

		// Menu items
		menu.appendChild(makeMenuItem("Copy tiddler title", function() {
			navigator.clipboard.writeText(info.tiddler); removeMenu();
		}));
		menu.appendChild(makeMenuItem("Copy source position", function() {
			var text = info.raw;
			if(info.context) text += "  \u00BB " + info.context;
			if(info.caller) text += "\n" + info.caller;
			navigator.clipboard.writeText(text); removeMenu();
		}));

		var widget = findWidget(event.target);
		if(widget) {
			menu.appendChild(makeMenuItem("Inspect variables", function() {
				var vars = collectVariables(widget);
				removeMenu();
				showVariableInspector(vars, menuX, menuY, info.element, widget);
			}));
		}

		// Inline editor (hidden by default)
		if(!isNaN(info.charStart) && !isNaN(info.charEnd) && info.charEnd > info.charStart
			&& $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditInline", "").trim() === "show") {
			menu.appendChild(makeMenuItem("Edit inline", function() {
				var sourceText = $tw.wiki.getTiddlerText(info.tiddler, "");
				var snippet = sourceText.substring(info.charStart, info.charEnd);
				$tw.wiki.addTiddler(new $tw.Tiddler({
					title: "$:/temp/sourcepos/edit", text: snippet,
					"source-tiddler": info.tiddler, "source-start": String(info.charStart),
					"source-end": String(info.charEnd), "source-pos": info.raw
				}));
				removeMenu();
				var existingEditor = document.getElementById("sourcepos-inline-editor");
				if(existingEditor) existingEditor.remove();
				var editorLayout = $tw.wiki.getTiddler("$:/temp/sourcepos/editor-layout");
				var elF = editorLayout ? editorLayout.fields : {};
				var popupW = Math.max(300, parseInt(elF.width, 10) || 500);
				var popupH = Math.max(150, parseInt(elF.height, 10) || 300);

				var popup = el("div", "wltc-panel");
				popup.id = "sourcepos-inline-editor";
				popup.style.width = popupW + "px";
				popup.style.height = popupH + "px";

				var popupHeader = el("div", "wltc-panel-header");
				popupHeader.style.fontSize = "12px";
				popupHeader.appendChild(el("span", null, info.raw));
				var popCloseBtn = el("span", "wltc-btn-close", "\u2715");
				popCloseBtn.addEventListener("click", function() { popup.remove(); });
				popupHeader.appendChild(popCloseBtn);
				popup.appendChild(popupHeader);

				var editorArea = document.createElement("textarea");
				editorArea.value = snippet;
				editorArea.className = "wltc-editor-textarea";
				popup.appendChild(editorArea);

				var btnBar = el("div", "wltc-editor-btnbar");
				var cancelBtn = document.createElement("button");
				cancelBtn.textContent = "Cancel";
				cancelBtn.className = "wltc-editor-btn-cancel";
				cancelBtn.addEventListener("click", function() { popup.remove(); });
				btnBar.appendChild(cancelBtn);
				var applyBtn = document.createElement("button");
				applyBtn.textContent = "Apply";
				applyBtn.className = "wltc-editor-btn-apply";
				applyBtn.addEventListener("click", function() {
					var tiddler = $tw.wiki.getTiddler(info.tiddler);
					if(tiddler) {
						var fullText = tiddler.fields.text || "";
						$tw.wiki.addTiddler(new $tw.Tiddler(tiddler,
							{ text: fullText.substring(0, info.charStart) + editorArea.value + fullText.substring(info.charEnd) },
							$tw.wiki.getModificationFields()));
					}
					popup.remove();
				});
				btnBar.appendChild(applyBtn);
				popup.appendChild(btnBar);

				var resizeHandle = el("div", "wltc-panel-resize");
				resizeHandle.appendChild(el("div", "wltc-panel-grip"));
				popup.appendChild(resizeHandle);
				document.body.appendChild(popup);

				var rect = info.element.getBoundingClientRect();
				var left = Math.max(4, Math.min(rect.left, window.innerWidth - popupW - 4));
				var top = rect.bottom + 4;
				if(top + popupH > window.innerHeight) top = Math.max(4, rect.top - popupH - 4);
				popup.style.left = left + "px";
				popup.style.top = top + "px";

				makeDraggable(popupHeader, popup, {
					ignore: function(e) { return e.target === popCloseBtn; }
				});
				makeResizable(resizeHandle, popup, {
					onStart: function() { sharedState.isResizing = true; },
					onEnd: function() {
						sharedState.isResizing = false;
						var existing = $tw.wiki.getTiddler("$:/temp/sourcepos/editor-layout");
						var ef = existing ? existing.fields : { title: "$:/temp/sourcepos/editor-layout" };
						$tw.wiki.addTiddler(new $tw.Tiddler(ef, { title: "$:/temp/sourcepos/editor-layout", width: String(popup.offsetWidth), height: String(popup.offsetHeight) }));
					}
				});

				editorArea.focus();
				var onKeydown = function(e) {
					if(e.key === "Escape") { popup.remove(); document.removeEventListener("keydown", onKeydown, true); }
					else if(e.key === "Enter" && e.ctrlKey) { e.preventDefault(); applyBtn.click(); document.removeEventListener("keydown", onKeydown, true); }
				};
				document.addEventListener("keydown", onKeydown, true);
			}));
		}

		menu.appendChild(makeMenuItem("Open " + info.tiddler, function() {
			new $tw.Story().navigateTiddler(info.tiddler); removeMenu();
		}));

		if(rangeInfo && $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditMenuItem", "").trim() === "show") {
			menu.appendChild(makeMenuItem("Edit at " + info.range, function() { editAndSelect(info, removeMenu); }));
		}

		if(info.caller) {
			var callerLines = info.caller.split("\n");
			for(var ci = 0; ci < callerLines.length; ci++) {
				var callerTitle = callerLines[ci].replace(/^\u2190\s*/, "").trim();
				if(callerTitle && callerTitle !== info.tiddler) {
					(function(title) {
						menu.appendChild(makeMenuItem("Open \u2190 " + title, function() {
							new $tw.Story().navigateTiddler(title); removeMenu();
						}));
					})(callerTitle);
				}
			}
		}

		document.body.appendChild(menu);
		var menuW = menu.offsetWidth, menuH = menu.offsetHeight;
		if(menuX + menuW > window.innerWidth) menuX = Math.max(0, menuX - menuW);
		if(menuY + menuH > window.innerHeight) menuY = Math.max(0, menuY - menuH);
		menu.style.left = menuX + "px";
		menu.style.top = menuY + "px";

		closeMenu = function(e) { if(!menu.contains(e.target)) removeMenu(); };
		var menuHovered = false;
		menu.addEventListener("mouseenter", function() { menuHovered = true; });
		menu.addEventListener("mouseleave", function() { menuHovered = false; });
		closeOnEscape = function(e) { if(e.key === "Escape" && menuHovered) removeMenu(); };
		setTimeout(function() {
			document.addEventListener("click", closeMenu, true);
			document.addEventListener("keydown", closeOnEscape, true);
		}, 0);
	}, true);
};
