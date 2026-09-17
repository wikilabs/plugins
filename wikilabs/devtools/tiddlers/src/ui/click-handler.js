/*\
title: $:/plugins/wikilabs/devtools/click-handler.js
type: application/javascript
module-type: startup

Startup: registers event handlers for hover tooltip and context menu.
Patches TW's popup handler to ignore clicks inside devtools panels.

\*/

"use strict";

exports.name = "sourcepos-click";
exports.after = ["sourcepos"];
exports.platforms = ["browser"];
exports.synchronous = true;

exports.startup = function() {
	// Required here, not at the top: `platforms` keeps startup() from running on
	// the server but cannot stop the module body, which boot must execute to
	// read this very field. Top-level requires therefore dragged the whole UI
	// into every headless host that loads devtools.
	var utils = require("$:/plugins/wikilabs/devtools/utils.js");
	var tooltip = require("$:/plugins/wikilabs/devtools/tooltip.js");
	var contextMenu = require("$:/plugins/wikilabs/devtools/context-menu.js");

	// Patch TW's popup handler to ignore clicks inside our panels
	var origHandleEvent = $tw.popup.handleEvent.bind($tw.popup);
	$tw.popup.handleEvent = function(event) {
		if(event.type === "click" && event.target.closest &&
			event.target.closest(".sourcepos-var-inspector, #sourcepos-source-viewer, #sourcepos-context-menu")) {
			return;
		}
		return origHandleEvent(event);
	};

	// Hover tooltip
	tooltip.setup();

	// Context menu on right-click
	document.addEventListener("contextmenu", function(event) {
		if(!$tw.wiki.trackSourcePositions || event.ctrlKey) return;
		var info = utils.findSourcePos(event.target);
		if(!info) return;
		contextMenu.show(event, info);
	}, true);
};
