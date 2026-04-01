/*\
title: $:/plugins/wikilabs/devtools/context-menu.js
type: application/javascript
module-type: library

Context menu: right-click menu with copy, navigation, inspect, and edit actions.

\*/

"use strict";

var utils = require("$:/plugins/wikilabs/devtools/utils.js");
var sourceViewer = require("$:/plugins/wikilabs/devtools/source-viewer.js");
var variableInspector = require("$:/plugins/wikilabs/devtools/variable-inspector.js");
var inlineEditor = require("$:/plugins/wikilabs/devtools/inline-editor.js");
var el = utils.el;

function makeMenuItem(text, onClick) {
	var item = el("div", "wltc-menu-item", text);
	item.addEventListener("click", function(e) {
		e.stopPropagation();
		e.preventDefault();
		onClick(e);
	});
	return item;
}

// Open tiddler in edit mode and select source range
function editAndSelect(info, removeMenu) {
	var title = info.tiddler;
	var story = new $tw.Story();
	var tiddler = $tw.wiki.getTiddler(title);
	var draftTitle;
	if(tiddler && tiddler.fields["draft.of"]) {
		draftTitle = title;
	} else {
		draftTitle = $tw.wiki.findDraft(title);
		if(!draftTitle) {
			story.navigateTiddler(title);
			draftTitle = $tw.wiki.generateDraftTitle(title);
			$tw.wiki.addTiddler(new $tw.Tiddler(
				{text: ""}, tiddler,
				{ title: draftTitle, "draft.title": title, "draft.of": title },
				$tw.wiki.getModificationFields()
			));
			var storyList = story.getStoryList();
			var idx = storyList.indexOf(title);
			if(idx !== -1) { storyList[idx] = draftTitle; } else { storyList.unshift(draftTitle); }
			story.saveStoryList(storyList);
		}
	}
	var animDuration = parseInt($tw.wiki.getTiddlerText("$:/config/AnimationDuration", "400"), 10) || 400;
	var selectRange = function(retries) {
		var sel = "[data-tiddler-title=\"" + draftTitle.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\]/g, "\\]") + "\"]";
		var tiddlerEl = document.querySelector(sel);
		if(!tiddlerEl) { if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		var textarea = null;
		var iframe = tiddlerEl.querySelector("iframe.tc-edit-texteditor-body") || tiddlerEl.querySelector("iframe.tc-edit-texteditor");
		if(iframe && iframe.contentDocument) textarea = iframe.contentDocument.querySelector("textarea");
		if(!textarea) textarea = tiddlerEl.querySelector("textarea.tc-edit-texteditor-body") || tiddlerEl.querySelector("textarea.tc-edit-texteditor");
		if(!textarea) { if(retries > 0) setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		if(!textarea.value && retries > 0) { setTimeout(function() { selectRange(retries - 1); }, 200); return; }
		var startChar = isNaN(info.charStart) ? 0 : info.charStart;
		var endChar = isNaN(info.charEnd) ? 0 : info.charEnd;
		textarea.focus();
		textarea.setSelectionRange(startChar, endChar);
		var lineNumber = textarea.value.substring(0, startChar).split("\n").length;
		var ownerWindow = textarea.ownerDocument.defaultView || window;
		var lineHeight = parseFloat(ownerWindow.getComputedStyle(textarea).lineHeight) || 16;
		var editorEl = iframe || textarea;
		var selectionScreenY = editorEl.getBoundingClientRect().top + lineNumber * lineHeight;
		if(selectionScreenY < 0 || selectionScreenY > window.innerHeight) {
			window.scrollBy({ top: selectionScreenY - (window.innerHeight / 3), behavior: "instant" });
		}
	};
	setTimeout(function() { selectRange(5); }, animDuration + 100);
	if(removeMenu) removeMenu();
}

function show(event, info) {
	var existing = document.getElementById("sourcepos-context-menu");
	if(existing) existing.remove();
	event.preventDefault();

	var menu = el("div", "wltc-menu");
	menu.id = "sourcepos-context-menu";
	var closeMenu, closeOnEscape;
	var removeMenu = function() {
		menu.remove();
		document.removeEventListener("click", closeMenu, true);
		document.removeEventListener("keydown", closeOnEscape, true);
	};
	var menuX = event.clientX, menuY = event.clientY;
	var rangeInfo = utils.parseRange(info.range);

	// Header
	var header = el("div", "wltc-menu-header");
	header.appendChild(el("span", null, info.raw));

	if(rangeInfo) {
		var editBtn = utils.makeIconBtn("wltc-menu-btn-icon", "{{$:/core/images/edit-button}}", "Edit at " + info.range, "14px");
		editBtn.addEventListener("click", function() { editAndSelect(info, removeMenu); });
		header.appendChild(editBtn);

		var viewBtn = utils.makeIconBtn("wltc-menu-btn-icon", "{{$:/core/images/preview-open}}", "Show source", "14px");
		viewBtn.addEventListener("click", function() {
			sourceViewer.addEntry(info, function() { editAndSelect(info); });
			removeMenu();
		});
		header.appendChild(viewBtn);
	}

	var menuCloseBtn = el("span", "wltc-menu-btn", "\u2715");
	menuCloseBtn.addEventListener("click", function() { removeMenu(); });
	header.appendChild(menuCloseBtn);
	menu.appendChild(header);

	// Menu items
	menu.appendChild(makeMenuItem("Copy tiddler title", function() {
		navigator.clipboard.writeText(info.tiddler); removeMenu();
	}));
	menu.appendChild(makeMenuItem("Copy source position", function() {
		var text = info.raw;
		if(info.context) text += "  \u00BB " + info.context;
		if(info.caller) text += "\n" + info.caller;
		navigator.clipboard.writeText(text); removeMenu();
	}));

	var widget = utils.findWidget(event.target);
	if(widget) {
		menu.appendChild(makeMenuItem("Inspect variables", function() {
			var vars = utils.collectVariables(widget);
			removeMenu();
			variableInspector.show(vars, menuX, menuY, info.element, widget);
		}));
	}

	// Inline editor (hidden by default)
	if(!isNaN(info.charStart) && !isNaN(info.charEnd) && info.charEnd > info.charStart
		&& $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditInline", "").trim() === "show") {
		menu.appendChild(makeMenuItem("Edit inline", function() {
			inlineEditor.show(info, removeMenu);
		}));
	}

	menu.appendChild(makeMenuItem("Open " + info.tiddler, function() {
		new $tw.Story().navigateTiddler(info.tiddler); removeMenu();
	}));

	if(rangeInfo && $tw.wiki.getTiddlerText("$:/config/wikilabs/SourcePositionTracking/ShowEditMenuItem", "").trim() === "show") {
		menu.appendChild(makeMenuItem("Edit at " + info.range, function() { editAndSelect(info, removeMenu); }));
	}

	if(info.caller) {
		var callerLines = info.caller.split("\n");
		for(var ci = 0; ci < callerLines.length; ci++) {
			var callerTitle = callerLines[ci].replace(/^\u2190\s*/, "").trim();
			if(callerTitle && callerTitle !== info.tiddler) {
				(function(title) {
					menu.appendChild(makeMenuItem("Open \u2190 " + title, function() {
						new $tw.Story().navigateTiddler(title); removeMenu();
					}));
				})(callerTitle);
			}
		}
	}

	document.body.appendChild(menu);
	var menuW = menu.offsetWidth, menuH = menu.offsetHeight;
	if(menuX + menuW > window.innerWidth) menuX = Math.max(0, menuX - menuW);
	if(menuY + menuH > window.innerHeight) menuY = Math.max(0, menuY - menuH);
	menu.style.left = menuX + "px";
	menu.style.top = menuY + "px";

	closeMenu = function(e) { if(!menu.contains(e.target)) removeMenu(); };
	var menuHovered = false;
	menu.addEventListener("mouseenter", function() { menuHovered = true; });
	menu.addEventListener("mouseleave", function() { menuHovered = false; });
	closeOnEscape = function(e) { if(e.key === "Escape" && menuHovered) removeMenu(); };
	setTimeout(function() {
		document.addEventListener("click", closeMenu, true);
		document.addEventListener("keydown", closeOnEscape, true);
	}, 0);
}

exports.show = show;
