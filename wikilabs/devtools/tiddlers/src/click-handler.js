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

exports.name = "sourcepos-click";
exports.after = ["sourcepos"];
exports.platforms = ["browser"];
exports.synchronous = true;

// Sanitize rendered HTML to prevent XSS from overridden shadow tiddlers
var renderIconHTML = sourcePosUtils.renderIconHTML;

// Find nearest ancestor with data-source-pos and parse it
function findSourcePos(target) {
	var el = target;
	while(el && el !== document.body) {
		var pos = el.getAttribute && el.getAttribute("data-source-pos");
		if(pos) {
			var parsed = sourcePosUtils.parse(pos);
			if(parsed && parsed.tiddler) {
				return {
					element: el,
					raw: pos,
					range: parsed.range,
					tiddler: parsed.tiddler,
					charStart: parseInt(el.getAttribute("data-source-start"), 10),
					charEnd: parseInt(el.getAttribute("data-source-end"), 10),
					caller: el.getAttribute("data-source-caller") || null,
					context: el.getAttribute("data-source-context") || null
				};
			}
		}
		el = el.parentNode;
	}
	return null;
}

// Find the TiddlyWiki widget associated with a DOM element by walking up the DOM tree
function findWidget(target) {
	var el = target;
	while(el && el !== document.body) {
		if(el._twWidget) return el._twWidget;
		el = el.parentNode;
	}
	return null;
}

// Collect variables in scope by walking up the widget tree from a given widget
function collectVariables(widget) {
	var seen = {};
	var vars = [];
	var w = widget;
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

// Shared bus and state (no TW store writes for UI state)
var bus = sourcePosUtils.bus;
var sharedState = sourcePosUtils.state;

var INSPECTOR_COLORS = [
	"rgba(100, 180, 255, 0.9)",
	"rgba(100, 220, 100, 0.9)",
	"rgba(255, 180, 60, 0.9)",
	"rgba(220, 100, 255, 0.9)",
	"rgba(255, 255, 80, 0.9)",
	"rgba(80, 220, 220, 0.9)"
];

function getNextColorIndex() {
	var idx = sharedState.colorIndex;
	sharedState.colorIndex = idx + 1;
	return idx;
}

function isInspectorLinked() {
	return sharedState.inspectorLinked;
}

function setInspectorLinked(val) {
	sharedState.inspectorLinked = val;
	bus.emit("linked-changed", val);
}

function getOpenPreviews() {
	return sharedState.openPreviews;
}

function setOpenPreviews(obj) {
	sharedState.openPreviews = obj;
	bus.emit("previews-changed", obj);
}

function getInspectorLayout() {
	var s = sharedState.inspectorLayout;
	return {
		width: Math.max(300, s.width || 600),
		height: Math.max(150, s.height || 350),
		left: s.left,
		top: s.top
	};
}

function saveInspectorLayout(props) {
	for(var k in props) {
		sharedState.inspectorLayout[k] = parseInt(props[k], 10);
	}
	bus.emit("layout-changed", sharedState.inspectorLayout);
}

// Show a floating variable inspector panel
function showVariableInspector(vars, anchorX, anchorY, originElement, widget) {
	// Load saved layout
	var layout = getInspectorLayout();
	// Assign a color to this inspector (from tiddler)
	var colorIdx = getNextColorIndex() % INSPECTOR_COLORS.length;
	var highlightColorClass = "sourcepos-highlight-color-" + colorIdx;
	var panelColor = INSPECTOR_COLORS[colorIdx];
	// Offset position if other inspectors exist, so they don't stack exactly
	var existingPanels = document.querySelectorAll(".sourcepos-var-inspector");
	var offsetN = existingPanels.length;
	var panel = document.createElement("div");
	panel.className = "sourcepos-var-inspector wltc-panel";
	panel.style.zIndex = 100001 + offsetN;
	panel.style.width = layout.width + "px";
	panel.style.height = layout.height + "px";
	panel.style.borderTop = "3px solid " + panelColor;
	// Header
	var header = document.createElement("div");
	header.className = "wltc-panel-header";
	// Color indicator dot
	var colorDot = document.createElement("span");
	colorDot.className = "wltc-color-dot";
	colorDot.style.background = panelColor;
	header.appendChild(colorDot);
	var headerLabel = document.createElement("span");
	headerLabel.textContent = "Variables in scope (" + vars.length + ")";
	// Store origin identity so we can relocate it after TW re-renders
	var originSourcePos = originElement && originElement.getAttribute("data-source-pos");
	var originSourceStart = originElement && originElement.getAttribute("data-source-start");
	var originSourceContext = originElement && (originElement.getAttribute("data-source-context") || "");
	var originSourceCaller = originElement && (originElement.getAttribute("data-source-caller") || "");
	var originTagName = originElement && originElement.tagName;
	var disconnected = false;
	// Disconnected indicator — shows in the header when origin is lost
	var disconnectedBadge = document.createElement("span");
	disconnectedBadge.textContent = " \u26A0 disconnected";
	disconnectedBadge.className = "wltc-disconnected-badge";
	function setDisconnected(val) {
		disconnected = val;
		colorDot.style.opacity = val ? "0.3" : "1";
		panel.style.borderTopStyle = val ? "dashed" : "solid";
		disconnectedBadge.style.display = val ? "inline" : "none";
	}
	// Check if a widget is still connected to TW's live widget tree
	function isWidgetAlive(w) {
		var current = w;
		var maxDepth = 500;
		while(current && maxDepth-- > 0) {
			if(current === $tw.rootWidget) return true;
			current = current.parentWidget;
		}
		return false;
	}
	function isElementConnected(el) {
		if(!el || !document.body.contains(el)) return false;
		// Check if the widget behind this element is still in the live tree
		if(el._twWidget && !isWidgetAlive(el._twWidget)) return false;
		return true;
	}
	function relocateOrigin() {
		// Still in DOM with live widget — connected
		if(originElement && isElementConnected(originElement)) {
			if(disconnected) setDisconnected(false);
			return true;
		}
		// Element in DOM but widget dead — mark disconnected, keep reference for relocation
		if(originElement && document.body.contains(originElement) && !isElementConnected(originElement)) {
			if(!disconnected) setDisconnected(true);
			return false;
		}
		if(!originSourcePos) return false;
		// Search for exact replacement: ALL attributes must match.
		// This prevents connecting to a parent/sibling with the same data-source-pos.
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
			if(originElement._twWidget) {
				widget = originElement._twWidget;
			}
			setDisconnected(false);
			return true;
		}
		// Could not find exact match — mark as disconnected
		if(!disconnected) setDisconnected(true);
		return false;
	}
	header.appendChild(headerLabel);
	header.appendChild(disconnectedBadge);
	var headerBtns = document.createElement("span");
	headerBtns.className = "wltc-btn-group";
	// Filter input
	var filterInput = document.createElement("input");
	filterInput.type = "text";
	filterInput.placeholder = "filter...";
	filterInput.className = "wltc-inspector-filter";
	headerBtns.appendChild(filterInput);
	// Link toggle button — links filter/size/previews across all inspector panels
	var linkBtn = document.createElement("span");
	linkBtn.title = "Link filter across panels";
	linkBtn.className = "wltc-inspector-link-btn";
	linkBtn.textContent = "\uD83D\uDD17";
	function updateLinkStyle() {
		linkBtn.style.opacity = isInspectorLinked() ? "1" : "0.4";
	}
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
	// Close button
	var closeBtn = document.createElement("span");
	closeBtn.textContent = "\u2715";
	closeBtn.className = "wltc-btn-close";
	closeBtn.addEventListener("click", function() {
		if(panel._unhighlightOrigin) panel._unhighlightOrigin();
		if(panel._cleanup) panel._cleanup();
		panel.remove();
	});
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);
	panel.appendChild(header);
	// Content area
	var content = document.createElement("div");
	content.className = "wltc-inspector-content";
	panel.appendChild(content);
	// Track expand/collapse state locally (per-panel, survives re-renders but not page reload)
	var expandedState = {};
	// Get the type label for a variable
	function getVarType(v) {
		if(v.isWidget) return "widget";
		if(v.isFunction) return "fn";
		if(v.isProcedure) return "proc";
		if(v.isMacro) return "macro";
		if(v.params) return "def";
		return "var";
	}
	// Evaluate a macro body by substituting $(varName)$ with values from scope
	// Evaluate a macro body, returning a DocumentFragment with coloured spans
	function evaluateMacroBody(body, varsArray) {
		var varMap = Object.create(null);
		for(var i = 0; i < varsArray.length; i++) {
			if(varsArray[i].value !== undefined) {
				varMap[varsArray[i].name] = String(varsArray[i].value);
			}
		}
		var frag = document.createDocumentFragment();
		var lastIndex = 0;
		var re = /\$\(([^)]+)\)\$/g;
		var m;
		while((m = re.exec(body)) !== null) {
			// Text before the match
			if(m.index > lastIndex) {
				frag.appendChild(document.createTextNode(body.substring(lastIndex, m.index)));
			}
			var name = m[1];
			var span = document.createElement("span");
			if(varMap[name] !== undefined) {
				span.textContent = varMap[name];
				span.className = "wltc-subst-match";
			} else {
				span.textContent = "$(" + name + ")$";
				span.className = "wltc-subst-missing";
				span.title = name + " (not in scope)";
			}
			frag.appendChild(span);
			lastIndex = re.lastIndex;
		}
		// Remaining text after last match
		if(lastIndex < body.length) {
			frag.appendChild(document.createTextNode(body.substring(lastIndex)));
		}
		return frag;
	}
	// IntersectionObserver for lazy macro evaluation
	var lazyObserver = null;
	function getLazyObserver() {
		if(!lazyObserver) {
			lazyObserver = new IntersectionObserver(function(entries) {
				for(var i = 0; i < entries.length; i++) {
					if(entries[i].isIntersecting) {
						var el = entries[i].target;
						var cb = el._lazyEval;
						if(cb) {
							cb();
							delete el._lazyEval;
						}
						lazyObserver.unobserve(el);
					}
				}
			}, { root: content, threshold: 0 });
		}
		return lazyObserver;
	}
	// Render variable list into content area
	function renderVars(filter) {
		if(lazyObserver) { lazyObserver.disconnect(); }
		content.innerHTML = "";
		var filterLower = (filter || "").toLowerCase().trim();
		var shown = 0;
		var lastSourceTitle = "\0"; // sentinel — never matches any real title
		// Parse filter: split by spaces.
		// Local variables (no sourceTitle): OR — any term matches.
		// Non-local variables: AND — all terms must match.
		// Type keywords (var, macro, proc, def) match only against type.
		var typeKeywords = { "var": true, "macro": true, "proc": true, "def": true, "fn": true, "widget": true };
		var filterTerms = filterLower ? filterLower.split(/\s+/) : [];
		for(var i = 0; i < vars.length; i++) {
			var v = vars[i];
			if(filterTerms.length > 0) {
				var varType = getVarType(v);
				var nameLower = v.name.toLowerCase();
				var valLower = (v.value !== undefined) ? String(v.value).toLowerCase() : "";
				var isLocal = !v.sourceTitle;
				var matched;
				if(isLocal) {
					// OR: any term matches
					matched = false;
					for(var fi = 0; fi < filterTerms.length; fi++) {
						var term = filterTerms[fi];
						if(typeKeywords[term]) {
							if(term === varType) { matched = true; break; }
						} else {
							if(nameLower.indexOf(term) !== -1 || valLower.indexOf(term) !== -1) { matched = true; break; }
						}
					}
				} else {
					// AND: all terms must match
					matched = true;
					for(var fi = 0; fi < filterTerms.length; fi++) {
						var term = filterTerms[fi];
						if(typeKeywords[term]) {
							if(term !== varType) { matched = false; break; }
						} else {
							if(nameLower.indexOf(term) === -1 && valLower.indexOf(term) === -1) { matched = false; break; }
						}
					}
				}
				if(!matched) continue;
			}
			// Context separator when source tiddler changes
			var curSource = v.sourceTitle || "(local)";
			if(curSource !== lastSourceTitle) {
				lastSourceTitle = curSource;
				var sep = document.createElement("div");
				sep.className = "wltc-var-separator";
				if(curSource === "(local)") {
					sep.textContent = "\u2500\u2500 local scope";
				} else {
					sep.textContent = "\u2500\u2500 " + curSource;
				}
				content.appendChild(sep);
			}
			shown++;
			var row = document.createElement("div");
			row.className = "wltc-var-row";
			// Type badge
			var badge = document.createElement("span");
			badge.className = "wltc-var-badge";
			var type = getVarType(v);
			badge.textContent = type;
			var typeColors = { widget: "#7a2a7a", fn: "#7a2a5a", proc: "#2a7a2a", macro: "#7a5a2a", def: "#2a5a7a", "var": "#555" };
			badge.style.background = typeColors[type] || "#555";
			row.appendChild(badge);
			// Name
			var nameEl = document.createElement("span");
			nameEl.textContent = v.name;
			nameEl.className = "wltc-var-name";
			row.appendChild(nameEl);
			// Value or params
			if(v.params) {
				var paramStr = "(" + v.params.map(function(p) { return p.name + (p["default"] ? ":" + p["default"] : ""); }).join(", ") + ")";
				var paramEl = document.createElement("span");
				paramEl.textContent = paramStr;
				paramEl.className = "wltc-var-params";
				row.appendChild(paramEl);
				// Evaluate macro body lazily when row scrolls into view
				if(v.value !== undefined && v.value.indexOf("\n") === -1) {
					(function(varEntry, parentRow) {
						var evalEl = document.createElement("span");
						evalEl.setAttribute("data-flex-fill", "1");
						evalEl.className = "wltc-var-value";
						parentRow.appendChild(evalEl);
						parentRow._lazyEval = function() {
							evalEl.appendChild(document.createTextNode("= "));
							evalEl.appendChild(evaluateMacroBody(varEntry.value, vars));
						};
						getLazyObserver().observe(parentRow);
					})(v, row);
				}
			} else if(v.value !== undefined) {
				var valEl = document.createElement("span");
				var val = String(v.value).replace(/\n/g, "\\n");
				if(val.length > 80) val = val.substring(0, 80) + "\u2026";
				valEl.textContent = "= " + val;
				valEl.setAttribute("data-flex-fill", "1");
				valEl.className = "wltc-var-value";
				row.appendChild(valEl);
			}
			// Spacer pushes buttons to the right (only if no flex:1 value element already present)
			if(!row.querySelector("[data-flex-fill]")) {
				var spacer = document.createElement("span");
				spacer.className = "wltc-var-spacer";
				row.appendChild(spacer);
			}
			// Append row to DOM first, so preview insertAdjacentElement works
			content.appendChild(row);
			// Buttons — if the value is an existing tiddler or shadow tiddler
			if(v.value !== undefined && !v.params && ($tw.wiki.tiddlerExists(String(v.value)) || $tw.wiki.isShadowTiddler(String(v.value)))) {
				(function(varName, title, parentRow) {
					// Preview button (eye icon) — toggles tiddler content below the row
					var previewBtn = document.createElement("span");
					previewBtn.innerHTML = getViewIconHTML();
					previewBtn.title = "Preview " + title;
					previewBtn.className = "wltc-var-action-btn";
					var prSvg = previewBtn.querySelector("svg");
					if(prSvg) { prSvg.setAttribute("width", "12px"); prSvg.setAttribute("height", "12px"); }
					var previewEl = null;
					var isExpanded = expandedState[varName] || false;
					function showPreview(expanded) {
						var text = $tw.wiki.getTiddlerText(title, "");
						previewEl = document.createElement("div");
						previewEl.className = "wltc-preview";
						var pre = document.createElement("pre");
						pre.textContent = text;
						pre.className = "wltc-preview-code";
						var fade = document.createElement("div");
						fade.className = "wltc-preview-fade";
						previewEl.appendChild(pre);
						previewEl.appendChild(fade);
						function applyState(exp) {
							if(exp) {
								pre.style.maxHeight = "none";
								pre.style.overflow = "auto";
								fade.style.display = "none";
							} else {
								pre.style.maxHeight = "3.6em";
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
							expandedState[varName] = !nowExpanded;
							applyState(!nowExpanded);
						});
						parentRow.insertAdjacentElement("afterend", previewEl);
					}
					previewBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						if(previewEl) {
							previewEl.remove();
							previewEl = null;
							delete expandedState[varName];
							var previews = getOpenPreviews();
							delete previews[varName];
							setOpenPreviews(previews);
							return;
						}
						showPreview(false);
						var previews = getOpenPreviews();
						previews[varName] = true;
						setOpenPreviews(previews);
					});
					parentRow.appendChild(previewBtn);
					// Restore preview if it was open before re-render
					var savedPreviews = getOpenPreviews();
					if(savedPreviews[varName]) {
						showPreview(isExpanded);
					}
					// Link button (link icon) — opens tiddler in story river
					var linkBtn = document.createElement("span");
					linkBtn.innerHTML = getLinkIconHTML();
					linkBtn.title = "Open " + title;
					linkBtn.className = "wltc-var-action-btn";
					var lnSvg = linkBtn.querySelector("svg");
					if(lnSvg) { lnSvg.setAttribute("width", "12px"); lnSvg.setAttribute("height", "12px"); }
					linkBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						new $tw.Story().navigateTiddler(title);
					});
					parentRow.appendChild(linkBtn);
				})(v.name, String(v.value), row);
			}
			// Definition preview for macros, procedures, and definitions with a body
			if(v.params && v.value !== undefined) {
				(function(varEntry, parentRow) {
					var defBtn = document.createElement("span");
					defBtn.innerHTML = getViewIconHTML();
					defBtn.title = "View definition of " + varEntry.name;
					defBtn.className = "wltc-var-action-btn";
					var defSvg = defBtn.querySelector("svg");
					if(defSvg) { defSvg.setAttribute("width", "12px"); defSvg.setAttribute("height", "12px"); }
					var defEl = null;
					var defKey = "def:" + varEntry.name;
					var isDefExpanded = expandedState[defKey] || false;
					function showDef(expanded) {
						defEl = document.createElement("div");
						defEl.className = "wltc-preview";
						var pre = document.createElement("pre");
						// Build full definition with pragma header and \end
						var defType = varEntry.isProcedure ? "procedure" : varEntry.isMacro ? "define" : varEntry.isFunction ? "function" : "define";
						var paramStr = varEntry.params ? varEntry.params.map(function(p) {
							return p.name + (p["default"] ? ":" + p["default"] : "");
						}).join(",") : "";
						var header = "\\" + defType + " " + varEntry.name + "(" + paramStr + ")\n";
						var footer = "\n\\end";
						pre.textContent = header + String(varEntry.value) + footer;
						pre.className = "wltc-preview-code";
						var fade = document.createElement("div");
						fade.className = "wltc-preview-fade wltc-preview-fade-tall";
						defEl.appendChild(pre);
						defEl.appendChild(fade);
						function applyState(exp) {
							if(exp) {
								pre.style.maxHeight = "none";
								pre.style.overflow = "auto";
								fade.style.display = "none";
							} else {
								pre.style.maxHeight = "6em";
								pre.style.overflow = "hidden";
								// Only show fade if content is actually truncated
								requestAnimationFrame(function() {
									fade.style.display = pre.scrollHeight > pre.clientHeight ? "" : "none";
								});
							}
						}
						applyState(expanded);
						defEl.title = "Click to expand/collapse";
						defEl.addEventListener("click", function() {
							var nowExpanded = pre.style.maxHeight === "none";
							expandedState[defKey] = !nowExpanded;
							applyState(!nowExpanded);
						});
						parentRow.insertAdjacentElement("afterend", defEl);
					}
					defBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						if(defEl) {
							defEl.remove();
							defEl = null;
							delete expandedState[defKey];
						} else {
							showDef(isDefExpanded);
						}
					});
					parentRow.appendChild(defBtn);
					// Restore if it was open before re-render
					if(expandedState[defKey] !== undefined) {
						showDef(isDefExpanded);
					}
				})(v, row);
			}
			// Evaluate button for function definitions — shows the filter result
			if(v.isFunction && v._scopeWidget) {
				(function(varEntry, parentRow) {
					var evalBtn = document.createElement("span");
					evalBtn.innerHTML = getViewIconHTML();
					evalBtn.title = "Evaluate " + varEntry.name;
					evalBtn.className = "wltc-var-action-btn";
					var evSvg = evalBtn.querySelector("svg");
					if(evSvg) { evSvg.setAttribute("width", "12px"); evSvg.setAttribute("height", "12px"); }
					var resultEl = null;
					evalBtn.addEventListener("click", function(e) {
						e.stopPropagation();
						if(resultEl) {
							resultEl.remove();
							resultEl = null;
							return;
						}
						try {
							// Evaluate from the scope widget (not the defining widget)
							// so local variables like <$let> bindings affect the result
							var evalWidget = varEntry._scopeWidget;
							var varInfo = evalWidget.getVariableInfo(varEntry.name);
							var filterText = varEntry.value || "(empty)";
							var resultList = varInfo.resultList || [];
							var resultText = varInfo.text !== undefined ? varInfo.text : "";
							resultEl = document.createElement("pre");
							var lines = "filter: " + filterText;
							if(resultList.length > 0) {
								lines += "\nresult (" + resultList.length + "): " + resultList.join(", ");
							} else {
								lines += "\nresult: " + (resultText || "(empty)");
							}
							resultEl.textContent = lines;
							resultEl.className = "wltc-eval-result";
							resultEl.title = "Click to dismiss";
							resultEl.addEventListener("click", function() {
								resultEl.remove();
								resultEl = null;
							});
							parentRow.insertAdjacentElement("afterend", resultEl);
						} catch(err) {
							resultEl = document.createElement("pre");
							resultEl.textContent = "Error: " + err.message;
							resultEl.className = "wltc-eval-error";
							resultEl.addEventListener("click", function() { resultEl.remove(); resultEl = null; });
							parentRow.insertAdjacentElement("afterend", resultEl);
						}
					});
					parentRow.appendChild(evalBtn);
				})(v, row);
			}
		}
		if(shown === 0) {
			var empty = document.createElement("div");
			empty.textContent = filterLower ? "No variables match \"" + filter + "\"" : "No variables in scope";
			empty.className = "wltc-empty-state";
			content.appendChild(empty);
		}
		headerLabel.textContent = "Variables in scope (" + shown + (filterLower ? "/" + vars.length : "") + ")";
	}
	// Initialize filter from shared state
	if(sharedState.inspectorFilter) {
		filterInput.value = sharedState.inspectorFilter;
	}
	renderVars(filterInput.value);
	// When typing, update local view and broadcast via bus if linked
	filterInput.addEventListener("input", function() {
		renderVars(filterInput.value);
		if(isInspectorLinked()) {
			sharedState.inspectorFilter = filterInput.value;
			bus.emit("filter-changed", filterInput.value);
		}
	});
	// Listen for filter changes from other panels via bus
	var onFilterChanged = function(newFilter) {
		if(!panelAlive || !document.body.contains(panel)) return;
		if(isInspectorLinked() && filterInput.value !== newFilter) {
			filterInput.value = newFilter;
			renderVars(newFilter);
		}
	};
	bus.on("filter-changed", onFilterChanged);
	// Listen for linked state changes from other panels
	var onLinkedChanged = function() {
		if(!panelAlive || !document.body.contains(panel)) return;
		updateLinkStyle();
	};
	bus.on("linked-changed", onLinkedChanged);
	// Listen for layout changes from other panels (size only, not position)
	var onLayoutChanged = function(layout) {
		if(!panelAlive || !document.body.contains(panel)) return;
		if(isInspectorLinked()) {
			if(panel.offsetWidth !== layout.width) {
				panel.style.width = Math.max(300, layout.width) + "px";
			}
			if(panel.offsetHeight !== layout.height) {
				panel.style.height = Math.max(150, layout.height) + "px";
			}
		}
	};
	bus.on("layout-changed", onLayoutChanged);
	// Hook into TW's th-page-refreshed — fires AFTER the DOM has been updated.
	// This is the READ-ONLY path: relocate origin elements, re-collect variables.
	// No store writes here — only observing TW changes for live variable updates.
	var panelAlive = true;
	var onPageRefreshed = function() {
		if(!panelAlive || !document.body.contains(panel) || sharedState.isResizing) return;
		// Relocate origin element (may have been replaced by TW's refresh)
		var connected = relocateOrigin();
		updateLinkStyle();
		if(connected) {
			// Auto-highlight the new origin element (blink + persistent class)
			blinkAndHighlight();
			// Re-collect variables and re-render
			if(widget) {
				vars = collectVariables(widget);
			}
			renderVars(filterInput.value);
		}
		// When disconnected, keep showing last known vars (don't re-render)
	};
	$tw.hooks.addHook("th-page-refreshed", onPageRefreshed);
	panel._cleanup = function() {
		panelAlive = false;
		bus.off("filter-changed", onFilterChanged);
		bus.off("linked-changed", onLinkedChanged);
		bus.off("layout-changed", onLayoutChanged);
	};
	// Resize handle
	var resizeHandle = document.createElement("div");
	resizeHandle.className = "wltc-panel-resize";
	var grip = document.createElement("div");
	grip.className = "wltc-panel-grip";
	resizeHandle.appendChild(grip);
	panel.appendChild(resizeHandle);
	document.body.appendChild(panel);
	// Position: use saved layout if available, otherwise near click
	// Cascade offset so multiple inspectors don't stack exactly
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
	// Bring to front on mousedown anywhere in panel
	panel.addEventListener("mousedown", function() {
		var all = document.querySelectorAll(".sourcepos-var-inspector");
		for(var pi = 0; pi < all.length; pi++) {
			all[pi].style.zIndex = "100001";
		}
		panel.style.zIndex = "100002";
	});
	// Drag to move
	header.addEventListener("mousedown", function(e) {
		if(e.target === closeBtn || e.target === filterInput) return;
		e.preventDefault();
		var dragStartX = e.clientX;
		var dragStartY = e.clientY;
		var dragOrigLeft = parseInt(panel.style.left, 10);
		var dragOrigTop = parseInt(panel.style.top, 10);
		var onDragMove = function(me) {
			panel.style.left = Math.max(0, dragOrigLeft + me.clientX - dragStartX) + "px";
			panel.style.top = Math.max(0, dragOrigTop + me.clientY - dragStartY) + "px";
		};
		var onDragEnd = function() {
			document.removeEventListener("mousemove", onDragMove);
			document.removeEventListener("mouseup", onDragEnd);
			saveInspectorLayout({ left: String(parseInt(panel.style.left, 10)), top: String(parseInt(panel.style.top, 10)) });
		};
		document.addEventListener("mousemove", onDragMove);
		document.addEventListener("mouseup", onDragEnd);
	});
	// Resize
	resizeHandle.addEventListener("mousedown", function(e) {
		e.preventDefault();
		e.stopPropagation();
		sharedState.isResizing = true;
		var resizeStartX = e.clientX;
		var resizeStartY = e.clientY;
		var origW = panel.offsetWidth;
		var origH = panel.offsetHeight;
		var onResizeMove = function(me) {
			panel.style.width = Math.max(300, origW + me.clientX - resizeStartX) + "px";
			panel.style.height = Math.max(150, origH + me.clientY - resizeStartY) + "px";
		};
		var onResizeEnd = function() {
			sharedState.isResizing = false;
			document.removeEventListener("mousemove", onResizeMove);
			document.removeEventListener("mouseup", onResizeEnd);
			saveInspectorLayout({ width: String(panel.offsetWidth), height: String(panel.offsetHeight) });
		};
		document.addEventListener("mousemove", onResizeMove);
		document.addEventListener("mouseup", onResizeEnd);
	});
	// Close on Escape — only if mouse is over the panel
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
	// Highlight origin element with per-panel color
	var blinkTimer = null;
	var blinkClass = "sourcepos-highlight-blink";
	panel._unhighlightOrigin = function() {
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		if(originElement) {
			originElement.classList.remove(highlightColorClass);
			originElement.classList.remove(blinkClass);
		}
	};
	// Blink the origin element 3 times then apply persistent highlight
	function blinkAndHighlight() {
		if(!originElement || !document.body.contains(originElement)) return;
		// Clear any previous blink/highlight
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		originElement.classList.remove(blinkClass);
		originElement.classList.remove(highlightColorClass);
		var count = 0;
		(function doBlink() {
			if(count < 6) {
				originElement.classList.toggle(blinkClass);
				count++;
				blinkTimer = setTimeout(doBlink, 150);
			} else {
				originElement.classList.remove(blinkClass);
				originElement.classList.add(highlightColorClass);
				blinkTimer = null;
			}
		})();
	}
	panel._blinkAndHighlight = blinkAndHighlight;
	blinkAndHighlight();
	// Focus filter input
	filterInput.focus();
}

function makeMenuItem(text, onClick) {
	var item = document.createElement("div");
	item.textContent = text;
	item.className = "wltc-menu-item";
	item.addEventListener("click", function(e) {
		e.stopPropagation();
		e.preventDefault();
		onClick(e);
	});
	return item;
}

// Render icons once at startup and cache them
var editIconHTML = "";
function getEditIconHTML() {
	if(!editIconHTML) {
		editIconHTML = renderIconHTML("{{$:/core/images/edit-button}}");
	}
	return editIconHTML;
}

var viewIconHTML = "";
function getViewIconHTML() {
	if(!viewIconHTML) {
		viewIconHTML = renderIconHTML("{{$:/core/images/preview-open}}");
	}
	return viewIconHTML;
}

var linkIconHTML = "";
function getLinkIconHTML() {
	if(!linkIconHTML) {
		linkIconHTML = renderIconHTML("{{$:/core/images/link}}");
	}
	return linkIconHTML;
}

exports.startup = function() {
	// Patch TW's popup handler to ignore clicks inside sourcepos panels.
	// TW's Popup uses a capture-phase click listener on rootElement to dismiss popups.
	// We can't use stopPropagation (it blocks our own handlers too).
	// Instead, wrap handleEvent to skip clicks inside our panels.
	var origHandleEvent = $tw.popup.handleEvent.bind($tw.popup);
	$tw.popup.handleEvent = function(event) {
		if(event.type === "click" && event.target.closest &&
			event.target.closest(".sourcepos-var-inspector, #sourcepos-source-viewer, #sourcepos-context-menu")) {
			return;
		}
		return origHandleEvent(event);
	};
	// Hover tooltip with 400ms delay
	var hoverTimer = null;
	var tooltip = null;
	function removeTooltip() {
		if(hoverTimer) {
			clearTimeout(hoverTimer);
			hoverTimer = null;
		}
		if(tooltip) {
			tooltip.remove();
			tooltip = null;
		}
	}
	document.addEventListener("mouseover", function(event) {
		if(!$tw.wiki.trackSourcePositions || sharedState.isResizing) {
			return;
		}
		var info = findSourcePos(event.target);
		if(!info) {
			removeTooltip();
			return;
		}
		// Capture mouse position for tooltip placement
		var mouseX = event.clientX;
		var mouseY = event.clientY;
		// Restart timer on each mouseover (handles moving between nested elements)
		removeTooltip();
		hoverTimer = setTimeout(function() {
			hoverTimer = null;
			// Build tooltip text
			var text = info.raw;
			var context = info.element.getAttribute("data-source-context");
			if(context) {
				text += "  \u00BB " + context;
			}
			// Shorten caller chain for tooltip: max 3, skip callers matching context
			if(info.caller) {
				var callerLines = info.caller.split("\n");
				var short = callerLines.filter(function(c) {
					return !context || c.indexOf(context) === -1;
				});
				if(short.length > 3) {
					short = short.slice(0, 3);
					short.push("\u2190 +" + (callerLines.length - 3) + " more");
				}
				if(short.length > 0) {
					text += "\n" + short.join("\n");
				}
			}
			tooltip = document.createElement("div");
			tooltip.className = "wltc-tooltip";
			// Header line (bigger)
			var tipHeader = document.createElement("div");
			tipHeader.textContent = text.split("\n")[0];
			tipHeader.className = "wltc-tooltip-header";
			tooltip.appendChild(tipHeader);
			// Remaining lines (smaller)
			var restLines = text.split("\n").slice(1).join("\n");
			if(restLines) {
				var tipBody = document.createElement("div");
				tipBody.textContent = restLines;
				tipBody.className = "wltc-tooltip-body";
				tooltip.appendChild(tipBody);
			}
			document.body.appendChild(tooltip);
			// Position: prefer above the element, fall back to near mouse if no space
			var rect = info.element.getBoundingClientRect();
			var tipHeight = tooltip.offsetHeight;
			var tipWidth = tooltip.offsetWidth;
			var left = Math.min(rect.left, window.innerWidth - tipWidth - 4);
			if(left < 0) left = 4;
			if(rect.top - tipHeight - 4 >= 0) {
				// Enough space above
				tooltip.style.left = left + "px";
				tooltip.style.top = (rect.top - tipHeight - 4) + "px";
			} else {
				// Not enough space above — show near mouse, below cursor
				tooltip.style.left = Math.min(mouseX + 8, window.innerWidth - tipWidth - 4) + "px";
				tooltip.style.top = Math.min(mouseY + 16, window.innerHeight - tipHeight - 4) + "px";
			}
		}, 400);
	}, true);
	document.addEventListener("mouseout", function(event) {
		if(!event.relatedTarget || !findSourcePos(event.relatedTarget)) {
			removeTooltip();
		}
	}, true);
	// Right-click: show sourcepos context menu (Ctrl+right-click = native browser menu)
	document.addEventListener("contextmenu", function(event) {
		if(!$tw.wiki.trackSourcePositions) {
			return;
		}
		// Ctrl+right-click: let native browser context menu through
		if(event.ctrlKey) {
			return;
		}
		var info = findSourcePos(event.target);
		if(!info) {
			return;
		}
		// Remove any previous sourcepos context menu
		var existing = document.getElementById("sourcepos-context-menu");
		if(existing) {
			existing.remove();
		}
		event.preventDefault();
		// Create context menu
		var menu = document.createElement("div");
		menu.id = "sourcepos-context-menu";
		menu.className = "wltc-menu";
		// Cleanup function: removes menu and its document-level event listeners
		var closeMenu, closeOnEscape;
		var removeMenu = function() {
			menu.remove();
			document.removeEventListener("click", closeMenu, true);
			document.removeEventListener("keydown", closeOnEscape, true);
		};
		// Position set after appending (need dimensions first)
		var menuX = event.clientX;
		var menuY = event.clientY;
		// Extract the edit-at-position function so it can be used by both icon and menu item
		var rangeInfo = sourcePosUtils.parseRange(info.range);
		var editAtPosition = function() {
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
					var draftTiddler = new $tw.Tiddler(
						{text: ""},
						tiddler,
						{
							title: draftTitle,
							"draft.title": title,
							"draft.of": title
						},
						$tw.wiki.getModificationFields()
					);
					$tw.wiki.addTiddler(draftTiddler);
					var storyList = story.getStoryList();
					var idx = storyList.indexOf(title);
					if(idx !== -1) {
						storyList[idx] = draftTitle;
					} else {
						storyList.unshift(draftTitle);
					}
					story.saveStoryList(storyList);
				}
			}
			var animDuration = parseInt($tw.wiki.getTiddlerText("$:/config/AnimationDuration", "400"), 10) || 400;
			var selectRange = function(retries) {
				var tiddlerEl = document.querySelector("[data-tiddler-title=\"" + draftTitle.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]") + "\"]");
				if(!tiddlerEl) {
					if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200);
					return;
				}
				var textarea = null;
				var iframe = tiddlerEl.querySelector("iframe.tc-edit-texteditor-body");
				if(!iframe) {
					iframe = tiddlerEl.querySelector("iframe.tc-edit-texteditor");
				}
				if(iframe && iframe.contentDocument) {
					textarea = iframe.contentDocument.querySelector("textarea");
				}
				if(!textarea) {
					textarea = tiddlerEl.querySelector("textarea.tc-edit-texteditor-body");
				}
				if(!textarea) {
					textarea = tiddlerEl.querySelector("textarea.tc-edit-texteditor");
				}
				if(!textarea) {
					if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200);
					return;
				}
				if(!textarea.value && retries > 0) {
					setTimeout(function() { selectRange(retries - 1); }, 200);
					return;
				}
				var startChar = info.charStart;
				var endChar = info.charEnd;
				if(isNaN(startChar) || isNaN(endChar)) {
					startChar = 0;
					endChar = 0;
				}
				textarea.focus();
				textarea.setSelectionRange(startChar, endChar);
				var textBeforeStart = textarea.value.substring(0, startChar);
				var lineNumber = textBeforeStart.split("\n").length;
				var ownerWindow = textarea.ownerDocument.defaultView || window;
				var lineHeight = parseFloat(ownerWindow.getComputedStyle(textarea).lineHeight) || 16;
				var selectionOffsetInTextarea = lineNumber * lineHeight;
				var editorEl = iframe || textarea;
				var editorRect = editorEl.getBoundingClientRect();
				var selectionScreenY = editorRect.top + selectionOffsetInTextarea;
				if(selectionScreenY < 0 || selectionScreenY > window.innerHeight) {
					window.scrollBy({ top: selectionScreenY - (window.innerHeight / 3), behavior: "instant" });
				}
			};
			setTimeout(function() { selectRange(5); }, animDuration + 100);
			removeMenu();
		};
		// Header: source position with edit icon button
		var header = document.createElement("div");
		header.className = "wltc-menu-header";
		var headerText = document.createElement("span");
		headerText.textContent = info.raw;
		header.appendChild(headerText);
		// Edit icon button
		if(rangeInfo) {
			var editBtn = document.createElement("span");
			editBtn.innerHTML = getEditIconHTML();
			editBtn.title = "Edit at " + info.range;
			editBtn.className = "wltc-menu-btn-icon";
			var svg = editBtn.querySelector("svg");
			if(svg) { svg.setAttribute("width", "14px"); svg.setAttribute("height", "14px"); }
			editBtn.addEventListener("click", editAtPosition);
			header.appendChild(editBtn);
		}
		// Show source icon button
		if(rangeInfo) {
			var viewBtn = document.createElement("span");
			viewBtn.innerHTML = getViewIconHTML();
			viewBtn.title = "Show source";
			viewBtn.className = "wltc-menu-btn-icon";
			var viewSvg = viewBtn.querySelector("svg");
			if(viewSvg) { viewSvg.setAttribute("width", "14px"); viewSvg.setAttribute("height", "14px"); }
			viewBtn.addEventListener("click", function() {
				sourceViewer.addEntry(info, editAtPosition);
				removeMenu();
			});
			header.appendChild(viewBtn);
		}
		// Close button
		var menuCloseBtn = document.createElement("span");
		menuCloseBtn.textContent = "\u2715";
		menuCloseBtn.className = "wltc-menu-btn";
		menuCloseBtn.addEventListener("click", function() { removeMenu(); });
		header.appendChild(menuCloseBtn);
		menu.appendChild(header);
		// Menu item: Copy tiddler title
		menu.appendChild(makeMenuItem("Copy tiddler title", function() {
			navigator.clipboard.writeText(info.tiddler);
			removeMenu();
		}));
		// Menu item: Copy source position (includes context and caller chain)
		menu.appendChild(makeMenuItem("Copy source position", function() {
			var text = info.raw;
			if(info.context) {
				text += "  \u00BB " + info.context;
			}
			if(info.caller) {
				text += "\n" + info.caller;
			}
			navigator.clipboard.writeText(text);
			removeMenu();
		}));
		// Menu item: Inspect variables in scope at this element
		var widget = findWidget(event.target);
		if(widget) {
			menu.appendChild(makeMenuItem("Inspect variables", function() {
				var vars = collectVariables(widget);
				removeMenu();
				showVariableInspector(vars, menuX, menuY, info.element, widget);
			}));
		}
		// Menu item: Edit inline — opens a popup with the source text in a temp tiddler (hidden by default)
		if(!isNaN(info.charStart) && !isNaN(info.charEnd) && info.charEnd > info.charStart
			&& $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditInline", "").trim() === "show") {
			menu.appendChild(makeMenuItem("Edit inline", function() {
				var sourceText = $tw.wiki.getTiddlerText(info.tiddler, "");
				var snippet = sourceText.substring(info.charStart, info.charEnd);
				var tempTitle = "$:/temp/sourcepos/edit";
				// Store edit metadata
				$tw.wiki.addTiddler(new $tw.Tiddler({
					title: tempTitle,
					text: snippet,
					"source-tiddler": info.tiddler,
					"source-start": String(info.charStart),
					"source-end": String(info.charEnd),
					"source-pos": info.raw
				}));
				removeMenu();
				// Remove any existing inline editor
				var existingEditor = document.getElementById("sourcepos-inline-editor");
				if(existingEditor) existingEditor.remove();
				// Load saved layout from data tiddler
				var editorLayoutTitle = "$:/temp/sourcepos/editor-layout";
				var editorLayout = $tw.wiki.getTiddler(editorLayoutTitle);
				var elFields = editorLayout ? editorLayout.fields : {};
				var popupWidth = Math.max(300, parseInt(elFields.width, 10) || 500);
				var popupHeight = Math.max(150, parseInt(elFields.height, 10) || 300);
				// Create the inline editor popup
				var popup = document.createElement("div");
				popup.id = "sourcepos-inline-editor";
				popup.className = "wltc-panel";
				popup.style.width = popupWidth + "px";
				popup.style.height = popupHeight + "px";
				// Header (draggable)
				var popupHeader = document.createElement("div");
				popupHeader.className = "wltc-panel-header";
				popupHeader.style.fontSize = "12px";
				var headerLabel = document.createElement("span");
				headerLabel.textContent = info.raw;
				popupHeader.appendChild(headerLabel);
				// Close button
				var closeBtn = document.createElement("span");
				closeBtn.textContent = "\u2715";
				closeBtn.className = "wltc-btn-close";
				closeBtn.addEventListener("click", function() { popup.remove(); });
				popupHeader.appendChild(closeBtn);
				popup.appendChild(popupHeader);
				// Textarea for editing — fills remaining space
				var editorArea = document.createElement("textarea");
				editorArea.value = snippet;
				editorArea.className = "wltc-editor-textarea";
				popup.appendChild(editorArea);
				// Button bar
				var btnBar = document.createElement("div");
				btnBar.className = "wltc-editor-btnbar";
				var cancelBtn = document.createElement("button");
				cancelBtn.textContent = "Cancel";
				cancelBtn.className = "wltc-editor-btn-cancel";
				cancelBtn.addEventListener("click", function() { popup.remove(); });
				btnBar.appendChild(cancelBtn);
				var applyBtn = document.createElement("button");
				applyBtn.textContent = "Apply";
				applyBtn.className = "wltc-editor-btn-apply";
				applyBtn.addEventListener("click", function() {
					var newText = editorArea.value;
					var tiddler = $tw.wiki.getTiddler(info.tiddler);
					if(tiddler) {
						var fullText = tiddler.fields.text || "";
						var updated = fullText.substring(0, info.charStart) + newText + fullText.substring(info.charEnd);
						$tw.wiki.addTiddler(new $tw.Tiddler(tiddler, { text: updated }, $tw.wiki.getModificationFields()));
					}
					popup.remove();
				});
				btnBar.appendChild(applyBtn);
				popup.appendChild(btnBar);
				// Resize handle (bottom-right corner)
				var resizeHandle = document.createElement("div");
				resizeHandle.className = "wltc-panel-resize";
				// Draw resize grip lines
				var grip = document.createElement("div");
				grip.className = "wltc-panel-grip";
				resizeHandle.appendChild(grip);
				popup.appendChild(resizeHandle);
				document.body.appendChild(popup);
				// Position below the element
				var rect = info.element.getBoundingClientRect();
				var left = Math.max(4, Math.min(rect.left, window.innerWidth - popupWidth - 4));
				var top = rect.bottom + 4;
				if(top + popupHeight > window.innerHeight) {
					top = Math.max(4, rect.top - popupHeight - 4);
				}
				popup.style.left = left + "px";
				popup.style.top = top + "px";
				// Drag to move (via header)
				var dragStartX, dragStartY, dragOrigLeft, dragOrigTop;
				popupHeader.addEventListener("mousedown", function(e) {
					if(e.target === closeBtn) return;
					e.preventDefault();
					dragStartX = e.clientX;
					dragStartY = e.clientY;
					dragOrigLeft = parseInt(popup.style.left, 10);
					dragOrigTop = parseInt(popup.style.top, 10);
					var onDragMove = function(me) {
						popup.style.left = Math.max(0, dragOrigLeft + me.clientX - dragStartX) + "px";
						popup.style.top = Math.max(0, dragOrigTop + me.clientY - dragStartY) + "px";
					};
					var onDragEnd = function() {
						document.removeEventListener("mousemove", onDragMove);
						document.removeEventListener("mouseup", onDragEnd);
					};
					document.addEventListener("mousemove", onDragMove);
					document.addEventListener("mouseup", onDragEnd);
				});
				// Resize (via handle)
				resizeHandle.addEventListener("mousedown", function(e) {
					e.preventDefault();
					e.stopPropagation();
					sharedState.isResizing = true;
					var resizeStartX = e.clientX;
					var resizeStartY = e.clientY;
					var origW = popup.offsetWidth;
					var origH = popup.offsetHeight;
					var onResizeMove = function(me) {
						var newW = Math.max(300, origW + me.clientX - resizeStartX);
						var newH = Math.max(150, origH + me.clientY - resizeStartY);
						popup.style.width = newW + "px";
						popup.style.height = newH + "px";
					};
					var onResizeEnd = function() {
						sharedState.isResizing = false;
						document.removeEventListener("mousemove", onResizeMove);
						document.removeEventListener("mouseup", onResizeEnd);
						var el = $tw.wiki.getTiddler(editorLayoutTitle);
						var ef = el ? el.fields : { title: editorLayoutTitle };
						$tw.wiki.addTiddler(new $tw.Tiddler(ef, { title: editorLayoutTitle, width: String(popup.offsetWidth), height: String(popup.offsetHeight) }));
					};
					document.addEventListener("mousemove", onResizeMove);
					document.addEventListener("mouseup", onResizeEnd);
				});
				// Focus the textarea
				editorArea.focus();
				// Keyboard shortcuts: Escape = cancel, Ctrl+Enter = apply
				var onKeydown = function(e) {
					if(e.key === "Escape") {
						popup.remove();
						document.removeEventListener("keydown", onKeydown, true);
					} else if(e.key === "Enter" && e.ctrlKey) {
						e.preventDefault();
						applyBtn.click();
						document.removeEventListener("keydown", onKeydown, true);
					}
				};
				document.addEventListener("keydown", onKeydown, true);
			}));
		}
		// Menu item: Open source tiddler
		menu.appendChild(makeMenuItem("Open " + info.tiddler, function() {
			new $tw.Story().navigateTiddler(info.tiddler);
			removeMenu();
		}));
		// Optional menu item: "Edit at" — shown when config tiddler is set to "show"
		if(rangeInfo && $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditMenuItem", "").trim() === "show") {
			menu.appendChild(makeMenuItem("Edit at " + info.range, editAtPosition));
		}
		// Menu items: Open each caller in the chain
		if(info.caller) {
			var callerLines = info.caller.split("\n");
			for(var ci = 0; ci < callerLines.length; ci++) {
				var callerTitle = callerLines[ci].replace(/^\u2190\s*/, "").trim();
				if(callerTitle && callerTitle !== info.tiddler) {
					(function(title) {
						menu.appendChild(makeMenuItem("Open \u2190 " + title, function() {
							new $tw.Story().navigateTiddler(title);
							removeMenu();
						}));
					})(callerTitle);
				}
			}
		}
		document.body.appendChild(menu);
		// Adjust position to fit within viewport
		var menuW = menu.offsetWidth;
		var menuH = menu.offsetHeight;
		// Horizontal: prefer right of mouse, fall back to left
		if(menuX + menuW > window.innerWidth) {
			menuX = Math.max(0, menuX - menuW);
		}
		// Vertical: prefer below mouse, fall back to above
		if(menuY + menuH > window.innerHeight) {
			menuY = Math.max(0, menuY - menuH);
		}
		menu.style.left = menuX + "px";
		menu.style.top = menuY + "px";
		// Close menu on click outside or Escape
		closeMenu = function(e) {
			if(!menu.contains(e.target)) {
				removeMenu();
			}
		};
		var menuHovered = false;
		menu.addEventListener("mouseenter", function() { menuHovered = true; });
		menu.addEventListener("mouseleave", function() { menuHovered = false; });
		closeOnEscape = function(e) {
			if(e.key === "Escape" && menuHovered) {
				removeMenu();
			}
		};
		setTimeout(function() {
			document.addEventListener("click", closeMenu, true);
			document.addEventListener("keydown", closeOnEscape, true);
		}, 0);
	}, true);
};
