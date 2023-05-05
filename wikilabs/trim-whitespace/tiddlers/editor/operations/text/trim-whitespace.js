/*\
title: $:/plugins/wikilabs/trim-whitespace/editor/operations/text/trim-whitespace.js
type: application/javascript
module-type: texteditoroperation

Trim whitespace from selection
modes: leading, trailing, full, white-line

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports["trim-whitespace"] = function(event,operation) {
	var mode = event.paramObject.mode || "prefix";

	// Cut just past the preceding line break, or the start of the text
	operation.cutStart = $tw.utils.findPrecedingLineBreak(operation.text,operation.selStart);

	// Cut to just past the following line break, or to the end of the text
	operation.cutEnd = $tw.utils.findFollowingLineBreak(operation.text,operation.selEnd);

	// Process each line
	var lines = operation.text.substring(operation.cutStart,operation.cutEnd).split(/\r?\n/mg);
	$tw.utils.each(lines,function(line,index) {
		switch (mode) {
			case "leading":
				line = line.trimStart();
			break;
			case "trailing":
				line = line.trimEnd();
			break;
			case "full":
				line = line.trim();
			break;
			case "white-line":
				if (!(/\S/.test(line))) {
					line = line.trim();
				}
			break;
		}
		// Save the modified line
		lines[index] = line;
	});
	// Stitch the replacement text together and set the selection
	operation.replacement = lines.join("\n");
	if(lines.length === 1) {
		operation.newSelStart = operation.cutStart + operation.replacement.length;
		operation.newSelEnd = operation.newSelStart;
	} else {
		operation.newSelStart = operation.cutStart;
		operation.newSelEnd = operation.newSelStart + operation.replacement.length;
	}
};
})();
