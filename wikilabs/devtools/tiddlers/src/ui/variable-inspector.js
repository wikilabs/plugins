/*\
title: $:/plugins/wikilabs/devtools/variable-inspector.js
type: application/javascript
module-type: library

Variable Inspector: floating panel showing all variables in scope at an element.

\*/

"use strict";

var utils = require("$:/plugins/wikilabs/devtools/utils.js");
var el = utils.el;
var bus = utils.bus;
var sharedState = utils.state;

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

function show(vars, anchorX, anchorY, originElement, widget) {
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
					var termMatch = TYPE_KEYWORDS[term] ? (term === varType) : (nameLower.indexOf(term) !== -1 || valLower.indexOf(term) !== -1);
					if(isLocal) { if(termMatch) { matched = true; break; } }
					else { if(!termMatch) { matched = false; break; } }
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
			var badge = el("span", "wltc-var-badge", getVarType(v));
			badge.style.background = TYPE_COLORS[getVarType(v)] || "#555";
			row.appendChild(badge);
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

			if(!row.querySelector("[data-flex-fill]")) {
				row.appendChild(el("span", "wltc-var-spacer"));
			}

			content.appendChild(row);

			// Tiddler preview + open buttons
			if(v.value !== undefined && !v.params && ($tw.wiki.tiddlerExists(String(v.value)) || $tw.wiki.isShadowTiddler(String(v.value)))) {
				(function(varName, title, parentRow) {
					var expandable = utils.makeExpandable(
						function() { return $tw.wiki.getTiddlerText(title, ""); },
						{
							anchor: parentRow,
							expanded: expandedState[varName] || false,
							onToggle: function(exp) { expandedState[varName] = exp; },
							onRemove: function() { delete expandedState[varName]; var p = getOpenPreviews(); delete p[varName]; setOpenPreviews(p); },
							onShow: function() { var p = getOpenPreviews(); p[varName] = true; setOpenPreviews(p); }
						}
					);
					var previewBtn = utils.makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "Preview " + title);
					previewBtn.addEventListener("click", function(e) { e.stopPropagation(); expandable.toggle(); });
					parentRow.appendChild(previewBtn);
					if(getOpenPreviews()[varName]) expandable.restore();

					var openBtn = utils.makeIconBtn("wltc-var-action-btn", "{{$:/core/images/link}}", "Open " + title);
					openBtn.addEventListener("click", function(e) { e.stopPropagation(); new $tw.Story().navigateTiddler(title); });
					parentRow.appendChild(openBtn);
				})(v.name, String(v.value), row);
			}

			// Definition preview
			if(v.params && v.value !== undefined) {
				(function(varEntry, parentRow) {
					var defKey = "def:" + varEntry.name;
					var expandable = utils.makeExpandable(
						function() {
							var defType = varEntry.isProcedure ? "procedure" : varEntry.isMacro ? "define" : varEntry.isFunction ? "function" : "define";
							var ps = varEntry.params ? varEntry.params.map(function(p) { return p.name + (p["default"] ? ":" + p["default"] : ""); }).join(",") : "";
							return "\\" + defType + " " + varEntry.name + "(" + ps + ")\n" + String(varEntry.value) + "\n\\end";
						},
						{
							anchor: parentRow, expanded: expandedState[defKey] || false,
							tallFade: true, maxHeight: "6em",
							onToggle: function(exp) { expandedState[defKey] = exp; },
							onRemove: function() { delete expandedState[defKey]; }
						}
					);
					var defBtn = utils.makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "View definition of " + varEntry.name);
					defBtn.addEventListener("click", function(e) { e.stopPropagation(); expandable.toggle(); });
					parentRow.appendChild(defBtn);
					if(expandedState[defKey] !== undefined) expandable.restore();
				})(v, row);
			}

			// Eval button for functions
			if(v.isFunction && v._scopeWidget) {
				(function(varEntry, parentRow) {
					var resultEl = null;
					var evalBtn = utils.makeIconBtn("wltc-var-action-btn", "{{$:/core/images/preview-open}}", "Evaluate " + varEntry.name);
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
		if(isInspectorLinked() && filterInput.value !== newFilter) { filterInput.value = newFilter; renderVars(newFilter); }
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
			if(widget) vars = utils.collectVariables(widget);
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
		left = layout.left + cascade; top = layout.top + cascade;
	} else {
		left = anchorX + cascade; top = anchorY + cascade;
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
	utils.makeDraggable(header, panel, {
		ignore: function(e) { return e.target === closeBtn || e.target === filterInput; },
		onEnd: function() { saveInspectorLayout({ left: String(parseInt(panel.style.left, 10)), top: String(parseInt(panel.style.top, 10)) }); }
	});
	utils.makeResizable(resizeHandle, panel, {
		onStart: function() { sharedState.isResizing = true; },
		onEnd: function() { sharedState.isResizing = false; saveInspectorLayout({ width: String(panel.offsetWidth), height: String(panel.offsetHeight) }); }
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

	// Blink & highlight
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

exports.show = show;
