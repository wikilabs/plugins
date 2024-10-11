/*\
title: $:/plugins/wikilabs/bundler/bundleplugin.js
type: application/javascript
module-type: utils

A quick and dirty way to pack up plugins within the browser.

\*/
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Build a plugin, and then delete any non-shadow payload tiddlers.
options:
	incrementMinor ... auto increment version minor
	incrementPatch ... auto increment version patch
*/
exports.bundlePlugin = function(title,additionalTiddlers,excludeTiddlers,removeTiddlers,options) {
	options = options || {incrementMinor: false, incrementPatch: true};
	additionalTiddlers = additionalTiddlers || [];
	excludeTiddlers = excludeTiddlers || [];
	removeTiddlers = removeTiddlers || [];
	// Get the plugin tiddler
	var pluginTiddler = $tw.wiki.getTiddler(title);
	if(!pluginTiddler) {
		throw "No such tiddler as " + title;
	}
	// Extract the JSON
	var jsonPluginTiddler = $tw.utils.parseJSONSafe(pluginTiddler.fields.text,null);
	if(!jsonPluginTiddler) {
		throw "Cannot parse plugin tiddler " + title + "\n" + $tw.language.getString("Error/Caption") + ": " + e;
	}
	// Get the list of tiddlers
	// if (!tiddlers) {
	// 	return "Plugin " + title + " not found";
	// }
	var tiddlers = Object.keys(jsonPluginTiddler.tiddlers);
	// Add the additional tiddlers
	$tw.utils.pushTop(tiddlers,additionalTiddlers);
	// Remove any excluded tiddlers
	for(var t=tiddlers.length-1; t>=0; t--) {
		if((excludeTiddlers.indexOf(tiddlers[t]) !== -1) || (removeTiddlers.indexOf(tiddlers[t]) !== -1) ) {
			tiddlers.splice(t,1);
		}
	}
	// Pack up the tiddlers into a block of JSON
	var plugins = {};
	$tw.utils.each(tiddlers,function(title) {
		var tiddler = $tw.wiki.getTiddler(title),
			fields = {};
		if (tiddler) {
			$tw.utils.each(tiddler.fields,function (value,name) {
				fields[name] = tiddler.getFieldString(name);
			});
			plugins[title] = fields;
		}
	});
	// Retrieve and bump the version number
	var pluginVersion = $tw.utils.parseVersion(pluginTiddler.getFieldString("version") || "0.0.0") || {
			major: "0",
			minor: "0",
			patch: "0"
		};
	if (options.incrementMinor) {
			pluginVersion.minor++;
		}
	if (options.incrementPatch) {
			pluginVersion.patch++;
		}
	var version = pluginVersion.major + "." + pluginVersion.minor + "." + pluginVersion.patch;
	if(pluginVersion.prerelease) {
		version += "-" + pluginVersion.prerelease;
	}
	if(pluginVersion.build) {
		version += "+" + pluginVersion.build;
	}
	// Save the plugin tiddler
	$tw.wiki.addTiddler(new $tw.Tiddler(pluginTiddler,{text: JSON.stringify({tiddlers: plugins},null,4), version: version}));
	// Delete any non-shadow constituent tiddlers
	$tw.utils.each(tiddlers,function(title) {
		if($tw.wiki.tiddlerExists(title)) {
			$tw.wiki.deleteTiddler(title);
		}
	});
	// Trigger an autosave
	$tw.rootWidget.dispatchEvent({type: "tm-auto-save-wiki"});
	// Return a heartwarming confirmation
	return "Plugin " + title + " successfully saved";
};
