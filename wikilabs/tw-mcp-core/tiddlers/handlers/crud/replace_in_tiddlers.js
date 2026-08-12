/*\
title: $:/core/modules/commands/inspect/handlers/crud/replace_in_tiddlers.js
type: application/javascript
module-type: mcp-handler

MCP tool handler: replace_in_tiddlers — bulk find+replace across many
tiddlers. Multiple {pattern, replacement} rules per call, per-rule flags;
dry_run=true by default — output groups by title with diff lines.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");
var crudShared = require("$:/core/modules/commands/inspect/handlers/crud/_shared.js");

module.exports = {
	"replace_in_tiddlers": function(args) {
		var denied = shared.checkWritable("replace_in_tiddlers");
		if(denied) return denied;
		if(!args.rules || !Array.isArray(args.rules) || args.rules.length === 0) {
			return shared.errorResult("replace_in_tiddlers: 'rules' must be a non-empty array of {pattern, replacement} objects");
		}
		var fields = (args.fields && args.fields.length > 0) ? args.fields : ["text", "caption", "list", "tags"];
		var dryRun = args.dry_run !== false;
		var maxTiddlers = args.max_tiddlers || 100;
		var maxReplacementsTotal = args.max_replacements_total || 1000;
		var compiledRules = [];
		for(var i = 0; i < args.rules.length; i++) {
			var rule = args.rules[i];
			if(typeof rule.pattern !== "string" || rule.pattern.length === 0) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " missing or empty 'pattern'");
			}
			if(typeof rule.replacement !== "string") {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " 'replacement' must be a string");
			}
			if(rule.pattern.length > shared.MAX_FILTER_LENGTH) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " pattern too long (max " + shared.MAX_FILTER_LENGTH + ")");
			}
			var compiled = shared.compileSearchRegex({
				pattern: rule.pattern,
				regexp: !!rule.regexp,
				words: !!rule.words,
				caseSensitive: !!rule.case_sensitive,
				global: true
			});
			if(compiled.error) {
				return shared.errorResult("replace_in_tiddlers: rule " + i + " invalid regex: " + compiled.error);
			}
			compiledRules.push({matcher: compiled.matcher, replacement: rule.replacement});
		}
		var scoped = shared.scopedTitles(args);
		if(scoped.errorResult) return scoped.errorResult;
		var sourceTitles = scoped.titles;
		// Scan: per tiddler, per listed field, per line. Replacements within
		// a line are sequential across rules (rule2 sees rule1's output) so
		// chained renames work like sed -e ... -e ....
		var modified = [];
		var totalReplacements = 0;
		var truncated = false;
		for(var ti = 0; ti < sourceTitles.length && !truncated; ti++) {
			var title = sourceTitles[ti];
			var tiddler = $tw.wiki.getTiddler(title);
			if(!tiddler) continue;
			var perFieldChanges = [];
			var newFieldValues = {};
			var tiddlerReplacements = 0;
			for(var fi = 0; fi < fields.length; fi++) {
				var field = fields[fi];
				var rawValue = tiddler.fields[field];
				var isArrayField = Array.isArray(rawValue);
				var value;
				if(isArrayField) {
					value = $tw.utils.stringifyList(rawValue);
				} else if(typeof rawValue === "string") {
					value = rawValue;
				} else {
					continue;
				}
				var lines = value.split(/\r?\n/);
				var lineDiffs = [];
				var newLines = [];
				var fieldChanged = false;
				for(var li = 0; li < lines.length; li++) {
					var before = lines[li];
					var after = before;
					var lineReplacements = 0;
					for(var ri = 0; ri < compiledRules.length; ri++) {
						var cr = compiledRules[ri];
						var matches = after.match(cr.matcher);
						if(matches) {
							lineReplacements += matches.length;
							after = after.replace(cr.matcher, cr.replacement);
						}
					}
					if(after !== before) {
						lineDiffs.push({lineNum: li + 1, before: before, after: after, count: lineReplacements});
						tiddlerReplacements += lineReplacements;
						fieldChanged = true;
					}
					newLines.push(after);
				}
				if(fieldChanged) {
					var newValue = newLines.join("\n");
					newFieldValues[field] = isArrayField ? $tw.utils.parseStringArray(newValue) : newValue;
					perFieldChanges.push({field: field, isArrayField: isArrayField, lineDiffs: lineDiffs});
				}
			}
			if(perFieldChanges.length === 0) continue;
			if(totalReplacements + tiddlerReplacements > maxReplacementsTotal) {
				truncated = true;
				break;
			}
			modified.push({
				title: title,
				newFieldValues: newFieldValues,
				perFieldChanges: perFieldChanges,
				tiddlerReplacements: tiddlerReplacements
			});
			totalReplacements += tiddlerReplacements;
			if(modified.length >= maxTiddlers) {
				truncated = true;
				break;
			}
		}
		if(modified.length === 0) {
			return shared.textResult("(no matches)");
		}
		// Machine-readable impact alongside the human diff. A filter string does
		// not reveal how many tiddlers it resolves to, so a caller that has to
		// decide whether this is a big change should not have to parse prose.
		var impact = {
			affectedTitles: modified.map(function(m) { return m.title; }),
			totalReplacements: totalReplacements,
			truncated: truncated
		};
		var result = dryRun
			? shared.textResult(crudShared.formatReplaceDryRun(modified, totalReplacements, truncated))
			: shared.textResult(crudShared.applyReplacements(modified, totalReplacements, truncated));
		result.structuredContent = impact;
		return result;
	}
};

// MCP tool definition — advertised via mcp-handlers getToolDefinitions();
// write:true marks tools hidden in readonly mode.
module.exports["replace_in_tiddlers"].definition = {
	"description": "Bulk per-line find+replace across tiddlers. Dry-run output (dry_run=true default): title header, '  - <n>#<hash>: before' then '  + <n>#<hash>: after' per change (text field anchor; other fields 'field:L<n>'). Footer 'DRY RUN: N replacements across M tiddlers' + 'Call again with dry_run=false to apply'. Apply output: '<N> tiddlers modified, <M> replacements' + failure list. Empty: '(no matches)'. Defaults: fields=['text','caption','list','tags'] (tags/list serialised via stringifyList, parsed back on write), case-insensitive literal. Rules applied sequentially per line. Regex compiled with g flag (all matches per line); replacement supports JS backrefs $1..$9, $&, $$. Caps: max_tiddlers=100, max_replacements_total=1000.",
	"inputSchema": {
		"type": "object",
		"properties": {
			"rules": {
				"type": "array",
				"description": "Array of {pattern, replacement, regexp?, case_sensitive?, words?} objects",
				"items": {
					"type": "object",
					"properties": {
						"pattern": {
							"type": "string",
							"description": "Find pattern (literal by default; regex when regexp=true)"
						},
						"replacement": {
							"type": "string",
							"description": "Replacement string. When regexp=true supports $1..$9, $&, $$."
						},
						"regexp": {
							"type": "boolean",
							"default": false
						},
						"case_sensitive": {
							"type": "boolean",
							"default": false
						},
						"words": {
							"type": "boolean",
							"default": false,
							"description": "Wrap pattern with \\b boundaries"
						}
					},
					"required": [
						"pattern",
						"replacement"
					]
				}
			},
			"filter": {
				"type": "string",
				"description": "TW filter scope; default '[all[tiddlers]!is[system]]' or '[all[tiddlers]]' when include_system"
			},
			"include_system": {
				"type": "boolean",
				"default": false
			},
			"fields": {
				"type": "array",
				"items": {
					"type": "string"
				},
				"description": "Fields to scan; default ['text','caption','list','tags']"
			},
			"dry_run": {
				"type": "boolean",
				"default": true,
				"description": "Preview only; nothing written. Set false to apply."
			},
			"max_tiddlers": {
				"type": "number",
				"default": 100
			},
			"max_replacements_total": {
				"type": "number",
				"default": 1000
			}
		},
		"required": [
			"rules"
		]
	},
	"write": true
};
