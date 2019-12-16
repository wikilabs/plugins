/*\
title: $:/plugins/wikilabs/tm-open-story/open-story.js
type: application/javascript
module-type: startup

A startup module

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "openstory";
exports.platforms = ["browser"];
exports.after = ["story"];
exports.synchronous = true;

// Default story and history lists
var DEFAULT_STORY_TITLE = "$:/StoryList";
var DEFAULT_HISTORY_TITLE = "$:/HistoryList";

// Default tiddlers
var DEFAULT_TIDDLERS_TITLE = "$:/DefaultTiddlers";

	/*
Get the value of a text reference. Text references can have any of these forms:
	<tiddlertitle>
	<tiddlertitle>!!<fieldname>
	!!<fieldname> - specifies a field of the current tiddlers
	<tiddlertitle>##<index>
*/
// exports.getTextReference = function(textRef,defaultText,currTiddlerTitle) {

exports.startup = function() {
		// Listen for the tm-home message
		$tw.rootWidget.addEventListener("tm-open-story",function(event) {
			window.location.hash = "";
			var storyTitle = event.param ? event.param : DEFAULT_TIDDLERS_TITLE;

			var storyFilter = $tw.wiki.getTextReference(storyTitle, "GettingStarted"),
				storyList = $tw.wiki.filterTiddlers(storyFilter),
				options = event.paramObject || {};
			//invoke any hooks that might change the default story list
			storyList = $tw.hooks.invokeHook("th-opening-story",storyList);
			$tw.wiki.addTiddler({title: DEFAULT_STORY_TITLE, text: "", list: storyList},$tw.wiki.getModificationFields());
			if(storyList[0]) {
				$tw.wiki.addToHistory(storyList[0]);
			}
		});
};

})();
