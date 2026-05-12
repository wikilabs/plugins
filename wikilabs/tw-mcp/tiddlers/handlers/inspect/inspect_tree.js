/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_tree.js
type: application/javascript
module-type: library

MCP tool handler: inspect_tree — compact parse-tree summary with type
counts, link targets, and depth-bounded JSON dump of the widget tree.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

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
			return shared.textResult( header + shared.jsonStringify(result) );
		} catch(e) {
			return shared.errorResult( "inspect_tree error: " + e.message );
		}
	}
};
