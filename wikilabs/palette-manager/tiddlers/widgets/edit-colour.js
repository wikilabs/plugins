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

		// TODO use template instead of hardcoded

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

	EditColourWidget.prototype.getValue = function(title) {
		title = title || this.title;
		var tiddler = this.wiki.getTiddler(title);
		if(tiddler) {
			if(this.index) {
				this.colourValue = this.wiki.extractTiddlerDataItem(title,this.index,this.default);
			} else if (this.field) {
				this.colourValue = tiddler.getFieldString(this.field,this.default);
			}
		}
		// normalize RGB values eg: #bbb
		this.value = this.validateRGB(this.colourValue);
		return this.value;
	};

	EditColourWidget.prototype.setValue = function(title, value) {
		title = title || this.title;
		value = value || this.colourValue;
		if(this.index) {
			this.wiki.setText(title,"",this.index,value);
		} else {
			var tiddler = this.wiki.getTiddler(title),
				addition = {};
			addition[this.field] = value;
			this.wiki.addTiddler(new $tw.Tiddler(this.wiki.getCreationFields(),{title:title},tiddler,addition,this.wiki.getModificationFields()));
		}
	};

	EditColourWidget.prototype.handleInputEvent = function(event) {
		this.colourValue = event.target.value;
		if(this.liveUpdate === "yes") {
			if(this.inputActions) {
				this.invokeActionString(this.inputActions,this,event,
					{"tiddler": this.title, "field":this.field, "index":this.index, "value": this.colourValue});
			} else {
				this.setValue();
			}
		}
	}

	EditColourWidget.prototype.handleChangeEvent = function(event) {
		this.colourValue = event.target.value;
		// this.setValue();
		// Trigger actions
		if(this.changeActions) {
			this.invokeActionString(this.changeActions,this,event,
				{"tiddler":this.title, "field":this.field, "index":this.index, "value":this.colourValue});
		} else {
			this.setValue();
		}
	};

	EditColourWidget.prototype.tempTiddlerName = function() {
		return this.tempPrefix + this.title;
	}

	EditColourWidget.prototype.handleInitActions = function() {
		if(this.initActions) {
			this.invokeActionString(this.initActions,this,null, {"col-temp-tiddler": this.tempTiddlerName()});
			return this.getValue(this.tempTiddlerName())
		} else {
			return this.getValue()
		}
	}

	EditColourWidget.prototype.validateRGB = function(value, recurse) {
		recurse = recurse || false
//TODO get https://colorjs.io/ and create a custom colour picker
//as shown at: https://stackoverflow.com/a/39399649

		var x = value.trim().split("");
		var newColour = [];
		if ((x[0] === "#") && (x.length === 4)) {
			// probably RGB short form is used eg: #abc, which can be savely resolved to #aabbcc
			$tw.utils.each(x, function(v){
				(v === "#") ? newColour.push(v) : newColour.push(v+v);
			})
		} else if (x[0] != "#") {
				if (recurse === false) {
					return this.validateRGB(this.default, true); // use default value
				} else {
					return this.default;
				}
		} else {
			return x.join("");
		}
		return newColour.join("");
	}

	/*
	Compute the internal state of the widget
	*/
	EditColourWidget.prototype.execute = function() {
		// Get the parameters from the attributes
		// According to MDN example: https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/color
		this.id = this.getAttribute("id","");			// Can be used together with <label> element
		this.name = this.getAttribute("name","");		// Can be used together with <label> element
		this.isDisabled = this.getAttribute("disabled","no");
		this.tooltip = this.getAttribute("tooltip","");	// Show tooltip
		this.liveUpdate = this.getAttribute("liveUpdate","yes");	// Continous update values ... for backwards compatibility
		// TW specific
		this.title = this.getAttribute("tiddler",this.getVariable("currentTiddler"));
		this.field = this.getAttribute("field","color");
		this.index = this.getAttribute("index");
		this.cClass = this.getAttribute("class","");

		this.default = this.getAttribute("default","#f00");
		this.colourValue = this.default;

		this.tempPrefix = this.getAttribute("tempPrefix","$:/temp/");

		this.changeActions = this.getAttribute("$change");
		this.inputActions = this.getAttribute("$input");
		this.initActions = this.getAttribute("resolveColourActions");

		this.template = this.getAttribute("template");

		// Initialisation
		this.handleInitActions();
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
			this.inputDomNode.value = this.handleInitActions();
			return this.refreshChildren(changedTiddlers);
		} else {
			return this.refreshChildren(changedTiddlers);
		}
	};

	exports.colour = EditColourWidget;

	})();
