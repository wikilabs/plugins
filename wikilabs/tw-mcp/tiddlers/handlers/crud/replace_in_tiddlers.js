/*\
title: $:/core/modules/commands/inspect/handlers/crud/replace_in_tiddlers.js
type: application/javascript
module-type: library

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
		if(dryRun) {
			return shared.textResult(crudShared.formatReplaceDryRun(modified, totalReplacements, truncated));
		}
		return shared.textResult(crudShared.applyReplacements(modified, totalReplacements, truncated));
	}
};
