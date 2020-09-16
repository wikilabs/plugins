/*\
title: $:/plugins/wikilabs/tick-text/editor/operations/text/remove-custom-markers.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to add a prefix to the selected lines

\*/
(function(){

/*jslint node:true, browser: true */
/*global $tw:false exports:false */
"use strict";

exports["remove-custom-markers"] = function(event,operation) {
	// regExp to detect custom markers like: 
	// <ID><symol><class> some text
	// ´span.myClass.otherClass some text
	var regExp = /((?=´[^´])´|[»≈]{1,4}|(?=°[^°])°|(?=›[^›])›|(?=_[^_])_)((?:[^\.\r\n\s´°]+))?(\.(?:[^\r\n\s]+))?/mg;
	
	var targetCount = parseInt(event.paramObject.count + "",10);
	// Cut just past the preceding line break, or the start of the text
	operation.cutStart = $tw.utils.findPrecedingLineBreak(operation.text,operation.selStart);
	// Cut to just past the following line break, or to the end of the text
	operation.cutEnd = $tw.utils.findFollowingLineBreak(operation.text,operation.selEnd);
	// Compose the required prefix
	var prefix = $tw.utils.repeat(event.paramObject.character,targetCount);
	// Process each line
	var lines = operation.text.substring(operation.cutStart,operation.cutEnd).split(/\r?\n/mg);
	
	var test = "›´°_»≈";
	
	$tw.utils.each(lines,function(line,index) {
		var fragments = line.split(" ");
		
		var match = fragments[0].match(regExp); 
		
		if (match && (fragments[0] === match[0])) {
			line = fragments.slice(1).join(" ");
		} else if (!match && (test.indexOf(fragments[0]) !== -1)) {
			line = fragments.slice(1).join(" ");
		} else {
			line = fragments.join(" ");
		}
		// Remove any whitespace
		while(line.charAt(0) === " ") {
			line = line.substring(1);
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
