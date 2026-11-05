/*\
title: $:/plugins/wikilabs/viewportobserver/viewportobserver.js
type: application/javascript
module-type: widget-subclass

The <$viewportobserver> widget: an <$eventcatcher> that also runs $enterview and $leaveview actions for elements matching its selector

\*/

"use strict";

exports.baseClass = "eventcatcher";
exports.name = "viewportobserver";

var VIEW_TYPES = ["enterview","leaveview"];

// Observers shared by all widgets with the same rootMargin and threshold: key -> {observer, owners: Map(element -> widget)}
var pool = new Map();

/**
 * Get the shared observer entry for a set of options, creating it when needed.
 * @param {string} rootMargin - IntersectionObserver rootMargin
 * @param {number[]} threshold - IntersectionObserver thresholds
 * @returns {{observer: IntersectionObserver, owners: Map}} Pool entry
 */
function getPoolEntry(rootMargin,threshold) {
	var key = rootMargin + "|" + threshold.join(","),
		entry = pool.get(key);
	if(!entry) {
		var owners = new Map();
		entry = {
			key: key,
			owners: owners,
			observer: new IntersectionObserver(function(entries) {
				entries.forEach(function(item) {
					var widget = owners.get(item.target);
					if(widget) {
						widget.handleViewChange(item);
					}
				});
			},{rootMargin: rootMargin, threshold: threshold})
		};
		pool.set(key,entry);
	}
	return entry;
}

/**
 * Create a viewportobserver widget.
 * @param {object} parseTreeNode - widget parse tree node
 * @param {object} options - widget options
 * @returns {void}
 */
exports.constructor = function(parseTreeNode,options) {
	this.initialise(parseTreeNode,options);
};

exports.prototype = {};

/**
 * Get the eventcatcher prototype, whose methods this subclass extends.
 * @param {object} widget - viewportobserver widget
 * @returns {object} Base class prototype
 */
function base(widget) {
	return Object.getPrototypeOf(Object.getPrototypeOf(widget));
}

/**
 * Compute the internal state; view types are not DOM events, so they get no listeners.
 * @returns {void}
 */
exports.prototype.execute = function() {
	this.lazy = this.getAttribute("lazy","no") === "yes";
	base(this).execute.call(this);
	this.types = this.types.filter(function(type) {
		return !VIEW_TYPES.includes(type);
	});
	var self = this;
	this.viewTypes = VIEW_TYPES.filter(function(type) {
		return self.hasAttribute("$" + type);
	});
};

/**
 * Check whether the browser can report visibility, which lazy rendering and the view actions need.
 * @returns {boolean} True if IntersectionObserver is available in a real DOM
 */
exports.prototype.canObserve = function() {
	return typeof IntersectionObserver !== "undefined" && !this.document.isTiddlyWikiFakeDom;
};

/**
 * Make the child widgets, except for a lazy widget that has not been near the viewport yet.
 * @param {object[]} [parseTreeNodes] - parse tree nodes of the children
 * @param {object} [options] - options for the child widgets
 * @returns {void}
 */
exports.prototype.makeChildWidgets = function(parseTreeNodes,options) {
	if(this.lazy && !this.lazyRendered && this.canObserve()) {
		this.children = [];
		return;
	}
	base(this).makeChildWidgets.call(this,parseTreeNodes,options);
};

/**
 * Render like the eventcatcher, then observe the matching elements.
 * @param {Element} parent - parent DOM node
 * @param {Element} nextSibling - next sibling DOM node
 * @returns {void}
 */
exports.prototype.render = function(parent,nextSibling) {
	base(this).render.call(this,parent,nextSibling);
	this.observeElements();
};

/**
 * Refresh like the eventcatcher, then observe elements the refresh added.
 * @param {object} changedTiddlers - changed tiddler titles
 * @returns {boolean} True if the widget was refreshed
 */
exports.prototype.refresh = function(changedTiddlers) {
	var refreshed = base(this).refresh.call(this,changedTiddlers);
	this.observeElements();
	return refreshed;
};

/**
 * Stop observing before the DOM nodes go away, also when the widget re-renders itself.
 * @returns {void}
 */
exports.prototype.removeChildDomNodes = function() {
	this.unobserveAll();
	base(this).removeChildDomNodes.call(this);
};

/**
 * Observe the elements matching the selector, or the widget's own element without one, and drop removed ones.
 * @returns {void}
 */
exports.prototype.observeElements = function() {
	var disabled = this.getAttribute("disabled","no") === "yes",
		waitingLazy = this.lazy && !this.lazyRendered;
	if((!this.viewTypes.length && !waitingLazy) || disabled || !this.domNode || !this.canObserve()) {
		this.unobserveAll();
		return;
	}
	var threshold = this.getAttribute("threshold","0").split(/[\s,]+/).filter(Boolean).map(Number),
		poolEntry = getPoolEntry(this.getAttribute("rootMargin","0px"),threshold);
	if(this.poolEntry && this.poolEntry !== poolEntry) {
		this.unobserveAll();
	}
	this.poolEntry = poolEntry;
	this.observed = this.observed || new Set();
	this.inView = this.inView || new WeakSet();
	// A lazy widget waits for its own element, whatever the selector
	var selector = this.getAttribute("selector"),
		elements = selector && !waitingLazy ? Array.from(this.domNode.querySelectorAll(selector)) : [this.domNode],
		self = this;
	this.observed.forEach(function(element) {
		if(!self.domNode.contains(element)) {
			poolEntry.observer.unobserve(element);
			poolEntry.owners.delete(element);
			self.observed.delete(element);
		}
	});
	elements.forEach(function(element) {
		if(!self.observed.has(element)) {
			poolEntry.owners.set(element,self);
			poolEntry.observer.observe(element);
			self.observed.add(element);
		}
	});
};

/**
 * Stop observing all elements of this widget and free the shared observer when nobody uses it.
 * @returns {void}
 */
exports.prototype.unobserveAll = function() {
	var poolEntry = this.poolEntry;
	if(poolEntry && this.observed) {
		this.observed.forEach(function(element) {
			poolEntry.observer.unobserve(element);
			poolEntry.owners.delete(element);
		});
		if(!poolEntry.owners.size) {
			poolEntry.observer.disconnect();
			pool.delete(poolEntry.key);
		}
	}
	this.observed = new Set();
	this.poolEntry = null;
};

/**
 * Run the $enterview or $leaveview actions for an element whose visibility changed.
 * @param {IntersectionObserverEntry} item - intersection change of one element
 * @returns {void}
 */
exports.prototype.handleViewChange = function(item) {
	var element = item.target,
		type;
	if(this.lazy && !this.lazyRendered && item.isIntersecting && element === this.domNode) {
		// Render the children in place: no tiddler changes, so the rest of the wiki does not refresh
		this.lazyRendered = true;
		this.unobserveAll();
		this.makeChildWidgets();
		this.renderChildren(this.domNode,null);
		this.observeElements();
		return;
	}
	if(item.isIntersecting && !this.inView.has(element)) {
		this.inView.add(element);
		type = "enterview";
	} else if(!item.isIntersecting && this.inView.has(element)) {
		// Only elements that entered fire leaveview, not the ones the first callback reports as outside
		this.inView.delete(element);
		type = "leaveview";
	}
	var actions = type && this.getAttribute("$" + type);
	if(actions) {
		var variables = $tw.utils.extend({},$tw.utils.collectDOMVariables(element,this.domNode,null),{
			"event-type": type,
			"intersection-ratio": item.intersectionRatio.toString()
		});
		this.invokeActionString(actions,this,null,variables);
	}
};
