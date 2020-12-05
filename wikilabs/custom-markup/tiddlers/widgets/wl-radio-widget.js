/*\
title: $:/plugins/wikilabs/custom-markup/wl-radio-widget.js
type: application/javascript
module-type: widget-subclass
\*/

(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.baseClass = "radio";
exports.name = "wl-radio";

exports.constructor = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
}
exports.prototype = {};

exports.prototype.handleChangeEvent = function(event) {
	var variables = Object.create(null);
	if(this.inputDomNode.checked) {
		this.setValue();
	}
	// Trigger actions. Use variables = {key:value, key:value ...}
	if(this.radioActions) {
		$tw.utils.each(this.attributes,function(val,key) {
			if (key.substring(0,4) === "usr-") {
				variables[key] = "" + val;
			} else {
				variables["__" + key + "__"] = "" + val;
			}
		});
		// "tiddler" and/or "field" parameter may be missing in the widget call. See radio widget .execute() 
		variables = $tw.utils.extend(variables, {"__tiddler__": this.radioTitle,"__field__": this.radioField});
		this.invokeActionString(this.radioActions,this,event,variables);
	}
}

})();