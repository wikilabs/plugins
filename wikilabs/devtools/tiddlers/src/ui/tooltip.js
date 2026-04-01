/*\
title: $:/plugins/wikilabs/devtools/tooltip.js
type: application/javascript
module-type: library

Hover tooltip: shows source position info after a 400ms delay.

\*/

"use strict";

var utils = require("$:/plugins/wikilabs/devtools/utils.js");
var el = utils.el;
var sharedState = utils.state;

var hoverTimer = null;
var tooltip = null;

function removeTooltip() {
	if(hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
	if(tooltip) { tooltip.remove(); tooltip = null; }
}

function setup() {
	document.addEventListener("mouseover", function(event) {
		if(!$tw.wiki.trackSourcePositions || sharedState.isResizing) return;
		var info = utils.findSourcePos(event.target);
		if(!info) { removeTooltip(); return; }
		var mouseX = event.clientX, mouseY = event.clientY;
		removeTooltip();
		hoverTimer = setTimeout(function() {
			hoverTimer = null;
			var text = info.raw;
			var context = info.element.getAttribute("data-source-context");
			if(context) text += "  \u00BB " + context;
			if(info.caller) {
				var callerLines = info.caller.split("\n");
				var short = callerLines.filter(function(c) { return !context || c.indexOf(context) === -1; });
				if(short.length > 3) { short = short.slice(0, 3); short.push("\u2190 +" + (callerLines.length - 3) + " more"); }
				if(short.length > 0) text += "\n" + short.join("\n");
			}
			tooltip = el("div", "wltc-tooltip");
			tooltip.appendChild(el("div", "wltc-tooltip-header", text.split("\n")[0]));
			var restLines = text.split("\n").slice(1).join("\n");
			if(restLines) tooltip.appendChild(el("div", "wltc-tooltip-body", restLines));
			document.body.appendChild(tooltip);
			var rect = info.element.getBoundingClientRect();
			var tipH = tooltip.offsetHeight, tipW = tooltip.offsetWidth;
			var left = Math.max(4, Math.min(rect.left, window.innerWidth - tipW - 4));
			if(rect.top - tipH - 4 >= 0) {
				tooltip.style.left = left + "px";
				tooltip.style.top = (rect.top - tipH - 4) + "px";
			} else {
				tooltip.style.left = Math.min(mouseX + 8, window.innerWidth - tipW - 4) + "px";
				tooltip.style.top = Math.min(mouseY + 16, window.innerHeight - tipH - 4) + "px";
			}
		}, 400);
	}, true);

	document.addEventListener("mouseout", function(event) {
		if(!event.relatedTarget || !utils.findSourcePos(event.relatedTarget)) removeTooltip();
	}, true);
}

exports.setup = setup;
