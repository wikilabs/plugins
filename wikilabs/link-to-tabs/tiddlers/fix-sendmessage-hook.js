/*\
title: $:/plugins/wikilabs/link-to-tabs/fix-sendmessage.js
type: application/javascript
module-type: startup

A startup module to fix the <$action-sendmessage widget parameter passing problem

eg:

NavigatorWidget.prototype.handleNavigateEvent = function(event) {
	event = $tw.hooks.invokeHook("th-navigating",event);
	if(event.navigateTo) {             <--- expects event.navigateTo, but sendmessage widget gives event.params.navigateTo
		this.addToStory(event.navigateTo,event.navigateFromTitle);
		if(!event.navigateSuppressNavigation) {
			this.addToHistory(event.navigateTo,event.navigateFromClientRect);
		}
	}
	return false;
};


This hook temporarily fixes the problem.


\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "fixsendmessage";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	$tw.hooks.addHook("th-navigating",function(event) {
		var suppressNavigation = (event.event) ? event.event.metaKey || event.event.ctrlKey || (event.event.button === 1) : false;

		if (!event.navigateTo && event.paramObject && event.paramObject.navigateTo) {
			event.navigateTo = event.paramObject.navigateTo;
			event.navigateSuppressNavigation = event.navigateSuppressNavigation || suppressNavigation;
		}
		return event;
	});
};

})();
