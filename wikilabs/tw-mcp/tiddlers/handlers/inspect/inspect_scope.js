/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_scope.js
type: application/javascript
module-type: library

MCP tool handler: inspect_scope — show all variables visible at a
given char position inside text or a tiddler, classified as local /
used globals / other globals.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

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
