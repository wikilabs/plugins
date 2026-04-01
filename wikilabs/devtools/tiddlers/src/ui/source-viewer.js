/*\
title: $:/plugins/wikilabs/devtools/source-viewer.js
type: application/javascript
module-type: library

Source Viewer: a floating, draggable, resizable modal that accumulates
source code entries from data-source-pos right-click actions.

\*/

"use strict";

var utils = require("$:/plugins/wikilabs/devtools/utils.js");
var el = utils.el;
var sharedState = utils.state;

var MAX_SOURCE_ENTRIES = 100;
var viewer = null;
var entries = [];
var snippetMap = {};

function getLayout() {
	var s = sharedState.viewerLayout;
	return {
		width: s.width || 600, height: s.height || 400,
		left: s.left !== undefined ? s.left : -1,
		top: s.top !== undefined ? s.top : 60
	};
}

function saveLayout(props) {
	for(var k in props) sharedState.viewerLayout[k] = parseInt(props[k], 10);
}

function clearAllHighlights() {
	var headers = getAllHeaders();
	for(var i = 0; i < headers.length; i++) {
		if(headers[i]._unhighlightOrigin) headers[i]._unhighlightOrigin();
	}
}

function getOrCreate() {
	if(viewer && document.body.contains(viewer)) return viewer;

	viewer = el("div", "wltc-panel");
	viewer.id = "sourcepos-source-viewer";

	var layout = getLayout();
	viewer.style.width = Math.max(300, layout.width) + "px";
	viewer.style.height = Math.max(150, layout.height) + "px";
	if(layout.left >= 0) {
		viewer.style.left = layout.left + "px";
	} else {
		viewer.style.right = "20px";
	}
	viewer.style.top = layout.top + "px";

	// Header
	var header = el("div", "wltc-panel-header");
	header.appendChild(el("span", null, "Source Viewer"));

	var headerBtns = el("span", "wltc-btn-group");
	var clearBtn = el("span", "wltc-btn-clear", "Clear");
	clearBtn.addEventListener("click", function() {
		clearAllHighlights();
		entries = [];
		snippetMap = {};
		var c = viewer.querySelector(".sourcepos-viewer-content");
		if(c) c.innerHTML = "";
	});
	var closeBtn = el("span", "wltc-btn-close", "\u2715");
	closeBtn.addEventListener("click", function() {
		clearAllHighlights();
		viewer.remove();
	});
	headerBtns.appendChild(clearBtn);
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);
	viewer.appendChild(header);

	// Content
	var content = el("div", "sourcepos-viewer-content wltc-panel-content");
	viewer.appendChild(content);

	// Resize handle
	var resizeHandle = el("div", "wltc-panel-resize");
	resizeHandle.appendChild(el("div", "wltc-panel-grip"));
	viewer.appendChild(resizeHandle);
	document.body.appendChild(viewer);

	// Drag & resize
	utils.makeDraggable(header, viewer, {
		ignore: function(e) { return e.target === closeBtn || e.target === clearBtn; },
		onStart: function() { viewer.style.right = "auto"; },
		onEnd: function() {
			saveLayout({ left: String(parseInt(viewer.style.left, 10)), top: String(parseInt(viewer.style.top, 10)) });
		}
	});
	utils.makeResizable(resizeHandle, viewer, {
		onEnd: function() {
			saveLayout({ width: String(viewer.offsetWidth), height: String(viewer.offsetHeight) });
		}
	});

	return viewer;
}

// Extract snippet and procedure name from source info
function getSnippetInfo(info) {
	var sourceText = $tw.wiki.getTiddlerText(info.tiddler, "");
	if(isNaN(info.charStart) || isNaN(info.charEnd) || info.charEnd <= info.charStart) {
		return { snippet: "(no char range available)", procName: "", key: info.tiddler + ":no-range" };
	}
	var textBefore = sourceText.substring(0, info.charStart);
	var defMatch = textBefore.match(/[\s\S]*\\(procedure|define|widget|function)\s+([^\s(]+)/);
	if(defMatch) {
		var defStart = textBefore.lastIndexOf("\\" + defMatch[1]);
		var endIdx = sourceText.indexOf("\\end", info.charEnd);
		var defEnd = (endIdx !== -1) ? endIdx + 4 : sourceText.length;
		return {
			snippet: sourceText.substring(defStart, defEnd),
			procName: defMatch[2],
			key: info.tiddler + ":" + defStart + "-" + defEnd
		};
	}
	return {
		snippet: sourceText.substring(info.charStart, info.charEnd),
		procName: "",
		key: info.tiddler + ":" + info.charStart + "-" + info.charEnd
	};
}

// Create a header row for an entry
function createHeaderRow(info, procName, editAtPosition) {
	var sourceElement = info.element;
	var row = el("div", "wltc-entry-header");
	row._sourceElement = sourceElement;

	// Blink/highlight logic
	var blinkTimer = null;
	row._highlightOrigin = function() {
		if(!sourceElement || !document.body.contains(sourceElement)) return;
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		sourceElement.classList.remove("sourcepos-highlight-blink", "sourcepos-highlight-origin");
		var count = 0;
		(function doBlink() {
			if(count < 6) {
				sourceElement.classList.toggle("sourcepos-highlight-blink");
				count++;
				blinkTimer = setTimeout(doBlink, 150);
			} else {
				sourceElement.classList.remove("sourcepos-highlight-blink");
				sourceElement.classList.add("sourcepos-highlight-origin");
				blinkTimer = null;
			}
		})();
	};
	row._unhighlightOrigin = function() {
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		if(sourceElement) {
			sourceElement.classList.remove("sourcepos-highlight-origin", "sourcepos-highlight-blink");
		}
	};

	// Label
	var text = info.raw;
	if(procName) text += "  \u2014 " + procName;
	if(info.context) text += "  \u00BB " + info.context;
	row.appendChild(el("span", null, text));

	// Buttons
	var btns = el("span", "wltc-btn-group-tight");
	if(editAtPosition && !isNaN(info.charStart) && !isNaN(info.charEnd)) {
		var editBtn = utils.makeIconBtn("wltc-btn-icon", "{{$:/core/images/edit-button}}", "Edit at " + info.range);
		editBtn.addEventListener("click", function(e) { e.stopPropagation(); editAtPosition(); });
		btns.appendChild(editBtn);
	}
	var removeBtn = el("span", "wltc-btn-remove", "\u2715");
	removeBtn.addEventListener("click", function(e) {
		e.stopPropagation();
		row._unhighlightOrigin();
		var entry = row.parentNode;
		row.remove();
		if(entry && !entry.querySelector(".sourcepos-entry-header")) {
			var idx = entries.indexOf(entry);
			if(idx !== -1) entries.splice(idx, 1);
			entry.remove();
			for(var k in snippetMap) {
				if(snippetMap[k] === entry) { delete snippetMap[k]; break; }
			}
		}
		updateAutoHighlight();
	});
	btns.appendChild(removeBtn);
	row.appendChild(btns);
	row.classList.add("sourcepos-entry-header");
	row.addEventListener("mouseenter", row._highlightOrigin);
	row.addEventListener("mouseleave", row._unhighlightOrigin);
	return row;
}

function getAllHeaders() {
	var headers = [];
	for(var i = 0; i < entries.length; i++) {
		var rows = entries[i].querySelectorAll(".sourcepos-entry-header");
		for(var j = 0; j < rows.length; j++) headers.push(rows[j]);
	}
	return headers;
}

function updateAutoHighlight() {
	var headers = getAllHeaders();
	for(var i = 0; i < headers.length; i++) {
		if(headers[i]._unhighlightOrigin) headers[i]._unhighlightOrigin();
	}
	if(headers.length === 1 && headers[0]._highlightOrigin) {
		headers[0]._highlightOrigin();
	}
}

function addEntry(info, editAtPosition) {
	var v = getOrCreate();
	var content = v.querySelector(".sourcepos-viewer-content");
	var si = getSnippetInfo(info);

	// Deduplicate: add header to existing entry
	var existing = snippetMap[si.key];
	if(existing && document.body.contains(existing)) {
		var headerRow = createHeaderRow(info, si.procName, editAtPosition);
		var codeBlock = existing.querySelector("pre");
		if(codeBlock) {
			existing.insertBefore(headerRow, codeBlock);
		} else {
			existing.appendChild(headerRow);
		}
		if(content.firstChild !== existing) {
			content.insertBefore(existing, content.firstChild);
		}
		updateAutoHighlight();
		return;
	}

	// Cap entries
	if(entries.length >= MAX_SOURCE_ENTRIES) {
		var oldest = content.lastChild;
		if(oldest) {
			var oldHeaders = oldest.querySelectorAll(".sourcepos-entry-header");
			for(var h = 0; h < oldHeaders.length; h++) {
				if(oldHeaders[h]._unhighlightOrigin) oldHeaders[h]._unhighlightOrigin();
			}
			for(var k in snippetMap) {
				if(snippetMap[k] === oldest) { delete snippetMap[k]; break; }
			}
			oldest.remove();
			entries.pop();
		}
	}

	// New entry
	var entry = el("div", "wltc-entry");
	entry.appendChild(createHeaderRow(info, si.procName, editAtPosition));
	var code = el("pre", "wltc-entry-code");
	code.textContent = si.snippet;
	entry.appendChild(code);

	if(content.firstChild) {
		content.insertBefore(entry, content.firstChild);
	} else {
		content.appendChild(entry);
	}
	entries.unshift(entry);
	snippetMap[si.key] = entry;
	updateAutoHighlight();
}

exports.addEntry = addEntry;
