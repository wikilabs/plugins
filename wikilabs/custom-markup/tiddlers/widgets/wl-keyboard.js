/*\
title: $:/plugins/wikilabs/custom-markup/wl-keyboard.js
type: application/javascript
module-type: widget-subclass

Keyboard shortcut widget

\*/
(function(){
/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

exports.baseClass = "keyboard";
exports.name = "wl-keyboard";

exports.constructor = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
}

exports.prototype = {};

exports.prototype.handleChangeEvent = function(event) {
	if($tw.keyboardManager.checkKeyDescriptors(event,this.keyInfoArray)) {
		var variables = Object.create(null),
			temp;
		var handled = this.invokeActions(this,event);
		if(this.actions) {
			$tw.utils.each(this.attributes,function(val,key) {
				if (key.substring(0,4) === "usr-") {
					variables[key] = "" + val;
				} else {
					variables["__" + key + "__"] = "" + val;
				}
			});
			$tw.utils.each(this.keyInfoArray[0],function(val,key) {
				temp = "" + event[key];
				variables["__" + key + "__"] = (temp === "true") ? "yes" : (temp === "false") ? "no" : temp;
			});
			// "tiddler" and/or "field" parameter may be missing in the widget call. See radio widget .execute() 
			variables = $tw.utils.extend(variables, {"__key__": event.key});
			this.invokeActionString(this.actions,this,event,variables);
		}
		this.dispatchMessage(event);
		if(handled || this.actions || this.message) {
			event.preventDefault();
			event.stopPropagation();
		}
		return true;
	}
	return false;
}

})();
