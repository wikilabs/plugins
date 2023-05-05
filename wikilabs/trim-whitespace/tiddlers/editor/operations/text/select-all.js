/*\
title: $:/plugins/wikilabs/trim-whitespace/editor/operations/text/select-all.js
type: application/javascript
module-type: texteditoroperation

Trim whitespace from selection
modes: leading, trailing, full, white-line

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports["select-all"] = function(event,operation) {
	operation.replacement = "";
	operation.newSelStart = 0;
	operation.newSelEnd = operation.text.length;
};

})();
