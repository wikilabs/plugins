/*\
title: $:/plugins/wikilabs/uni-link/uni-fields.js
type: application/javascript
module-type: widget

unifields widget, derived from Fields Widget

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false, require:false, exports:false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var FieldsWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
FieldsWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/
FieldsWidget.prototype.render = function(parent,nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	var textNode = this.document.createTextNode(this.text);
	parent.insertBefore(textNode,nextSibling);
	this.domNodes.push(textNode);
};

/*
Compute the internal state of the widget
*/
FieldsWidget.prototype.execute = function() {
	// Get parameters from our attributes
	this.tiddlerTitle = this.getAttribute("tiddler",this.getVariable("currentTiddler"));
	this.template = this.getAttribute("template");
	this.sort = this.getAttribute("sort","yes") === "yes";
	this.exclude = this.getAttribute("exclude");
	this.include = this.getAttribute("include",null);
	this.stripTitlePrefix = this.getAttribute("stripTitlePrefix","no") === "yes";
	this.sortReverse = this.getAttribute("sortReverse","no") === "yes";
	// Get the value to display
	var tiddler = this.wiki.getTiddler(this.tiddlerTitle);

	// Get the inclusion and exclusion list
	var exclude = (this.exclude) ? this.exclude.split(" ") : ["text"];
	// If inclusion is defined, everything else is auto excluded
	var include = (this.include) ? this.include.split(" ") : null;

	// Compose the template
	var text = [];
	if(this.template && tiddler) {
		var fields = [];
		if (include) {
			for(var i=0; i<include.length; i++) {
				if(tiddler.fields[include[i]]) {
					fields.push(include[i]);
				}
			}
		} else {
			for(var fieldName in tiddler.fields) {
				if(exclude.indexOf(fieldName) === -1) {
					fields.push(fieldName);
				}
			}
		}
		if (this.sort) fields.sort();
		if (this.sortReverse) fields.reverse();
		for(var f=0, fmax=fields.length; f<fmax; f++) {
			fieldName = fields[f];
//			if(exclude.indexOf(fieldName) === -1) {
			var row = this.template,
				value = tiddler.getFieldString(fieldName);
			if(this.stripTitlePrefix && fieldName === "title") {
				var reStrip = /^\{[^\}]+\}(.+)/mg,
					reMatch = reStrip.exec(value);
				if(reMatch) {
					value = reMatch[1];
				}
			}
			row = $tw.utils.replaceString(row,"$name$",fieldName);
			row = $tw.utils.replaceString(row,"$value$",value);
			row = $tw.utils.replaceString(row,"$encoded_value$",$tw.utils.htmlEncode(value));
			text.push(row);
//			}
		}
	}
	this.text = text.join("");
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
FieldsWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(changedAttributes.tiddler || changedAttributes.template || changedAttributes.exclude || changedAttributes.stripTitlePrefix || changedTiddlers[this.tiddlerTitle]) {
		this.refreshSelf();
		return true;
	} else {
		return false;
	}
};

exports["uni-fields"] = FieldsWidget;

})();
