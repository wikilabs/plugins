/*\
title: $:/plugins/wikilabs/custom-markup/startup/pt-dedupe.js
type: application/javascript
module-type: startup

Install the PageTemplate parseTiddler dedupe wrap early — before any
render path can fire `wiki.parseTiddler(PageTemplate)`. TW core's
`getCacheForTiddler` has no in-flight dedupe, so without this wrap the
PageTemplate sub-parser's own `\importcustom` processing (which
spawns sub-parsers for each Pragma-tagged tiddler) can recursively
trigger `parseTiddler(PageTemplate)` again, producing a second full
factory invocation before the outer one stores anything.

Calling `CmRegistry.ensurePageTemplateDedupe(wiki)` is idempotent;
this startup just runs it for `$tw.wiki` once the wiki exists but
before any rendering. The lazy-install path in `CmRegistry`
constructor is still kept as a fallback.

\*/

"use strict";

exports.name = "cm-pt-dedupe";
exports.platforms = ["browser", "node"];
exports.before = ["render"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.utils || !$tw.utils.CmRegistry || !$tw.wiki) { return; }
	if(typeof $tw.utils.CmRegistry.ensurePageTemplateDedupe === "function") {
		$tw.utils.CmRegistry.ensurePageTemplateDedupe($tw.wiki);
	}
};
