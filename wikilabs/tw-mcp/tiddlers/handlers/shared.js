/*\
title: $:/core/modules/commands/inspect/handlers/shared.js
type: application/javascript
module-type: library

Shared utilities and state for MCP tool handlers.

\*/

"use strict";

var fs = require("fs"),
	path = require("path");

// Source position format — must match $:/plugins/tiddlywiki/sourcepos/utils.js
var SOURCE_POS_SEPARATOR = " @ ";
function formatSourcePos(startLine, endLine, title) {
	var pos = (startLine === endLine) ? "L" + startLine : "L" + startLine + "-L" + endLine;
	if(title) pos += SOURCE_POS_SEPARATOR + title;
	return pos;
}

// Module-level state, set via init()
var readonlyMode = false;
var checkPathAllowed = null;

function init(context) {
	readonlyMode = context.readonlyMode;
	checkPathAllowed = context.checkPathAllowed;
}

function checkWritable(toolName) {
	if(readonlyMode) {
		return errorResult("Tool '" + toolName + "' is disabled in readonly mode");
	}
	return null;
}

function isReadonly() {
	return readonlyMode;
}

function getCheckPathAllowed() {
	return checkPathAllowed;
}

var MAX_FILTER_LENGTH = 10000;
var MAX_TEXT_LENGTH = 500000;

// Build namespace tree from sorted titles.
function buildTree(titles, maxDepth, _indent) {
	if(!titles.length) return { prefix: "", tree: "" };
	if(maxDepth === undefined) maxDepth = 1;
	_indent = _indent || "";
	var commonParts = titles[0].split("/");
	for(var i = 1; i < titles.length; i++) {
		var parts = titles[i].split("/");
		var match = 0;
		for(var j = 0; j < Math.min(commonParts.length, parts.length); j++) {
			if(parts[j] === commonParts[j]) { match++; } else { break; }
		}
		commonParts = commonParts.slice(0, match);
		if(!commonParts.length) break;
	}
	var commonPrefix = commonParts.length >= 2 ? commonParts.join("/") + "/" : "";
	var prefixDepth = commonPrefix ? commonParts.length : 0;
	var groupDepth = prefixDepth > 0 ? prefixDepth + 1 : 2;
	var groups = {};
	var groupOrder = [];
	for(var i = 0; i < titles.length; i++) {
		var parts = titles[i].split("/");
		var key;
		if(parts.length <= groupDepth) {
			key = commonPrefix ? titles[i].slice(commonPrefix.length) || titles[i] : titles[i];
		} else {
			key = parts.slice(prefixDepth, groupDepth).join("/") + "/";
		}
		if(!groups[key]) {
			groups[key] = [];
			groupOrder.push(key);
		}
		groups[key].push(titles[i]);
	}
	groupOrder.sort();
	var lines = [];
	for(var k = 0; k < groupOrder.length; k++) {
		var key = groupOrder[k];
		var items = groups[key];
		if(key.slice(-1) === "/" && maxDepth > 1 && items.length > 1) {
			var sub = buildTree(items, maxDepth - 1, _indent + "\t");
			var relPrefix = sub.prefix.slice(commonPrefix.length);
			lines.push(_indent + "\t" + relPrefix + " (" + items.length + ")");
			if(sub.tree) lines.push(sub.tree);
		} else if(key.slice(-1) === "/") {
			lines.push(_indent + "\t" + key + " (" + items.length + ")");
		} else {
			lines.push(_indent + "\t" + key);
		}
	}
	return { prefix: commonPrefix, tree: lines.join("\n") };
}

// Shared parse+render helper
function parseAndRender(text, inputType, context, extraVariables) {
	var parser = $tw.wiki.parseText(inputType || "text/vnd.tiddlywiki", text, { parseAsInline: false });
	if(!parser) return null;
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
	var vars = {};
	if(context) {
		vars.currentTiddler = context;
	}
	if(extraVariables) {
		var extraKeys = Object.keys(extraVariables);
		for(var ei = 0; ei < extraKeys.length; ei++) {
			vars[extraKeys[ei]] = extraVariables[extraKeys[ei]];
		}
	}
	if(Object.keys(vars).length > 0) {
		widgetOptions.variables = vars;
	}
	var widgetNode = $tw.wiki.makeWidget(wrappedTree, widgetOptions);
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return { parser: parser, wrappedTree: wrappedTree, widgetOptions: widgetOptions, widgetNode: widgetNode, container: container };
}

// Inspect helpers

function formatFnSource(fnStr, pad, full) {
	var srcLines = fnStr.split("\n");
	var out = [];
	if(full) {
		for(var f = 0; f < srcLines.length; f++) {
			out.push(pad + "  " + srcLines[f].replace(/\t/g, "  "));
		}
	} else {
		var head = srcLines.slice(0, 5);
		for(var h = 0; h < head.length; h++) {
			out.push(pad + "  " + head[h].replace(/\t/g, "  "));
		}
		var rest = srcLines.length - 5;
		if(rest > 0) {
			out.push(pad + "  ..." + rest + " more lines");
		}
	}
	return out;
}

function inspectValue(val, key, indent, depthLeft, excludeSet) {
	var lines = [];
	var pad = "";
	for(var p = 0; p < indent; p++) { pad += "  "; }
	var type = typeof val;
	if(val === null || val === undefined) {
		lines.push(pad + key + " " + String(val));
	} else if(type === "string") {
		var display = val.length > 70 ? val.substring(0, 70) + "~" : val;
		lines.push(pad + key + " s:" + val.length + " " + display.replace(/\n/g, "\\n"));
	} else if(type === "number" || type === "boolean") {
		lines.push(pad + key + "=" + String(val));
	} else if(val instanceof Date || Object.prototype.toString.call(val) === "[object Date]" || ($tw.utils.isDate && $tw.utils.isDate(val))) {
		lines.push(pad + key + " date:" + val.toISOString());
	} else if(type === "function") {
		var fnStr = Function.prototype.toString.call(val);
		var sigMatch = fnStr.match(/^(?:function\s*[^(]*)(\([^)]*\))/);
		var sig = sigMatch ? sigMatch[1] : "(" + (val.length || 0) + ")";
		lines.push(pad + "fn " + key + sig);
		if(depthLeft > 0) {
			lines = lines.concat(formatFnSource(fnStr, pad));
		}
	} else if(Array.isArray(val)) {
		lines.push(pad + key + " [" + val.length + "]");
		if(depthLeft > 0 && val.length > 0) {
			var arrLimit = Math.min(val.length, 20);
			for(var a = 0; a < arrLimit; a++) {
				try {
					lines = lines.concat(inspectValue(val[a], "[" + a + "]", indent + 1, 0, excludeSet));
				} catch(e) {
					lines.push(pad + "  [" + a + "] !err");
				}
			}
			if(val.length > arrLimit) {
				lines.push(pad + "  ..." + (val.length - arrLimit) + " more");
			}
		}
	} else {
		var childKeys;
		try {
			childKeys = Object.keys(val);
		} catch(e2) {
			lines.push(pad + key + " {?}");
			return lines;
		}
		lines.push(pad + key + " {" + childKeys.length + "}");
		if(depthLeft > 0) {
			childKeys.sort();
			for(var c = 0; c < childKeys.length; c++) {
				if(excludeSet && excludeSet[childKeys[c]]) { continue; }
				try {
					lines = lines.concat(inspectValue(val[childKeys[c]], childKeys[c], indent + 1, depthLeft - 1, excludeSet));
				} catch(e3) {
					lines.push(pad + "  " + childKeys[c] + " !err");
				}
			}
		}
	}
	return lines;
}

function computeMaxDepth(obj, limit) {
	if(limit <= 0 || obj === null || obj === undefined) {
		return 0;
	}
	var type = typeof obj;
	if(type !== "object" && type !== "function") {
		return 0;
	}
	var keys;
	try {
		keys = Object.keys(obj);
	} catch(e) {
		return 0;
	}
	if(keys.length === 0) {
		return 0;
	}
	var deepest = 0;
	for(var i = 0; i < keys.length && i < 50; i++) {
		try {
			var child = obj[keys[i]];
			if(child !== null && child !== undefined && (typeof child === "object" || typeof child === "function")) {
				var d = 1 + computeMaxDepth(child, limit - 1);
				if(d > deepest) {
					deepest = d;
				}
			}
		} catch(e) {
			// skip
		}
	}
	return deepest;
}

// --- Response helpers ---

function textResult(msg) {
	return { content: [{ type: "text", text: msg }] };
}

function errorResult(msg) {
	return { isError: true, content: [{ type: "text", text: msg }] };
}

// --- File persistence helper (used by put_tiddler and edit_tiddler) ---

function persistTiddler(tiddler, title, action) {
	var checkPathAllowed = getCheckPathAllowed();
	$tw.wiki.addTiddler(tiddler);
	if($tw.boot.wikiTiddlersPath) {
		try {
			var pathFilters, extFilters;
			if($tw.wiki.tiddlerExists("$:/config/FileSystemPaths")) {
				pathFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "").split("\n");
			}
			if($tw.wiki.tiddlerExists("$:/config/FileSystemExtensions")) {
				extFilters = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "").split("\n");
			}
			var fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
				directory: $tw.boot.wikiTiddlersPath,
				pathFilters: pathFilters,
				extFilters: extFilters,
				wiki: $tw.wiki,
				fileInfo: $tw.boot.files[title] || {}
			});
			var pathDenied = checkPathAllowed(fileInfo.filepath);
			if(pathDenied) {
				$tw.wiki.deleteTiddler(title);
				return pathDenied;
			}
			$tw.utils.saveTiddlerToFileSync(tiddler, fileInfo);
			$tw.boot.files[title] = fileInfo;
			return textResult("Tiddler " + action + ": " + title + " -> " + fileInfo.filepath);
		} catch(e) {
			return errorResult("Tiddler " + action + " in store but failed to save to disk: " + e.message);
		}
	}
	return textResult("Tiddler " + action + " in store only (no wiki tiddlers path): " + title);
}

exports.init = init;
exports.checkWritable = checkWritable;
exports.isReadonly = isReadonly;
exports.getCheckPathAllowed = getCheckPathAllowed;
exports.buildTree = buildTree;
exports.parseAndRender = parseAndRender;
exports.formatSourcePos = formatSourcePos;
exports.formatFnSource = formatFnSource;
exports.inspectValue = inspectValue;
exports.computeMaxDepth = computeMaxDepth;
exports.MAX_FILTER_LENGTH = MAX_FILTER_LENGTH;
exports.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;
exports.textResult = textResult;
exports.errorResult = errorResult;
exports.persistTiddler = persistTiddler;
