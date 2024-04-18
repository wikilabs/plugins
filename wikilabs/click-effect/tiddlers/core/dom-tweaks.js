/*\
title: $:/core/modules/utils/dom-tweaks.js
type: application/javascript
module-type: utils

Fix .pulseElement()
Add .clickAnimation()

Various static DOM-related utility functions.
\*/

(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
TODO - FIX - should be fixed upstream
Pulse an element for debugging purposes
*/
exports.pulseElementFixed = function(element) {
	var eventName = $tw.utils.convertEventName("animationEnd");
	// Event handler to remove the class at the end
	element.addEventListener(eventName,function handler(event) {
		element.removeEventListener(eventName,handler,false);
		$tw.utils.removeClass(element,"pulse");
	},false);
	// Apply the pulse class
	$tw.utils.removeClass(element,"pulse");
	$tw.utils.forceLayout(element);
	$tw.utils.addClass(element,"pulse");
};

/*
Cursor Click animation. Is useful to create videos
This animation creates its own div element
Options:
clickEffect: CSS class name as string with no special formatting eg: clickEffect
domNode: DOM node, that should contain the animated element. eg: rootElement
event: event Object
*/
exports.clickAnimation = function(options) {
	var options = options || {},
		eventName = $tw.utils.convertEventName("animationEnd"),
		element = document.createElement("div");

	element.className = options.clickEffect || "";
	element.style.top = options.event.clientY+"px";
	element.style.left = options.event.clientX+"px";
	options.domNode.appendChild(element);
		// Event handler to remove the element if animation is finished
	element.addEventListener(eventName,function() {
		element.parentElement.removeChild(element);
		}.bind(this),false);
}

})();