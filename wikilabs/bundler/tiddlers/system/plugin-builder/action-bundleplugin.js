/*\
title: $:/plugins/wikilabs/bundler/action-bundleplugin.js
type: application/javascript
module-type: widget

Action widget to bundle an existing or a new plugin.

\*/

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

/**
 * Action widget that bundles tiddlers into a new or existing plugin.
 * @param {object} parseTreeNode - widget parse tree node
 * @param {object} options - widget options
 * @returns {void}
 */
var BundlePluginWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

// Inherit from the base widget class
BundlePluginWidget.prototype = new Widget();

/**
 * Render this widget into the DOM.
 * @param {Element} parent - parent DOM node
 * @param {Element} nextSibling - next sibling DOM node
 * @returns {void}
 */
BundlePluginWidget.prototype.render = function(parent,nextSibling) {
	this.computeAttributes();
	this.execute();
};

/**
 * Compute the internal state of the widget.
 * @returns {void}
 */
BundlePluginWidget.prototype.execute = function() {
	this.actionPlugin = this.getAttribute("$plugin");
	this.actionInclude = this.getAttribute("$include");
	this.actionExclude = this.getAttribute("$exclude");
	this.actionRemove = this.getAttribute("$remove");
	this.actionRemoveFields = this.getAttribute("$removeFields","");
	this.actionMode = this.getAttribute("$mode","log");
	this.actionIncrementPatch = this.getAttribute("$incrementPatch","yes");
};

/**
 * Refresh the widget by ensuring our attributes are up to date.
 * @param {object} changedTiddlers - changed tiddler titles
 * @returns {boolean} True if the widget was refreshed
 */
BundlePluginWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(changedAttributes["$pluginname"] || changedAttributes["$filter"] || changedAttributes["$excludeFilter"] || changedAttributes["$mode"]) {
		this.refreshSelf();
		return true;
	}
	return this.refreshChildren(changedTiddlers);
};

/**
 * Invoke the action associated with this widget.
 * @param {object} triggeringWidget - widget that triggered the action
 * @param {object} [event] - triggering event
 * @returns {boolean} True, the action was invoked
 */
BundlePluginWidget.prototype.invokeAction = function(triggeringWidget,event) {
	event = event || {};
	var tiddlers = $tw.wiki.filterTiddlers(this.actionInclude),
		excluded = $tw.wiki.filterTiddlers(this.actionExclude) || [[]],
		remove = $tw.wiki.filterTiddlers(this.actionRemove) || [[]],
		self = this;

	// Add tiddlers and remove added tiddlers from the store
	// Warning!: This funcionality is able to "destroy" your plugin
	function write() {
		if (tiddlers && self.actionPlugin) {
			$tw.utils.bundlePlugin(self.actionPlugin, tiddlers, excluded, remove, {
				incrementPatch: (self.actionIncrementPatch === "yes"),
				removeFields: $tw.utils.parseStringArray(self.actionRemoveFields) || []
			});
			log("dangerous");
		}
	};
	// Allow the user to veryfy, that everything will be OK
	function log(mode) {
		mode = mode || "log";
		var txtModified = (mode === "log") ? "should be modified." : (mode === "dangerous") ? "has been modified." : "unknown 'mode'";
		var logFile = (mode === "dangerous") ? "$:/temp/bundle.plugin.log" : "$:/temp/bundle-plugin-verify";
		var text = $tw.wiki.getTiddler(logFile)?.fields?.text || "";

		text += "--------\n" + $tw.macros.now.run("YYYY-0MM-0DD 0hh:0mm:0ss-0XXX") + "\n\n";

		text += "Plugin: [[" + self.actionPlugin + "]] " + txtModified + "\n\n";

		if (tiddlers.length === 0) {
			text += "* No 'include' tiddlers selected\n"
		} else {
			$tw.utils.each(tiddlers, function(title) {
				if (!jsonPluginTiddler.tiddlers[title]) {
					text += "# add: [[" + title + "]]\n";
				}
			})
		}
		if (excluded.length > 0) {
			text += "\n"
			$tw.utils.each(excluded, function(title) {
				text += "# excluded: [[" + title + "]]\n";
			});
		}

		if (remove.length > 0) {
			text += "\n"
			$tw.utils.each(remove, function(title) {
				if (jsonPluginTiddler.tiddlers[title]) {
					text += "# remove: [[" + title + "]]\n";
				}
			});
		}

		text += "That's it\n\n";
		$tw.wiki.addTiddler(new $tw.Tiddler(self.wiki.getCreationFields(),{title:logFile, text: text/*, type: "application/x-tiddler-dictionary"*/},self.wiki.getModificationFields()));
		self.dispatchEvent({
			type: "tm-navigate",
			navigateTo: logFile
		});
	}
	// Get the plugin tiddler
	var pluginTiddler = $tw.wiki.getTiddler(self.actionPlugin);
	if(!pluginTiddler) {
		console.log("No such tiddler as " + self.actionPlugin);
	}
	// Extract the JSON
	var jsonPluginTiddler = $tw.utils.parseJSONSafe(pluginTiddler.fields.text,null);
	if(!jsonPluginTiddler) {
		console.log("Cannot parse plugin tiddler " + self.actionPlugin);
	}

	if (this.actionMode === "log") {
		log();
	} else if (this.actionMode === "dangerous") {
		write();
	}
	return true; // Action was invoked
};

exports["action-bundleplugin"] = BundlePluginWidget;
