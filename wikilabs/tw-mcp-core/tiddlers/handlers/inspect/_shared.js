/*\
title: $:/core/modules/commands/inspect/handlers/inspect/_shared.js
type: application/javascript
module-type: library

Per-group helpers shared by the inspect/* handler files. Currently:

* patchSourceTitleTracking() — monkey-patches Widget.prototype.setVariable
  and ImportVariablesWidget.prototype.execute so that variables loaded via
  importvariables carry a `sourceTitle` property pointing at the tiddler
  that defined them. Used by inspect_pos (to attribute rendered DOM to
  its source) and inspect_scope (to classify variables as local vs
  imported). Returns a restore() callback that MUST be invoked in a
  finally block — otherwise the patches persist on the global widget
  prototypes and affect every subsequent render.

\*/

"use strict";

function patchSourceTitleTracking() {
	var Widget = require("$:/core/modules/widgets/widget.js").widget;
	var ImportVariablesWidget = require("$:/core/modules/widgets/importvariables.js").importvariables;
	// Tag each variable defined via setVariable() with its defining tiddler
	// when the caller passes options.sourceTitle.
	var origSetVariable = Widget.prototype.setVariable;
	Widget.prototype.setVariable = function(name, value, params, isMacroDefinition, options) {
		origSetVariable.call(this, name, value, params, isMacroDefinition, options);
		if(options && options.sourceTitle && this.variables[name]) {
			this.variables[name].sourceTitle = options.sourceTitle;
		}
	};
	// importvariables doesn't pass options.sourceTitle through setVariable, so
	// parse each imported tiddler ourselves, build a name → title map, and
	// assign sourceTitle on the variable instances after origExecute populated
	// them.
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
	return function restore() {
		Widget.prototype.setVariable = origSetVariable;
		ImportVariablesWidget.prototype.execute = origImportExecute;
	};
}

exports.patchSourceTitleTracking = patchSourceTitleTracking;
