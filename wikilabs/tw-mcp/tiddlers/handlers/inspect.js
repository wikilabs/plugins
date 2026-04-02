/*\
title: $:/core/modules/commands/inspect/handlers/inspect.js
type: application/javascript
module-type: library

MCP tool handlers for inspection and analysis operations.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"inspect_tree": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return { isError: true, content: [{ type: "text", text: "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH }] };
		}
		try {
			var rendered = shared.parseAndRender(args.text, args.type, args.context);
			if(!rendered) {
				return { isError: true, content: [{ type: "text", text: "No parser for text" }] };
			}
			var widgetNode = rendered.widgetNode;
			var wExcludeSet = {};
			if(args.exclude) {
				for(var we = 0; we < args.exclude.length; we++) {
					wExcludeSet[args.exclude[we]] = true;
				}
			}
			var wIncludeSet = {};
			if(args.include) {
				for(var wi = 0; wi < args.include.length; wi++) {
					wIncludeSet[args.include[wi]] = true;
				}
			}
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
					rn.text = wIncludeSet.text ? txt : "s:" + txt.length;
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
			if(linkTargets.length > 0) {
				return { content: [{ type: "text", text: header }] };
			}
			header += "(showing depth=" + maxDepth + ")\n";
			return { content: [{ type: "text", text: header + JSON.stringify(result, null, $tw.config.preferences.jsonSpaces) }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "inspect_tree error: " + e.message }] };
		}
	},

	"inspect_pos": function(args) {
		if(args.text && args.text.length > shared.MAX_TEXT_LENGTH) {
			return { isError: true, content: [{ type: "text", text: "Text too long (" + args.text.length + " chars). Maximum: " + shared.MAX_TEXT_LENGTH }] };
		}
		var inputType = args.type || "text/vnd.tiddlywiki";
		try {
			var parser = $tw.wiki.parseText(inputType, args.text, { parseAsInline: false });
			if(!parser) {
				return { isError: true, content: [{ type: "text", text: "No parser for type: " + inputType }] };
			}
			var importFilter = $tw.wiki.getTiddlerText("$:/core/config/GlobalImportFilter");
			var wrappedTree = {tree: [{
				type: "importvariables",
				attributes: {
					filter: { name: "filter", type: "string", value: importFilter }
				},
				isBlock: false,
				children: parser.tree
			}]};
			var widgetOptions = { document: $tw.fakeDocument };
			if(args.context) {
				widgetOptions.variables = { currentTiddler: args.context };
			}
			$tw.wiki.trackSourcePositions = true;
			var lineCache = {};
			var getLineOffsets = function(title) {
				if(lineCache[title]) return lineCache[title];
				var text = $tw.wiki.getTiddlerText(title, "");
				var offsets = [0];
				for(var ci = 0; ci < text.length; ci++) {
					if(text.charAt(ci) === "\n") offsets.push(ci + 1);
				}
				lineCache[title] = offsets;
				return offsets;
			};
			var charToLine = function(offsets, charPos) {
				var lo = 0, hi = offsets.length - 1;
				while(lo < hi) {
					var mid = (lo + hi + 1) >> 1;
					if(offsets[mid] <= charPos) lo = mid; else hi = mid - 1;
				}
				return lo + 1;
			};
			var posGetSourceInfo = function(widget) {
				var w = widget;
				while(w) {
					if(w.sourceContext !== undefined) {
						return { title: w.sourceContext, offset: w.sourceContextOffset || 0 };
					}
					w = w.parentWidget;
				}
				return null;
			};
			var headerCache = {};
			var getTidHeaderLines = function(title) {
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
			};
			var posBuildInfo = function(widget) {
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
			};
			var posHook = function(domNode, widget) {
				if($tw.wiki.trackSourcePositions) {
					var info = posBuildInfo(widget);
					if(info) domNode.setAttribute("data-source-pos", info);
				}
				return domNode;
			};
			$tw.hooks.addHook("th-dom-rendering-element", posHook);
			$tw.hooks.addHook("th-dom-rendering-link", posHook);
			$tw.hooks.addHook("th-dom-rendering-codeblock", posHook);
			var TranscludeWidget = require("$:/core/modules/widgets/transclude.js").transclude;
			var origExecute = TranscludeWidget.prototype.execute;
			var bodyOffsetCache = {};
			var findBodyOffset = function(title, bodyText) {
				var key = title + "\0" + bodyText.length;
				if(bodyOffsetCache[key] !== undefined) return bodyOffsetCache[key];
				var fullText = $tw.wiki.getTiddlerText(title, "");
				var idx = fullText.indexOf(bodyText);
				bodyOffsetCache[key] = idx >= 0 ? idx : 0;
				return bodyOffsetCache[key];
			};
			TranscludeWidget.prototype.execute = function() {
				origExecute.call(this);
				if($tw.wiki.trackSourcePositions) {
					if(this.transcludeVariable) {
						var varInfo = this.getVariableInfo(this.transcludeVariable);
						var srcVar = varInfo && varInfo.srcVariable;
						this.sourceContext = (srcVar && srcVar.sourceTitle) || this.transcludeVariable;
						this.sourceContextOffset = 0;
						if(srcVar && srcVar.sourceTitle && srcVar.value) {
							this.sourceContextOffset = findBodyOffset(srcVar.sourceTitle, srcVar.value);
						}
					} else if(this.transcludeTitle) {
						this.sourceContext = this.transcludeTitle;
						this.sourceContextOffset = 0;
					}
				}
			};
			try {
				var posWidget = $tw.wiki.makeWidget(wrappedTree, widgetOptions);
				posWidget.sourceContext = args.context || "(inline)";
				var posContainer = $tw.fakeDocument.createElement("div");
				posWidget.render(posContainer, null);
				return { content: [{ type: "text", text: posContainer.innerHTML }] };
			} finally {
				$tw.wiki.trackSourcePositions = false;
				$tw.hooks.removeHook("th-dom-rendering-element", posHook);
				$tw.hooks.removeHook("th-dom-rendering-link", posHook);
				$tw.hooks.removeHook("th-dom-rendering-codeblock", posHook);
				TranscludeWidget.prototype.execute = origExecute;
			}
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "inspect_pos error: " + e.message }] };
		}
	},

	"inspect_tw": function(args) {
		var targetPath = (args.path || "").trim();
		var requestedDepth = args.depth || 1;
		var excludeSet = null;
		if(args.exclude && args.exclude.length > 0) {
			excludeSet = {};
			for(var e = 0; e < args.exclude.length; e++) {
				excludeSet[args.exclude[e]] = true;
			}
		}
		var target = $tw;
		var blockedSegments = {"__proto__": true, "constructor": true, "prototype": true};
		if(targetPath) {
			var segments = targetPath.split(".");
			for(var i = 0; i < segments.length; i++) {
				if(blockedSegments[segments[i]]) {
					return { isError: true, content: [{ type: "text", text: "Access to " + segments[i] + " is blocked for security" }] };
				}
				if(target === null || target === undefined) {
					return { isError: true, content: [{ type: "text", text: "$tw." + segments.slice(0, i).join(".") + " is " + String(target) }] };
				}
				if(typeof target !== "object" && typeof target !== "function") {
					return { isError: true, content: [{ type: "text", text: "$tw." + segments.slice(0, i).join(".") + " is " + typeof target }] };
				}
				target = target[segments[i]];
			}
		}
		var prefix = "$tw" + (targetPath ? "." + targetPath : "");
		if(target === null || target === undefined) {
			return { content: [{ type: "text", text: prefix + "=" + String(target) }] };
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
				if(!safeCallFunctions[targetPath]) {
					var safeList = Object.keys(safeCallFunctions).map(function(k) { return "$tw." + k; }).join(", ");
					return { isError: true, content: [{ type: "text", text: "call is only allowed on safe read-only functions: " + safeList }] };
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
					return { isError: true, content: [{ type: "text", text: prefix + " call error: " + callErr.message }] };
				}
			} else {
				var fnStr = Function.prototype.toString.call(target);
				var sigMatch = fnStr.match(/^(?:function\s*[^(]*)(\([^)]*\))/);
				var sig = sigMatch ? sigMatch[1] : "(" + (target.length || 0) + ")";
				var lines = [];
				lines.push("fn " + prefix + sig);
				lines = lines.concat(shared.formatFnSource(fnStr, "", !!args.fullSource));
				return { content: [{ type: "text", text: lines.join("\n") }] };
			}
		}
		if(typeof target !== "object") {
			return { content: [{ type: "text", text: prefix + "=" + String(target) }] };
		}
		var keys;
		try {
			keys = Object.keys(target);
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "Cannot enumerate " + prefix + ": " + e.message }] };
		}
		keys.sort();
		var availableDepth = shared.computeMaxDepth(target, 5);
		var lines = [];
		lines.push(prefix + " " + keys.length + "keys maxDepth=" + availableDepth);
		for(var k = 0; k < keys.length; k++) {
			if(excludeSet && excludeSet[keys[k]]) { continue; }
			try {
				lines = lines.concat(shared.inspectValue(target[keys[k]], keys[k], 0, requestedDepth - 1, excludeSet));
			} catch(e) {
				lines.push(keys[k] + " !err");
			}
		}
		return { content: [{ type: "text", text: lines.join("\n") }] };
	},

	"inspect_scope": function(args) {
		try {
			var textToRender;
			if(args.text) {
				textToRender = args.text;
			} else if(args.tiddler) {
				textToRender = $tw.wiki.getTiddlerText(args.tiddler, "");
				if(!textToRender) {
					return { isError: true, content: [{ type: "text", text: "Tiddler not found or empty: " + args.tiddler }] };
				}
			} else {
				return { isError: true, content: [{ type: "text", text: "Provide either 'tiddler' or 'text' parameter" }] };
			}
			var targetCharPos = args.charPos || 0;
			var contextTiddler = args.context || args.tiddler;
			var extraVars = null;
			var renderContext = args.renderContext || "isolated";
			if(renderContext === "viewtemplate" || renderContext === "root") {
				extraVars = {};
				extraVars["storyTiddler"] = contextTiddler || "";
				extraVars["tiddlerInfoState"] = "$:/state/popup/tiddler-info--" + (contextTiddler || "");
				extraVars["folded-state"] = "$:/state/folded/" + (contextTiddler || "");
			}
			if(renderContext === "root") {
				extraVars = extraVars || {};
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
			var rendered = shared.parseAndRender(textToRender, "text/vnd.tiddlywiki", contextTiddler, extraVars);
			if(!rendered) {
				return { isError: true, content: [{ type: "text", text: "No parser for text" }] };
			}
			var widgetNode = rendered.widgetNode;
			var matchCriteria = args.match || null;
			var widgetMatchesVars = function(wn) {
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
			};
			var bestWidget = null;
			var bestDistance = Infinity;
			var walkTree = function(wn) {
				if(wn.parseTreeNode && wn.parseTreeNode.start !== undefined) {
					var dist = Math.abs(wn.parseTreeNode.start - targetCharPos);
					if(dist < bestDistance && widgetMatchesVars(wn)) {
						bestDistance = dist;
						bestWidget = wn;
					}
					if(wn.parseTreeNode.start === targetCharPos && widgetMatchesVars(wn)) {
						bestWidget = wn;
						bestDistance = 0;
					}
				}
				if(wn.children) {
					for(var ci = 0; ci < wn.children.length; ci++) {
						walkTree(wn.children[ci]);
					}
				}
			};
			walkTree(widgetNode);
			if(!bestWidget) {
				var matchInfo = matchCriteria ? " with match " + JSON.stringify(matchCriteria) : "";
				return { isError: true, content: [{ type: "text", text: "No widget found near char position " + targetCharPos + matchInfo }] };
			}
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
			var showAll = !!args.all;
			var total = localVars.length + usedImported.length + unusedImported.length;
			var lines = [];
			var widgetType = bestWidget.parseTreeNode ? bestWidget.parseTreeNode.type : "unknown";
			lines.push("Scope at char " + targetCharPos + " (widget: " + widgetType + ", distance: " + bestDistance + ", " + total + " vars)");
			var formatEntry = function(entry) {
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
			};
			if(localVars.length > 0) {
				lines.push("");
				lines.push("— local scope");
				for(var li = 0; li < localVars.length; li++) {
					lines.push(formatEntry(localVars[li]));
				}
			}
			if(usedImported.length > 0) {
				lines.push("");
				lines.push("— used globals");
				for(var gi = 0; gi < usedImported.length; gi++) {
					lines.push(formatEntry(usedImported[gi]));
				}
			}
			if(showAll && unusedImported.length > 0) {
				lines.push("");
				lines.push("— other globals");
				for(var oi = 0; oi < unusedImported.length; oi++) {
					lines.push(formatEntry(unusedImported[oi]));
				}
			}
			if(!showAll && unusedImported.length > 0) {
				lines.push("");
				lines.push("+" + unusedImported.length + " globals (use all:true to see all, or filter to narrow)");
			}
			return { content: [{ type: "text", text: lines.join("\n") }] };
		} catch(e) {
			return { isError: true, content: [{ type: "text", text: "inspect_scope error: " + e.message }] };
		}
	}
};
