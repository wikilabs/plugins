/*\
title: $:/plugins/wikilabs/palette-watch/dark-light-change.js
type: application/javascript
module-type: info

Check for OS of Browser dark / light "(prefers-color-scheme: dark)" info

\*/
"use strict";

/**
 * Listens for dark / light changes: runs the actions tagged $:/tags/DarkLightChangeActions and records the mode.
 * @param {function} updateInfoTiddlersCallback unused, this module adds no info tiddler
 * @returns {object[]} no info tiddler fields
 */
exports.getInfoTiddlerFields = function(updateInfoTiddlersCallback) {
	const infoTiddlerFields = [];
	if($tw.browser) {
		// Dark mode through event listener on MediaQueryList
		const mqList = window.matchMedia("(prefers-color-scheme: dark)");
		mqList.addEventListener("change", function(event) {
			// activate all actions tagged $:/tags/DarkLightChangeActions
			$tw.rootWidget.invokeActionsByTag("$:/tags/DarkLightChangeActions", event, {"dark-mode": mqList.matches ? "yes" : "no"});
			// the next start then keeps a palette picked after this switch (dark-light-startup.js)
			$tw.modules.execute("$:/plugins/wikilabs/palette-watch/dark-light-startup.js").record($tw.wiki, mqList.matches);
		});
	}
	return infoTiddlerFields;
};
