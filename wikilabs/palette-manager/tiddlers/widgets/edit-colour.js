/*\
title: $:/core/modules/widgets/edit-colour.js
type: application/javascript
module-type: widget

Set a field or index at a given tiddler to a colour

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var EditColourWidget = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
EditColourWidget.prototype = new Widget();

/*
Render this widget into the DOM
*/
EditColourWidget.prototype.render = function(parent,nextSibling) {
	// Save the parent dom node
	this.parentDomNode = parent;
	// Compute our attributes
	this.computeAttributes();
	// Execute our logic
	this.execute();
	// Create our elements
	this.inputDomNode = this.document.createElement("input");
	this.inputDomNode.setAttribute("type","color");
	// Set attributes that can be used with a label element
	if (this.id) { this.inputDomNode.setAttribute("id", this.id); }
	if (this.name) { this.inputDomNode.setAttribute("name", this.name); }
	if (this.tooltip) { this.inputDomNode.setAttribute("title", this.tooltip); }
	if (this.resolveColourFilter) { this.inputDomNode.setAttribute("resolveColourFilter", this.resolveColourFilter); }
	if(this.isDisabled === "yes") {
		this.inputDomNode.setAttribute("disabled",true);
	}
	// Assign classes
	var classes = this.cClass.split(" ");
	classes.push("tc-colour-input");
	this.inputDomNode.className = classes.join(" ");
	// Add a click event handler if not disabled
	if (!(this.isDisabled === "yes")) {
		$tw.utils.addEventListeners(this.inputDomNode,[
			{name: "input", handlerObject: this, handlerMethod: "handleInputEvent"},
			{name: "change", handlerObject: this, handlerMethod: "handleChangeEvent"}
		]);
	}
	this.inputDomNode.setAttribute("value", this.value);
	// Insert the label into the DOM and render any children
	parent.insertBefore(this.inputDomNode,nextSibling);
	this.renderChildren(this.inputDomNode,null);
	this.domNodes.push(this.inputDomNode);
};

EditColourWidget.prototype.initColour = function() {
}


EditColourWidget.prototype.getValue = function() {
	var tiddler = this.wiki.getTiddler(this.title);
	if(tiddler) {
		if(this.index) {
			this.colourValue = this.wiki.extractTiddlerDataItem(this.title,this.index,this.default);
		} else {
			this.colourValue = tiddler.getFieldString(this.field,this.default);
		}
		if (this.detectMacroFilter) {
			if ((this.wiki.filterTiddlers(this.detectMacroFilter, this)[0]) && (this.resolveColourFilter)) {
				this.value = this.wiki.filterTiddlers(this.resolveColourFilter, this)[0]
				return this.value;
			}
		}
	} else {
		this.colourValue = this.default;
		this.setValue();
	}
	this.value = this.colourValue;
	return this.colourValue;
};

EditColourWidget.prototype.setValue = function() {
	if(this.index) {
		this.wiki.setText(this.title,"",this.index,this.colourValue);
	} else {
		var tiddler = this.wiki.getTiddler(this.title),
			addition = {};
		addition[this.field] = this.colourValue;
		this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(),{title: this.title},tiddler,addition,this.wiki.getModificationFields()));
	}
};

EditColourWidget.prototype.handleInputEvent = function(event) {
	this.newColour = event.target.value;
	if(this.liveUpdate === "yes") { this.handleChangeEvent(event); }
}


EditColourWidget.prototype.handleChangeEvent = function(event) {
	if(this.colourValue !== this.newColour) {
		this.colourValue = this.newColour;
		this.setValue();
		// Trigger actions
		if(this.onChangeActions) {
			this.invokeActionString(this.onChangeActions,this,event,{"colourValue": this.colourValue});
		}
	}
};

/*
Compute the internal state of the widget
*/
EditColourWidget.prototype.execute = function() {
	// Get the parameters from the attributes
	// According to MDN example: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color
	this.id = this.getAttribute("id","");			// Can be used together with <label> element
	this.name = this.getAttribute("name","");		// Can be used together with <label> element
	this.tooltip = this.getAttribute("tooltip","");	// Show tooltip
	this.liveUpdate = this.getAttribute("liveUpdate","yes");	// Continous update values ... for backwards compatibility
	// TW specific
	this.title = this.getAttribute("tiddler",this.getVariable("currentTiddler"));
	this.field = this.getAttribute("field","color");
	this.index = this.getAttribute("index");
	this.cClass = this.getAttribute("class","");
	this.default = this.getAttribute("default");
	this.detectMacroFilter = this.getAttribute("detectMacroFilter");
	this.resolveColourFilter = this.getAttribute("resolveColourFilter");
	this.isDisabled = this.getAttribute("disabled","no");
	this.onChangeActions = this.getAttribute("onChangeActions","");

	this.getValue();
	// Make the child widgets
	this.makeChildWidgets();
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
EditColourWidget.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
	if(($tw.utils.count(changedAttributes) > 0)) {
		this.refreshSelf();
		return true;
	} else if(changedTiddlers[this.title]) {
		this.inputDomNode.value = this.getValue();
		return this.refreshChildren(changedTiddlers);
	} else {
		return this.refreshChildren(changedTiddlers);
	}
};

exports.colour = EditColourWidget;

})();
