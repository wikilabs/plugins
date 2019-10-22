/*\
title: $:/core/modules/widgets/trigger.js
type: application/javascript
module-type: widget

Trigger widget

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var Widget = require("$:/core/modules/widgets/widget.js").widget;

var Trigger = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

/*
Inherit from the base widget class
*/
Trigger.prototype = new Widget();

/*
Render this widget into the DOM
*/
Trigger.prototype.render = function(parent,nextSibling) {
	this.parentDomNode = parent;
	this.computeAttributes();
	this.execute();
	this.trigger();
//	this.renderChildren(parent,nextSibling);
};

/*
Compute the internal state of the widget
*/
Trigger.prototype.execute = function() {
	// Get our parameters
	this.catchActions = this.getAttribute("actions");

// This widget must have NO child widgets
// Construct the child widgets
//	this.makeChildWidgets();
	// When executing actions we avoid trapping navigate events, so that we don't trigger ourselves recursively
	this.executingActions = false;
};

/*
Selectively refreshes the widget if needed. Returns true if the widget or any of its children needed re-rendering
*/
Trigger.prototype.refresh = function(changedTiddlers) {
	var changedAttributes = this.computeAttributes();
//	if(changedAttributes.actions) {
//		this.refreshSelf();
//		return true;
//	} else {
//		return this.refreshChildren(changedTiddlers);
//	}
};

/*
Handle a tm-navigate event
*/
Trigger.prototype.trigger = function(event) {
	if(!this.executingActions) {
		// Execute the actions
		if(this.catchActions) {
			this.executingActions = true;
			this.invokeActionString(this.catchActions,this,event,{});
			this.executingActions = false;
		}
	}
	return false;
};

exports.trigger = Trigger;

})();
