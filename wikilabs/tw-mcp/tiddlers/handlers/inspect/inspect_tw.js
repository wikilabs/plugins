/*\
title: $:/core/modules/commands/inspect/handlers/inspect/inspect_tw.js
type: application/javascript
module-type: library

MCP tool handler: inspect_tw — walk $tw object graph at a path,
optionally invoke safe read-only methods, and render values/functions
with depth-bounded output capped by character budget.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
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
			depthNote = "⚠ depth reduced from " + requestedDepth + " to " + currentDepth + " (result exceeded " + MAX_RESULT_CHARS + " chars)\n";
		}
		return shared.textResult( depthNote + result );
	}
};
