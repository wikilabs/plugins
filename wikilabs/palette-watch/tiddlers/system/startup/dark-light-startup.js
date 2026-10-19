/*\
title: $:/plugins/wikilabs/palette-watch/dark-light-startup.js
type: application/javascript
module-type: startup

At startup, the dark / light change actions run only when the browser or OS mode changed since the last start or
switch, so a palette picked meanwhile stays

\*/
"use strict";

exports.name = "palette-watch-startup";
exports.platforms = ["browser"];
exports.after = ["startup"];
exports.synchronous = true;

// the mode last acted on: "dark" or "light"
const LAST_MODE = "$:/config/palette/last-mode";

/**
 * Runs the change actions when the mode differs from the one last acted on, then records it.
 * @returns {void}
 */
exports.startup = function() {
	const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
	if(!exports.changed($tw.wiki.getTiddlerText(LAST_MODE, ""), dark)) return;
	$tw.rootWidget.invokeActionsByTag("$:/tags/DarkLightChangeActions", null, {"dark-mode": dark ? "yes" : "no"});
	exports.record($tw.wiki, dark);
};

/**
 * Whether the mode differs from the one last acted on; true when none was recorded yet.
 * @param {string} last "dark", "light" or ""
 * @param {boolean} dark the mode now
 * @returns {boolean}
 */
exports.changed = function(last, dark) {
	return last !== (dark ? "dark" : "light");
};

/**
 * Records the mode acted on, so the next start leaves the palette alone until it changes.
 * @param {any} wiki
 * @param {boolean} dark
 * @returns {void}
 */
exports.record = function(wiki, dark) {
	wiki.setText(LAST_MODE, "text", null, dark ? "dark" : "light");
};
