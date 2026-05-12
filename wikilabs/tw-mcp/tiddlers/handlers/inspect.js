/*\
title: $:/core/modules/commands/inspect/handlers/inspect.js
type: application/javascript
module-type: library

MCP tool handlers for inspection and analysis operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

// Post-process inspect_pos DOM: replace verbose data-pos attributes
// with compact p="idx:lines" format. Returns title index header + innerHTML.
// Browser devtools keeps the full format; this compaction is MCP-only.
var SVG_TAGS = {"svg":1,"path":1,"g":1,"circle":1,"rect":1,"line":1,"polygon":1,
	"polyline":1,"ellipse":1,"use":1,"defs":1,"marker":1,"clipPath":1,"text":1,"tspan":1};

function compactPositions(container) {
	var titleMap = [];
	var titleIndex = {};
	var walk = function(node, inSvg) {
		if(!node.children) return;
		for(var i = 0; i < node.children.length; i++) {
			var child = node.children[i];
			if(!child.tag) continue;
			var isSvg = inSvg || SVG_TAGS[child.tag];
			// Strip the raw character range — line numbers in p= are sufficient
			child.removeAttribute("data-range");
			var pos = child.getAttribute && child.getAttribute("data-pos");
			if(pos) {
				if(isSvg) {
					child.removeAttribute("data-pos");
				} else {
					var sepIdx = pos.indexOf(shared.SOURCE_POS_SEPARATOR);
					if(sepIdx !== -1) {
						var range = pos.slice(0, sepIdx);
						var title = pos.slice(sepIdx + shared.SOURCE_POS_SEPARATOR.length);
						var idx;
						if(titleIndex[title] !== undefined) {
							idx = titleIndex[title];
						} else {
							idx = titleMap.length;
							titleIndex[title] = idx;
							titleMap.push(title);
						}
						range = range.replace(/L/g, "");
						child.removeAttribute("data-pos");
						child.setAttribute("p", idx + ":" + range);
					} else {
						child.removeAttribute("data-pos");
					}
				}
			}
			var via = child.getAttribute && child.getAttribute("data-via");
			if(via) {
				child.removeAttribute("data-via");
				if(!isSvg) child.setAttribute("v", via);
			}
			var ctx = child.getAttribute && child.getAttribute("data-ctx");
			if(ctx) {
				child.removeAttribute("data-ctx");
				if(!isSvg) child.setAttribute("ctx", ctx);
			}
			var caller = child.getAttribute && child.getAttribute("data-caller");
			if(caller) {
				child.removeAttribute("data-caller");
				if(!isSvg) child.setAttribute("c", caller);
			}
			walk(child, isSvg);
		}
	};
	walk(container, false);
	var header = "";
	if(titleMap.length > 0) {
		var parts = [];
		for(var i = 0; i < titleMap.length; i++) {
			parts.push(i + "=" + titleMap[i]);
		}
		header = "[" + parts.join(" ") + "]\n";
	}
	return header + container.innerHTML;
}

// --- inspect_pos helpers (hoisted to module scope) -----------------------
//
// All inspect_pos machinery lives here so the handler stays orchestration.
// Pure helpers (charToLine, posGetSourceInfo, posBuildCallerChain) are
// stateless. createPosTracker() bundles the line/header/body-offset caches
// plus the hook + posBuildInfo function that share them. patchPosWidgets()
// wires up the widget-prototype monkey-patches and returns a restore()
// callback for the handler's finally block.

function charToLine(offsets, charPos) {
	var lo = 0, hi = offsets.length - 1;
	while(lo < hi) {
		var mid = (lo + hi + 1) >> 1;
		if(offsets[mid] <= charPos) lo = mid; else hi = mid - 1;
	}
	return lo + 1;
}

function posGetSourceInfo(widget) {
	var w = widget;
	while(w) {
		if(w.sourceContext !== undefined) {
			return {
				title: w.sourceContext,
				offset: w.sourceContextOffset || 0,
				via: w.sourceContextVariable
			};
		}
		w = w.parentWidget;
	}
	return null;
}

// Walk parent widgets and collect the chain of distinct sourceContexts
// above the immediate one. Closest enclosing caller first, outermost last.
function posBuildCallerChain(widget) {
	var chain = [], lastCtx = null, w = widget;
	while(w) {
		if(w.sourceContext !== undefined && w.sourceContext !== lastCtx) {
			if(lastCtx !== null) chain.push(w.sourceContext);
			lastCtx = w.sourceContext;
		}
		w = w.parentWidget;
	}
	return chain;
}

function createPosTracker() {
	var lineCache = {};
	var headerCache = {};
	var bodyOffsetCache = {};
	function getLineOffsets(title) {
		if(lineCache[title]) return lineCache[title];
		var text = $tw.wiki.getTiddlerText(title, "");
		var offsets = [0];
		for(var ci = 0; ci < text.length; ci++) {
			if(text.charAt(ci) === "\n") offsets.push(ci + 1);
		}
		lineCache[title] = offsets;
		return offsets;
	}
	function getTidHeaderLines(title) {
		if(headerCache[title] !== undefined) return headerCache[title];
		var tiddler = $tw.wiki.getTiddler(title);
		if(!tiddler) { headerCache[title] = 0; return 0; }
		var exclude = {"text": true, "bag": true, "revision": true};
		var fieldCount = 0;
		for(var f in tiddler.fields) {
			if(!exclude[f]) fieldCount++;
		}
		headerCache[title] = fieldCount + 1;
		return headerCache[title];
	}
	function findBodyOffset(title, bodyText) {
		var key = title + "\0" + bodyText.length;
		if(bodyOffsetCache[key] !== undefined) return bodyOffsetCache[key];
		var fullText = $tw.wiki.getTiddlerText(title, "");
		var idx = fullText.indexOf(bodyText);
		bodyOffsetCache[key] = idx >= 0 ? idx : 0;
		return bodyOffsetCache[key];
	}
	function posBuildInfo(widget) {
		var ptn = widget.parseTreeNode;
		if(!ptn || ptn.start === undefined) return null;
		var info = posGetSourceInfo(widget);
		if(!info) return null;
		var offsets = getLineOffsets(info.title);
		var absStart = ptn.start + info.offset;
		var absEnd = (ptn.end || ptn.start) + info.offset;
		var startLine = charToLine(offsets, absStart);
		var endLine = charToLine(offsets, absEnd);
		var headerOffset = getTidHeaderLines(info.title);
		return shared.formatSourcePos(startLine + headerOffset, endLine + headerOffset, info.title);
	}
	function posHook(domNode, widget) {
		if(!$tw.wiki.trackSourcePositions) return domNode;
		var info = posBuildInfo(widget);
		if(info) domNode.setAttribute("data-pos", info);
		var srcInfo = posGetSourceInfo(widget);
		if(srcInfo && srcInfo.via) {
			domNode.setAttribute("data-via", srcInfo.via);
		}
		// currentTiddler context — only when it differs from the
		// source-context tiddler (e.g. inside a list iterating over items,
		// where each repetition has the same source position).
		var ct = widget.getVariable("currentTiddler");
		if(ct && srcInfo && ct !== srcInfo.title) {
			domNode.setAttribute("data-ctx", ct);
		}
		var callers = posBuildCallerChain(widget);
		if(callers.length > 0) {
			domNode.setAttribute("data-caller", callers.join("|"));
		}
		return domNode;
	}
	return { posHook: posHook, findBodyOffset: findBodyOffset };
}

// Monkey-patch widget prototypes so source-context flows through transclusion
// boundaries and variable definitions remember their defining tiddler. Returns
// a restore() callback that the caller MUST invoke in finally (otherwise
// subsequent renders carry the patches forever).
// tracker is the createPosTracker() result; only its findBodyOffset is read.
function patchPosWidgets(tracker) {
	var Widget = require("$:/core/modules/widgets/widget.js").widget;
	var ImportVariablesWidget = require("$:/core/modules/widgets/importvariables.js").importvariables;
	var LinkWidget = require("$:/core/modules/widgets/link.js").link;
	var CodeBlockWidget = require("$:/core/modules/widgets/codeblock.js").codeblock;
	var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;
	// Tag each variable with its defining tiddler so transcluded macros can
	// be attributed back to their source.
	var origSetVariable = Widget.prototype.setVariable;
	Widget.prototype.setVariable = function(name, value, params, isMacroDefinition, options) {
		origSetVariable.call(this, name, value, params, isMacroDefinition, options);
		if(options && options.sourceTitle && this.variables[name]) {
			this.variables[name].sourceTitle = options.sourceTitle;
		}
	};
	var origImportExecute = ImportVariablesWidget.prototype.execute;
	ImportVariablesWidget.prototype.execute = function(tiddlerList) {
		origImportExecute.call(this, tiddlerList);
		var varSourceMap = Object.create(null);
		var self = this;
		$tw.utils.each(this.tiddlerList, function(title) {
			var parser = self.wiki.parseTiddler(title, {parseAsInline: true, configTrimWhiteSpace: false});
			if(parser) {
				var node = parser.tree[0];
				while(node && ["setvariable","set","parameters","void"].indexOf(node.type) !== -1) {
					if(node.attributes && node.attributes.name) {
						varSourceMap[node.attributes.name.value] = title;
					}
					node = node.children && node.children[0];
				}
			}
		});
		var ptr = this;
		while(ptr) {
			if(ptr.variables) {
				var ownKeys = Object.keys(ptr.variables);
				for(var ki = 0; ki < ownKeys.length; ki++) {
					var v = ptr.variables[ownKeys[ki]];
					if(v && !v.sourceTitle && varSourceMap[ownKeys[ki]]) {
						v.sourceTitle = varSourceMap[ownKeys[ki]];
					}
				}
			}
			ptr = (ptr.children && ptr.children.length === 1) ? ptr.children[0] : null;
		}
	};
	// TW core only emits th-dom-rendering-element natively; the link and
	// codeblock equivalents come from devtools' renderLink/render patches.
	// Patch them ourselves so inspect_pos works regardless of whether the
	// devtools plugin is loaded.
	var origRenderLink = LinkWidget.prototype.renderLink;
	LinkWidget.prototype.renderLink = function(parent, nextSibling) {
		origRenderLink.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-link", this.domNodes[this.domNodes.length - 1], this);
		}
	};
	var origCodeBlockRender = CodeBlockWidget.prototype.render;
	CodeBlockWidget.prototype.render = function(parent, nextSibling) {
		origCodeBlockRender.call(this, parent, nextSibling);
		if(this.domNodes.length > 0) {
			$tw.hooks.invokeHook("th-dom-rendering-codeblock", this.domNodes[this.domNodes.length - 1], this);
		}
	};
	var origExecute = TranscludeWidget.prototype.execute;
	TranscludeWidget.prototype.execute = function() {
		origExecute.call(this);
		if($tw.wiki.trackSourcePositions) {
			if(this.transcludeVariable) {
				var varInfo = this.getVariableInfo(this.transcludeVariable);
				var srcVar = varInfo && varInfo.srcVariable;
				this.sourceContext = (srcVar && srcVar.sourceTitle) || this.transcludeVariable;
				this.sourceContextOffset = 0;
				this.sourceContextVariable = this.transcludeVariable;
				if(srcVar && srcVar.sourceTitle && srcVar.value) {
					this.sourceContextOffset = tracker.findBodyOffset(srcVar.sourceTitle, srcVar.value);
				}
			} else if(this.transcludeTitle) {
				this.sourceContext = this.transcludeTitle;
				this.sourceContextOffset = 0;
			}
		}
	};
	return function restore() {
		Widget.prototype.setVariable = origSetVariable;
		ImportVariablesWidget.prototype.execute = origImportExecute;
		LinkWidget.prototype.renderLink = origRenderLink;
		CodeBlockWidget.prototype.render = origCodeBlockRender;
		TranscludeWidget.prototype.execute = origExecute;
	};
}

// --- inspect_scope helpers (hoisted to module scope) ---------------------
//
// inspect_scope is split into: render-context-vars setup, walk to find best
// widget, collect+classify vars (still inline), and format-output. Each
// helper is pure (no shared mutable state outside its return value).

// Build the extraVars object that parseAndRender passes through to widgetOptions
// when renderContext is "viewtemplate" or "root". "isolated" returns null.
function buildRenderContextVars(renderContext, contextTiddler) {
	if(renderContext !== "viewtemplate" && renderContext !== "root") return null;
	var extraVars = {};
	extraVars["storyTiddler"] = contextTiddler || "";
	extraVars["tiddlerInfoState"] = "$:/state/popup/tiddler-info--" + (contextTiddler || "");
	extraVars["folded-state"] = "$:/state/folded/" + (contextTiddler || "");
	if(renderContext === "root") {
		extraVars["tv-story-list"] = "$:/StoryList";
		extraVars["tv-history-list"] = "$:/HistoryList";
		extraVars["tv-config-toolbar-icons"] = $tw.wiki.getTiddlerText("$:/config/Toolbar/Icons", "yes");
		extraVars["tv-config-toolbar-text"] = $tw.wiki.getTiddlerText("$:/config/Toolbar/Text", "no");
		extraVars["tv-config-toolbar-class"] = $tw.wiki.getTiddlerText("$:/config/Toolbar/ButtonClass", "tc-btn-invisible");
		extraVars["tv-enable-drag-and-drop"] = $tw.wiki.getTiddlerText("$:/config/DragAndDrop/Enable", "yes");
		extraVars["tv-show-missing-links"] = $tw.wiki.getTiddlerText("$:/config/MissingLinks", "yes");
		extraVars["storyviewTitle"] = $tw.wiki.getTiddlerText("$:/view", "classic");
		extraVars["languageTitle"] = $tw.wiki.getTiddlerText("$:/language", "en-GB");
	}
	return extraVars;
}

// Find the widget whose parseTreeNode.start is closest to targetCharPos.
// matchCriteria optionally pins to a specific variable-value combination
// (used to disambiguate sibling widgets in repeated list iterations).
// Returns {widget, distance} or null if no widget has a start position.
function findBestWidget(widgetNode, targetCharPos, matchCriteria) {
	function widgetMatchesVars(wn) {
		if(!matchCriteria) return true;
		var keys = Object.keys(matchCriteria);
		for(var mi = 0; mi < keys.length; mi++) {
			var varName = keys[mi];
			var expected = matchCriteria[varName];
			var resolved = null;
			var pw = wn;
			while(pw) {
				if(pw.variables && pw.variables[varName]) {
					var v = pw.variables[varName];
					resolved = v.value !== undefined ? v.value : (v.text !== undefined ? v.text : null);
					break;
				}
				pw = pw.parentWidget;
			}
			if(resolved !== expected) return false;
		}
		return true;
	}
	var best = null, bestDistance = Infinity;
	function walk(wn) {
		if(wn.parseTreeNode && wn.parseTreeNode.start !== undefined) {
			var dist = Math.abs(wn.parseTreeNode.start - targetCharPos);
			if(dist < bestDistance && widgetMatchesVars(wn)) {
				bestDistance = dist;
				best = wn;
			}
			if(wn.parseTreeNode.start === targetCharPos && widgetMatchesVars(wn)) {
				best = wn;
				bestDistance = 0;
			}
		}
		if(wn.children) {
			for(var ci = 0; ci < wn.children.length; ci++) {
				walk(wn.children[ci]);
			}
		}
	}
	walk(widgetNode);
	return best ? { widget: best, distance: bestDistance } : null;
}

// Format the inspect_scope output: scope header + local-scope / used-globals /
// other-globals (or hidden-count) sections. opts: {showAll, hasFilter}.
function formatScopeOutput(localVars, usedImported, unusedImported, targetCharPos, widgetType, bestDistance, opts) {
	var lines = [];
	var total = localVars.length + usedImported.length + unusedImported.length;
	lines.push("Scope at char " + targetCharPos + " (widget: " + widgetType + ", distance: " + bestDistance + ", " + total + " vars)");
	function formatEntry(entry) {
		var prefix;
		if(entry.isWidget) {
			prefix = "widget ";
		} else if(entry.isFunction) {
			prefix = "fn ";
		} else if(entry.isProcedure) {
			prefix = "proc ";
		} else if(entry.isMacro) {
			prefix = "macro ";
		} else if(entry.params) {
			prefix = "def ";
		} else {
			prefix = "var ";
		}
		var paramStr = entry.params ? "(" + entry.params.map(function(p) { return p.name + (p["default"] ? ":" + p["default"] : ""); }).join(", ") + ")" : "";
		var src = entry.sourceTitle ? " @" + entry.sourceTitle : "";
		if(!entry.params && entry.value !== undefined) {
			var val = String(entry.value);
			if(val.length > 70) val = val.substring(0, 70) + "~";
			return prefix + entry.name + " = " + val.replace(/\n/g, "\\n") + src;
		} else {
			return prefix + entry.name + paramStr + src;
		}
	}
	if(localVars.length > 0) {
		lines.push("");
		lines.push("— local scope");
		for(var li = 0; li < localVars.length; li++) lines.push(formatEntry(localVars[li]));
	}
	if(usedImported.length > 0) {
		lines.push("");
		lines.push("— used globals");
		for(var gi = 0; gi < usedImported.length; gi++) lines.push(formatEntry(usedImported[gi]));
	}
	if(opts.showAll && unusedImported.length > 0) {
		lines.push("");
		lines.push("— other globals");
		for(var oi = 0; oi < unusedImported.length; oi++) lines.push(formatEntry(unusedImported[oi]));
	}
	if(!opts.showAll && unusedImported.length > 0) {
		lines.push("");
		lines.push("+" + unusedImported.length + " globals (use all:true to see all, or filter to narrow)");
	}
	return lines.join("\n");
}

module.exports = {
	"inspect_tree": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		try {
			var rendered = shared.parseAndRender(args.text, args.type, args.context);
			if(!rendered) {
				return shared.errorResult( "No parser for text" );
			}
			var widgetNode = rendered.widgetNode;
			var wExcludeSet = shared.toSet(args.exclude);
			var wIncludeSet = shared.toSet(args.include);
			var maxDepth = args.depth || 3;
			var maxChildren = 10;
			var typeCounts = {};
			var linkTargets = [];
			var countTypes = function(wn) {
				var type = wn.parseTreeNode.type;
				typeCounts[type] = (typeCounts[type] || 0) + 1;
				if(type === "link" && wn.attributes && wn.attributes.to) {
					var target = wn.getAttribute("to");
					if(target && linkTargets.indexOf(target) === -1) {
						linkTargets.push(target);
					}
				}
				if(wn.children) {
					$tw.utils.each(wn.children, countTypes);
				}
			};
			countTypes(widgetNode);
			var copyNode = function(wn, rn, depth) {
				var type = wn.parseTreeNode.type;
				rn.type = type;
				if(type === "element") {
					rn.tag = wn.parseTreeNode.tag;
				} else if(type === "text") {
					var txt = wn.parseTreeNode.text;
					if(wIncludeSet.text) {
						// Cap inlined text at 2000 chars to prevent runaway output;
						// beyond that, show length + first/last 100 chars sample
						rn.text = txt.length > 2000
							? "…" + txt.length + ":" + txt.slice(0, 100) + "…" + txt.slice(-100)
							: txt;
					} else {
						rn.text = txt.length <= 10 ? txt : "…" + txt.length;
					}
				}
				if(wn.attributes && Object.keys(wn.attributes).length > 0) {
					rn.attributes = {};
					$tw.utils.each(wn.attributes, function(attr, attrName) {
						if(wExcludeSet[attrName]) return;
						rn.attributes[attrName] = wn.getAttribute(attrName);
					});
				}
				if(wn.children && wn.children.length > 0) {
					if(depth >= maxDepth) {
						rn.children = "{" + wn.children.length + " nodes}";
					} else {
						rn.children = [];
						var limit = Math.min(wn.children.length, maxChildren);
						for(var ci = 0; ci < limit; ci++) {
							var node = {};
							rn.children.push(node);
							copyNode(wn.children[ci], node, depth + 1);
						}
						if(wn.children.length > maxChildren) {
							rn.children.push("+" + (wn.children.length - maxChildren) + " more");
						}
					}
				}
			};
			var result = {};
			copyNode(widgetNode, result, 0);
			var summary = [];
			var sortedTypes = Object.keys(typeCounts).sort(function(a, b) { return typeCounts[b] - typeCounts[a]; });
			for(var si = 0; si < sortedTypes.length; si++) {
				summary.push(typeCounts[sortedTypes[si]] + " " + sortedTypes[si]);
			}
			var totalNodes = 0;
			for(var ti = 0; ti < sortedTypes.length; ti++) {
				totalNodes += typeCounts[sortedTypes[ti]];
			}
			var header = "Total: " + totalNodes + " nodes (full tree). Types: " + summary.join(", ") + "\n";
			if(linkTargets.length > 0) {
				header += "Links (" + linkTargets.length + "): " + linkTargets.join(", ") + "\n";
			}
			header += "(showing depth=" + maxDepth + ")\n";
			return shared.textResult( header + JSON.stringify(result, null, $tw.config.preferences.jsonSpaces) );
		} catch(e) {
			return shared.errorResult( "inspect_tree error: " + e.message );
		}
	},

	"inspect_pos": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return shared.errorResult( "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH );
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		try {
			var built = shared.buildWrappedTree(args.text, inputType, args.context);
			if(!built) {
				return shared.errorResult( "No parser for type: " + inputType );
			}
			$tw.wiki.trackSourcePositions = true;
			var tracker = createPosTracker();
			$tw.hooks.addHook("th-dom-rendering-element", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-link", tracker.posHook);
			$tw.hooks.addHook("th-dom-rendering-codeblock", tracker.posHook);
			var restorePatches = patchPosWidgets(tracker);
			try {
				var posWidget = $tw.wiki.makeWidget(built.wrappedTree, built.widgetOptions);
				posWidget.sourceContext = args.context || "(inline)";
				var posContainer = $tw.fakeDocument.createElement("div");
				posWidget.render(posContainer, null);
				return shared.textResult( compactPositions(posContainer) );
			} finally {
				$tw.wiki.trackSourcePositions = false;
				$tw.hooks.removeHook("th-dom-rendering-element", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-link", tracker.posHook);
				$tw.hooks.removeHook("th-dom-rendering-codeblock", tracker.posHook);
				restorePatches();
			}
		} catch(e) {
			return shared.errorResult( "inspect_pos error: " + e.message );
		}
	},

	"inspect_tw": function(args) {
		var targetPath = (args.path || "").trim();
		var requestedDepth = args.depth || 1;
		var excludeSet = (args.exclude && args.exclude.length > 0) ? shared.toSet(args.exclude) : null;
		var target = $tw;
		var blockedSegments = {"__proto__": true, "constructor": true, "prototype": true};
		if(targetPath) {
			var segments = targetPath.split(".");
			for(var i = 0; i < segments.length; i++) {
				if(blockedSegments[segments[i]]) {
					return shared.errorResult( "Access to " + segments[i] + " is blocked for security" );
				}
				if(target === null || target === undefined) {
					return shared.errorResult( "$tw." + segments.slice(0, i).join(".") + " is " + String(target) );
				}
				if(typeof target !== "object" && typeof target !== "function") {
					return shared.errorResult( "$tw." + segments.slice(0, i).join(".") + " is " + typeof target );
				}
				target = target[segments[i]];
			}
		}
		var prefix = "$tw" + (targetPath ? "." + targetPath : "");
		if(target === null || target === undefined) {
			return shared.textResult( prefix + "=" + String(target) );
		}
		// Auto-resolve: path is an object (not function) + call provided + call[0] is a method name
		if(typeof target === "object" && target !== null && args.call && args.call.length > 0) {
			var methodName = args.call[0];
			if(typeof target[methodName] === "function") {
				var resolvedPath = targetPath + "." + methodName;
				var resolvedArgs = args.call.slice(1);
				return module.exports["inspect_tw"]({
					path: resolvedPath,
					call: resolvedArgs,
					depth: requestedDepth,
					exclude: args.exclude,
					fullSource: args.fullSource
				});
			} else {
				return shared.errorResult( prefix + " is not a function. '" + methodName + "' is " + typeof target[methodName] + " on this object. Did you mean path='" + targetPath + "." + methodName + "'?" );
			}
		}
		if(typeof target === "function") {
			if(args.call) {
				var safeCallFunctions = {
					"wiki.getTiddler": true,
					"wiki.getTiddlerText": true,
					"wiki.tiddlerExists": true,
					"wiki.isShadowTiddler": true,
					"wiki.getShadowSource": true,
					"wiki.filterTiddlers": true,
					"wiki.allTitles": true,
					"wiki.allShadowTitles": true,
					"wiki.getPluginInfo": true,
					"wiki.getPluginTypes": true,
					"wiki.getIndexer": true,
					"mcp.heartbeat": true,
					"httpServer.heartbeat": true
				};
				var isSafe = safeCallFunctions[targetPath] || targetPath.indexOf("utils.") === 0;
				if(!isSafe) {
					var safeList = Object.keys(safeCallFunctions).map(function(k) { return "$tw." + k; }).join(", ");
					return shared.errorResult( "call is only allowed on safe read-only functions: " + safeList + ", $tw.utils.*" );
				}
				var parent = $tw;
				if(targetPath) {
					var parentSegments = targetPath.split(".");
					parentSegments.pop();
					for(var pi = 0; pi < parentSegments.length; pi++) {
						parent = parent[parentSegments[pi]];
					}
				}
				try {
					target = target.apply(parent, args.call);
					prefix = prefix + "(" + args.call.map(function(a) { return JSON.stringify(a); }).join(",") + ")";
				} catch(callErr) {
					return shared.errorResult( prefix + " call error: " + callErr.message );
				}
			} else {
				var fnStr = Function.prototype.toString.call(target);
				var sigMatch = fnStr.match(/^(?:function\s*[^(]*)(\([^)]*\))/);
				var sig = sigMatch ? sigMatch[1] : "(" + (target.length || 0) + ")";
				var lines = [];
				lines.push("fn " + prefix + sig);
				lines = lines.concat(shared.formatFnSource(fnStr, "", !!args.fullSource));
				return shared.textResult( lines.join("\n") );
			}
		}
		if(typeof target !== "object") {
			return shared.textResult( prefix + "=" + String(target) );
		}
		var keys;
		try {
			keys = Object.keys(target);
		} catch(e) {
			return shared.errorResult( "Cannot enumerate " + prefix + ": " + e.message );
		}
		keys.sort();
		var availableDepth = shared.computeMaxDepth(target, 5);
		var MAX_RESULT_CHARS = 10000;
		var currentDepth = requestedDepth;
		var result, depthNote = "";
		while(currentDepth >= 0) {
			var lines = [];
			lines.push(prefix + " " + keys.length + "keys maxDepth=" + availableDepth);
			for(var k = 0; k < keys.length; k++) {
				if(excludeSet && excludeSet[keys[k]]) { continue; }
				try {
					lines = lines.concat(shared.inspectValue(target[keys[k]], keys[k], 0, currentDepth - 1, excludeSet));
				} catch(e) {
					lines.push(keys[k] + " !err");
				}
			}
			result = lines.join("\n");
			if(result.length <= MAX_RESULT_CHARS || currentDepth <= 0) {
				break;
			}
			currentDepth--;
		}
		if(currentDepth < requestedDepth) {
			depthNote = "\u26A0 depth reduced from " + requestedDepth + " to " + currentDepth + " (result exceeded " + MAX_RESULT_CHARS + " chars)\n";
		}
		return shared.textResult( depthNote + result );
	},

	"inspect_scope": function(args) {
		try {
			var textToRender;
			if(args.text) {
				textToRender = args.text;
			} else if(args.tiddler) {
				textToRender = $tw.wiki.getTiddlerText(args.tiddler, "");
				if(!textToRender) {
					return shared.errorResult( "Tiddler not found or empty: " + args.tiddler );
				}
			} else {
				return shared.errorResult( "Provide either 'tiddler' or 'text' parameter" );
			}
			var targetCharPos = args.charPos || 0;
			var contextTiddler = args.context || args.tiddler;
			var extraVars = buildRenderContextVars(args.renderContext || "isolated", contextTiddler);
			var rendered = shared.parseAndRender(textToRender, "text/vnd.tiddlywiki", contextTiddler, extraVars);
			if(!rendered) {
				return shared.errorResult( "No parser for text" );
			}
			var matchCriteria = args.match || null;
			var found = findBestWidget(rendered.widgetNode, targetCharPos, matchCriteria);
			if(!found) {
				var matchInfo = matchCriteria ? " with match " + JSON.stringify(matchCriteria) : "";
				return shared.errorResult( "No widget found near char position " + targetCharPos + matchInfo );
			}
			var bestWidget = found.widget;
			var bestDistance = found.distance;
			var seen = {};
			var varList = [];
			var w = bestWidget;
			while(w) {
				if(w.variables) {
					var keys = Object.keys(w.variables);
					for(var vi = 0; vi < keys.length; vi++) {
						var vname = keys[vi];
						if(!seen[vname]) {
							seen[vname] = true;
							var v = w.variables[vname];
							varList.push({
								name: vname,
								value: v.value !== undefined ? v.value : (v.text !== undefined ? v.text : undefined),
								params: v.params || undefined,
								sourceTitle: v.sourceTitle || undefined,
								isMacro: v.isMacroDefinition || false,
								isProcedure: !!v.isProcedure || (v.configTrimWhiteSpace === true),
								isFunction: !!v.isFunctionDefinition,
								isWidget: !!v.isWidgetDefinition
							});
						}
					}
				}
				w = w.parentWidget;
			}
			var localVars = [];
			var importedVars = [];
			var varByName = {};
			for(var pi = 0; pi < varList.length; pi++) {
				varByName[varList[pi].name] = varList[pi];
				if(varList[pi].sourceTitle) {
					importedVars.push(varList[pi]);
				} else {
					localVars.push(varList[pi]);
				}
			}
			var usedNames = {};
			var collectVarRefs = function(node) {
				if(!node) return;
				if(node.attributes && node.attributes["$variable"]) {
					usedNames[node.attributes["$variable"].value] = true;
				}
				if(node.attributes) {
					var attrKeys = Object.keys(node.attributes);
					for(var ai = 0; ai < attrKeys.length; ai++) {
						var attr = node.attributes[attrKeys[ai]];
						if(attr.type === "macro" && attr.value && attr.value.attributes && attr.value.attributes["$variable"]) {
							usedNames[attr.value.attributes["$variable"].value] = true;
						} else if(attr.type === "indirect") {
							if(attr.textReference) usedNames[attr.textReference] = true;
						}
					}
				}
				if(node.children) {
					for(var ci = 0; ci < node.children.length; ci++) {
						collectVarRefs(node.children[ci]);
					}
				}
			};
			var parseTree = rendered.parser.tree;
			for(var ti = 0; ti < parseTree.length; ti++) {
				collectVarRefs(parseTree[ti]);
			}
			var followRefs = function(name, visited) {
				if(visited[name]) return;
				visited[name] = true;
				var entry = varByName[name];
				if(!entry) return;
				var body = entry.value || "";
				var varRefPattern = /<([^<>]+)>/g;
				var match;
				while((match = varRefPattern.exec(body)) !== null) {
					var refName = match[1];
					if(varByName[refName]) {
						usedNames[refName] = true;
						followRefs(refName, visited);
					}
				}
				var macroRefPattern = /<<([^\s>]+)/g;
				while((match = macroRefPattern.exec(body)) !== null) {
					var mRefName = match[1];
					if(varByName[mRefName]) {
						usedNames[mRefName] = true;
						followRefs(mRefName, visited);
					}
				}
			};
			var visited = {};
			var usedKeys = Object.keys(usedNames);
			for(var ui = 0; ui < usedKeys.length; ui++) {
				followRefs(usedKeys[ui], visited);
			}
			var usedImported = [];
			var unusedImported = [];
			for(var ii = 0; ii < importedVars.length; ii++) {
				if(usedNames[importedVars[ii].name]) {
					usedImported.push(importedVars[ii]);
				} else {
					unusedImported.push(importedVars[ii]);
				}
			}
			var filter = args.filter ? args.filter.toLowerCase() : null;
			if(filter) {
				localVars = localVars.filter(function(v) { return v.name.toLowerCase().indexOf(filter) !== -1; });
				usedImported = usedImported.filter(function(v) { return v.name.toLowerCase().indexOf(filter) !== -1; });
				unusedImported = unusedImported.filter(function(v) { return v.name.toLowerCase().indexOf(filter) !== -1; });
			}
			var widgetType = bestWidget.parseTreeNode ? bestWidget.parseTreeNode.type : "unknown";
			return shared.textResult( formatScopeOutput(localVars, usedImported, unusedImported, targetCharPos, widgetType, bestDistance, { showAll: !!args.all }) );
		} catch(e) {
			return shared.errorResult( "inspect_scope error: " + e.message );
		}
	}
};
