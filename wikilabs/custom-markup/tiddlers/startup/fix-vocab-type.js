/*\
title: $:/plugins/wikilabs/custom-markup/startup/fix-vocab-type.js
type: application/javascript
module-type: startup

Patch generateTiddlerFileInfo so tiddlers with type
`text/vnd.tiddlywiki;vocab=...` save as a single .tid file rather than
the body+.meta two-file fallback that exact-match type lookup would
otherwise pick.

The on-disk type field still carries the full parametric value because
the underlying saveTiddlerToFile reads tiddler.fields directly; we only
adjust what generateTiddlerFileInfo sees during its file-format decision.

\*/

"use strict";

exports.name = "cm-fix-vocab-type";
exports.platforms = ["node"];
exports.synchronous = true;

exports.startup = function() {
	if(!$tw.utils || !$tw.utils.generateTiddlerFileInfo) { return; }
	var orig = $tw.utils.generateTiddlerFileInfo;
	$tw.utils.generateTiddlerFileInfo = function(tiddler, options) {
		var type = tiddler && tiddler.fields && tiddler.fields.type;
		if(type && /^text\/vnd\.tiddlywiki\s*;/.test(type)) {
			var clone = new $tw.Tiddler(tiddler, {type: "text/vnd.tiddlywiki"});
			return orig.call(this, clone, options);
		}
		return orig.call(this, tiddler, options);
	};
};
