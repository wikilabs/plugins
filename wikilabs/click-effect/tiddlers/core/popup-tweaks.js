/*\
title: $:/core/modules/utils/dom/popup-tweaks.js
type: application/javascript
module-type: utils

Module that creates a $tw.utils.Popup object prototype that manages popups in the browser

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Configuration tiddler, if click animation shuld be shown!
var CONFIG_CLICK_ANIMATION = "$:/config/clickEffect";
var Popup = require("$:/core/modules/utils/dom/popup.js").Popup;

// CHANGE -  CHANGE -  CHANGE -  CHANGE -  CHANGE
Popup.prototype.handleEvent = function(event) {
	if(event.type === "click") {
		// Find out what was clicked on
		var info = this.popupInfo(event.target),
			cancelLevel = info.popupLevel - 1;
		// Don't remove the level that was clicked on if we clicked on a handle
		if(info.isHandle) {
			cancelLevel++;
		}
		// Cancel
		this.cancel(cancelLevel);
		// Show Click Animation
		this.clickAnimation(event);
	}
};

Popup.prototype.pulseElement = function(domNode) {
	$tw.utils.pulseElementFixed(domNode)
};

/*
Animation Options: ... if configured
clickEffect: CSS class name as string with no special formatting eg: clickEffect
domNode: DOM node, that should contain the animated element. eg: rootElement
event: event Object
*/
Popup.prototype.clickAnimation = function(event) {
	var options = {};
	options.event = event;
	var clickEffect = $tw.wiki.getTiddlerText(CONFIG_CLICK_ANIMATION,"no").trim();
	if (clickEffect === "clickEffect") {
		options = {
			clickEffect: "clickEffect",
			domNode: this.rootElement,
			event: event
		}
		$tw.utils.clickAnimation(options);
	} else if (clickEffect === "pulse") {
		this.pulseElement(event.target);
	}
};

})();
