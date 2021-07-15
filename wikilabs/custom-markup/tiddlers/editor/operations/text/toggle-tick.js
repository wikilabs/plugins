/*\
title: $:/plugins/wikilabs/custom-markup/editor/operations/text/toggle-tick.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to add a prefix to the selected lines

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw:false exports:false */
"use strict";

exports["toggle-tick"] = function(event,operation) {
	var targetCount = parseInt(event.paramObject.count + "",10);
	// Cut just past the preceding line break, or the start of the text
	operation.cutStart = $tw.utils.findPrecedingLineBreak(operation.text,operation.selStart);
	// Cut to just past the following line break, or to the end of the text
	operation.cutEnd = $tw.utils.findFollowingLineBreak(operation.text,operation.selEnd);
	// Compose the required prefix
	var prefix = $tw.utils.repeat(event.paramObject.character,targetCount);
	// Process each line
	var lines,
		text = operation.text.substring(operation.cutStart,operation.cutEnd);
	if (text === "\n" || text === "\r\n") {
		if (operation.cutEnd < operation.cutStart) {
			var x = operation.cutEnd;
			operation.cutEnd = operation.cutStart
			operation.cutStart = x;
		}
		lines = [""]; // only 1 line should be used
	} else {
		lines = text.split(/\r?\n/mg);
	}
	$tw.utils.each(lines,function(line,index) {
		// Remove and count any existing prefix characters
		var addPrefix = true;
		var fragments = line.split(" ");
		if (fragments[0] === event.paramObject.character) {
			line = fragments.slice(1).join(" ");
			addPrefix = false
		} else {
			line = fragments.join(" ");
		}
		// Remove any whitespace
		while(line.charAt(0) === " ") {
			line = line.substring(1);
		}
		// We're done if we removed the exact required prefix, otherwise add it
		if(addPrefix) {
			// Apply the prefix
			if (event.paramObject && event.paramObject.force === "yes") {
				line = prefix + " " + line;
			} else {
				line = (line === "") ? line : prefix + " " + line;
			}
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
