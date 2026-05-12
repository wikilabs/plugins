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
// Tiddler titles are stored in $tw.wiki's title index, broadcast in SSE event
// payloads, and serialised as filesystem paths. Without a cap, a malicious MCP
// client could OOM the process with multi-megabyte titles. 1024 is generous --
// real titles are rarely over ~100 chars.
var MAX_TITLE_LENGTH = 1024;

// Validate a tiddler title supplied by the MCP client. Only fires on string
// inputs that exceed the cap -- non-string / undefined / empty are left for
// the handler's own missing-arg logic to surface.
function checkTitle(title, toolName) {
	if(typeof title === "string" && title.length > MAX_TITLE_LENGTH) {
		return errorResult("Tool '" + toolName + "': title too long (" + title.length + " chars, max " + MAX_TITLE_LENGTH + ")");
	}
	return null;
}

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

// Build a title tree and prepend a "<prefix> ... N <label>" summary line
// when the result has a common prefix. label defaults to "tiddlers"; count
// defaults to titles.length. Wraps buildTree() for the common case where
// callers want a single string they can interpolate directly.
function formatTitleTree(titles, label, count) {
	var ns = buildTree(titles);
	var n = (count !== undefined) ? count : titles.length;
	var header = ns.prefix ? ns.prefix + " ... " + n + " " + (label || "tiddlers") + "\n" : "";
	return header + ns.tree;
}

// Shared parse+render helper
// Parse text and build the import-variables-wrapped tree + widget options.
// Returns { parser, wrappedTree, widgetOptions } or null if parsing fails.
// Used directly by inspect_pos (which needs to mutate the widget between
// makeWidget and render); for the common case prefer parseAndRender.
function buildWrappedTree(text, inputType, context, extraVariables) {
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
	return { parser: parser, wrappedTree: wrappedTree, widgetOptions: widgetOptions };
}

function parseAndRender(text, inputType, context, extraVariables) {
	var built = buildWrappedTree(text, inputType, context, extraVariables);
	if(!built) return null;
	var widgetNode = $tw.wiki.makeWidget(built.wrappedTree, built.widgetOptions);
	var container = $tw.fakeDocument.createElement("div");
	widgetNode.render(container, null);
	return {
		parser: built.parser,
		wrappedTree: built.wrappedTree,
		widgetOptions: built.widgetOptions,
		widgetNode: widgetNode,
		container: container
	};
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

// Resolve a filter-scope from MCP args and run it. Both replace_in_tiddlers
// and search_lines need the same default ('[all[tiddlers]!is[system]]' or
// '[all[tiddlers]]' when include_system) and the same try/catch wrap.
// Returns {titles, errorResult}. Caller pattern:
//   var scoped = shared.scopedTitles(args);
//   if(scoped.errorResult) return scoped.errorResult;
//   var titles = scoped.titles;
function scopedTitles(args) {
	var scope = args.filter || (args.include_system ? "[all[tiddlers]]" : "[all[tiddlers]!is[system]]");
	try {
		return { titles: $tw.wiki.filterTiddlers(scope) };
	} catch(e) {
		return { errorResult: errorResult("Filter error: " + e.message) };
	}
}

// Strip characters that would break filter-operand embedding when an arg
// is interpolated into a TW filter expression like `[tag[...]]`. The strip
// list covers the TW-core forbidden title chars (`|`, `[`, `]`, `{`, `}`)
// plus `<` / `>` for paranoia. Used by list_tiddlers (plugin, tag args)
// and render_tiddler (title arg).
function sanitiseFilterOperand(value) {
	if(typeof value !== "string") return value;
	return value.replace(/[|\[\]{}<>]/g, "");
}

// Serialise a rendered container element according to the requested output
// type. Mirrors the type enum used by render_tiddler, render_field, and
// render_text. text/html uses the fakedom's safe innerHTML serialiser.
function containerToText(container, outputType) {
	if(outputType === "text/html") return container.innerHTML;
	if(outputType === "text/plain-formatted") return container.formattedTextContent;
	return container.textContent;
}

// Build a `$tw.Tiddler` from existing fields, optionally re-stamping
// modified/modifier. When preserveTimestamps is true the source fields'
// created/modified are kept; otherwise they're refreshed to "now". `extra`
// is an optional object merged after the modification fields (used by
// rename_tiddler to set the new title).
function buildTiddlerWithTimestamps(fields, extra, preserveTimestamps) {
	if(preserveTimestamps) {
		return extra ? new $tw.Tiddler(fields, extra) : new $tw.Tiddler(fields);
	}
	var modFields = $tw.wiki.getModificationFields();
	return extra ? new $tw.Tiddler(fields, modFields, extra) : new $tw.Tiddler(fields, modFields);
}

// Stringify a value with the project-standard indent (`jsonSpaces` preference).
// Centralised so a future switch to compact JSON (token thrift) is one edit.
function jsonStringify(value) {
	return JSON.stringify(value, null, $tw.config.preferences.jsonSpaces);
}

// Convert an array of strings into a {key: true} lookup map. Returns an
// empty object when arr is falsy. Used by inspect_tree, inspect_tw, and
// render_text for exclude/include args.
function toSet(arr) {
	var set = {};
	if(arr) {
		for(var i = 0; i < arr.length; i++) {
			set[arr[i]] = true;
		}
	}
	return set;
}

// Is the tiddler a plugin/theme/language/etc bundle? Returns true if any
// `plugin-type` field value is present.
function isPluginTiddler(tiddler) {
	return !!(tiddler && tiddler.fields["plugin-type"]);
}

// Return the `plugin-type` field value (eg "plugin", "theme", "language",
// "import") or null when the tiddler isn't a plugin bundle.
function getPluginKind(tiddler) {
	return (tiddler && tiddler.fields["plugin-type"]) || null;
}

// Guard against operating on bundled plugin / theme / language tiddlers.
// These are constructed from their shadow source tiddlers and shouldn't be
// rewritten directly. Returns an errorResult to short-circuit the caller,
// or null when the tiddler is safe to operate on.
function checkNotBundled(tiddler, action, title) {
	var kind = getPluginKind(tiddler);
	if(kind === "plugin" || kind === "theme" || kind === "language") {
		return errorResult("Refusing to " + action + " bundled " + kind + ": " + title);
	}
	return null;
}

// Read $:/config/FileSystemPaths and $:/config/FileSystemExtensions, return
// as filter arrays. options.filterBlank drops blank/whitespace-only lines
// from pathFilters (extFilters is never blank-filtered in current callers).
// Returns {pathFilters, extFilters}, either may be undefined if the config
// tiddler is missing/empty.
function loadFspFseFilters(options) {
	options = options || {};
	var fspText = $tw.wiki.getTiddlerText("$:/config/FileSystemPaths", "");
	var fseText = $tw.wiki.getTiddlerText("$:/config/FileSystemExtensions", "");
	var pathFilters = fspText ? fspText.split("\n") : undefined;
	var extFilters = fseText ? fseText.split("\n") : undefined;
	if(options.filterBlank && pathFilters) {
		pathFilters = pathFilters.filter(function(l) { return l.trim(); });
	}
	return { pathFilters: pathFilters, extFilters: extFilters };
}

// Compile a search pattern (literal by default; regex when options.regexp).
// Common across search_lines (query.js), the search-lines filter operator,
// and replace_in_tiddlers (crud.js).
// Options:
//   pattern (required)
//   regexp: treat as JS regex (default false)
//   words: wrap matcher with \b boundaries (default false)
//   caseSensitive: default false (case-insensitive 'i' flag)
//   global: include 'g' flag (replace_in_tiddlers wants this for multi-match-per-line)
// Returns {matcher} on success, {error: <message>} on bad pattern.
function compileSearchRegex(options) {
	var pattern = options.pattern;
	try {
		var src = options.regexp ? pattern : pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		if(options.words) {
			src = "\\b(?:" + src + ")\\b";
		}
		var flags = "";
		if(options.global) flags += "g";
		if(!options.caseSensitive) flags += "i";
		return { matcher: new RegExp(src, flags) };
	} catch(e) {
		return { error: e.message };
	}
}

// --- File persistence helper (used by put_tiddler and edit_tiddler) ---

function verifyOnDisk(fileInfo, title) {
	try {
		if(fileInfo.hasMetaFile) {
			// Binary tiddler: title header is in the .meta sidecar; the body
			// file holds binary content (eg SVG XML, PNG bytes) and only needs
			// to exist non-empty.
			var metaContent = fs.readFileSync(fileInfo.filepath + ".meta", "utf8");
			if(metaContent.length === 0 || metaContent.indexOf("title: " + title) === -1) {
				return false;
			}
			return fs.existsSync(fileInfo.filepath) && fs.statSync(fileInfo.filepath).size > 0;
		}
		// Self-contained .tid: title header is in the body file.
		var content = fs.readFileSync(fileInfo.filepath, "utf8");
		return content.length > 0 && content.indexOf("title: " + title) !== -1;
	} catch(e) {
		return false;
	}
}

function persistTiddler(tiddler, title, action) {
	var checkPathAllowed = getCheckPathAllowed();
	if(!$tw.boot.wikiTiddlersPath) {
		// No wiki tiddlers path — still add to in-memory store.
		$tw.wiki.addTiddler(tiddler);
		return textResult("Tiddler " + action + " in store only (no wiki tiddlers path): " + title);
	}
	// Capture pre-call state for rollback. Snapshot boot.files entry by
	// shallow copy because the in-place mutation later would otherwise
	// destroy the original.
	var oldTiddler = $tw.wiki.getTiddler(title);
	var oldFileInfoSrc = $tw.boot.files[title];
	var oldFileInfo = oldFileInfoSrc ? $tw.utils.extend({}, oldFileInfoSrc) : null;
	function rollbackWikiState() {
		if(oldTiddler) {
			$tw.wiki.addTiddler(oldTiddler);
		} else {
			$tw.wiki.deleteTiddler(title);
		}
		if(oldFileInfo) {
			$tw.boot.files[title] = oldFileInfo;
		} else {
			delete $tw.boot.files[title];
		}
	}
	try {
		var filters = loadFspFseFilters();
		var pathFilters = filters.pathFilters;
		var extFilters = filters.extFilters;
		// Add to wiki FIRST so FSP filters can evaluate against this
		// tiddler's tags / fields. Computing fileInfo with the tiddler
		// not yet in the wiki makes [tag[X]] rules return empty for
		// this title; the tiddler then lands at the default path and
		// the syncer's nextTick (after addTiddler) recomputes with the
		// tag visible and writes a SECOND copy at the tag-determined
		// path. Net result: duplicate files for the same tiddler when
		// FSP uses tag-based rules.
		$tw.wiki.addTiddler(tiddler);
		// Compute filepath. overwrite:true so the uniquifier doesn't pick
		// a _1/_2 suffix for an existing target file.
		var baseFileInfo = oldFileInfo ? $tw.utils.extend({}, oldFileInfo) : {};
		baseFileInfo.overwrite = true;
		var fileInfo = $tw.utils.generateTiddlerFileInfo(tiddler, {
			directory: $tw.boot.wikiTiddlersPath,
			pathFilters: pathFilters,
			extFilters: extFilters,
			wiki: $tw.wiki,
			fileInfo: baseFileInfo
		});
		var pathDenied = checkPathAllowed(fileInfo.filepath);
		if(pathDenied) {
			rollbackWikiState();
			return pathDenied;
		}
		// Pre-seed $tw.boot.files so the syncadaptor, when its nextTick
		// fires after addTiddler, sees our resolved fileInfo and writes
		// to the same path (idempotent overwrite).
		$tw.boot.files[title] = fileInfo;
		// Synchronous write — deterministic result, independent of the syncer.
		$tw.utils.saveTiddlerToFileSync(tiddler, fileInfo);
		// Verify: read back the file and confirm the title header is present.
		// Catches both 0-byte writes and content that gets truncated by a racing
		// async syncadaptor save before we report success. For binary tiddlers
		// (hasMetaFile=true) the title header lives in the `.meta` sidecar; the
		// body file holds binary content and only needs to exist non-empty.
		var verified = verifyOnDisk(fileInfo, title);
		if(!verified) {
			// One retry: write again. The syncer only fires once per addTiddler,
			// so a second sync write is not racing with another async save.
			try { $tw.utils.saveTiddlerToFileSync(tiddler, fileInfo); } catch(e) {}
			verified = verifyOnDisk(fileInfo, title);
		}
		if(!verified) {
			// Roll back: remove the new file(s) and restore wiki state.
			try { fs.unlinkSync(fileInfo.filepath); } catch(e) {}
			if(fileInfo.hasMetaFile) {
				try { fs.unlinkSync(fileInfo.filepath + ".meta"); } catch(e) {}
			}
			rollbackWikiState();
			return errorResult("Tiddler " + action + " failed: verification failed for " + fileInfo.filepath + ". Store and filesystem rolled back.");
		}
		return textResult("Tiddler " + action + ": " + title + " -> " + fileInfo.filepath);
	} catch(e) {
		rollbackWikiState();
		return errorResult("Tiddler " + action + " in store but failed to save to disk: " + e.message);
	}
}

// Add a tiddler without triggering a syncer save. `Syncer.storeTiddler`
// syncs `tiddlerInfo[title].changeCount` with the post-add wiki value
// so the comparator skips it. Use when we persist the .tid ourselves
// (upload_file, extract_html_wiki) or for derived / disk-sourced
// tiddlers (OTP refresh, reload_tiddlers). Takes plain fields.
function addToWikiSilently(tiddlerFields) {
	if($tw.syncer) {
		$tw.syncer.storeTiddler(tiddlerFields);
	} else {
		$tw.wiki.addTiddler(tiddlerFields);
	}
}

exports.init = init;
exports.checkWritable = checkWritable;
exports.isReadonly = isReadonly;
exports.getCheckPathAllowed = getCheckPathAllowed;
exports.buildTree = buildTree;
exports.formatTitleTree = formatTitleTree;
exports.parseAndRender = parseAndRender;
exports.buildWrappedTree = buildWrappedTree;
exports.formatSourcePos = formatSourcePos;
exports.formatFnSource = formatFnSource;
exports.inspectValue = inspectValue;
exports.computeMaxDepth = computeMaxDepth;
exports.MAX_FILTER_LENGTH = MAX_FILTER_LENGTH;
exports.MAX_TEXT_LENGTH = MAX_TEXT_LENGTH;
exports.MAX_TITLE_LENGTH = MAX_TITLE_LENGTH;
exports.checkTitle = checkTitle;
exports.textResult = textResult;
exports.errorResult = errorResult;
exports.scopedTitles = scopedTitles;
exports.compileSearchRegex = compileSearchRegex;
exports.loadFspFseFilters = loadFspFseFilters;
exports.checkNotBundled = checkNotBundled;
exports.isPluginTiddler = isPluginTiddler;
exports.getPluginKind = getPluginKind;
exports.toSet = toSet;
exports.containerToText = containerToText;
exports.sanitiseFilterOperand = sanitiseFilterOperand;
exports.jsonStringify = jsonStringify;
exports.buildTiddlerWithTimestamps = buildTiddlerWithTimestamps;
exports.persistTiddler = persistTiddler;
exports.addToWikiSilently = addToWikiSilently;
exports.SOURCE_POS_SEPARATOR = SOURCE_POS_SEPARATOR;
