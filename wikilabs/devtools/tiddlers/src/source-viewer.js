/*\
title: $:/plugins/wikilabs/devtools/source-viewer.js
type: application/javascript
module-type: library

Source Viewer: a floating, draggable, resizable modal that accumulates
source code entries from data-source-pos right-click actions.

\*/

"use strict";

var sourcePosUtils = require("$:/plugins/wikilabs/devtools/utils.js");
var sharedState = sourcePosUtils.state;

var MAX_SOURCE_ENTRIES = 100;

function getLayout() {
	var s = sharedState.viewerLayout;
	return {
		width: s.width || 600,
		height: s.height || 400,
		left: s.left !== undefined ? s.left : -1,
		top: s.top !== undefined ? s.top : 60
	};
}

function saveLayout(props) {
	for(var k in props) {
		sharedState.viewerLayout[k] = parseInt(props[k], 10);
	}
}

var viewer = null;
var entries = [];

var renderIconHTML = sourcePosUtils.renderIconHTML;

var editIconCache = "";
function getEditIconHTML() {
	if(!editIconCache) {
		editIconCache = renderIconHTML("{{$:/core/images/edit-button}}");
	}
	return editIconCache;
}

function getOrCreate() {
	if(viewer && document.body.contains(viewer)) {
		return viewer;
	}
	viewer = document.createElement("div");
	viewer.id = "sourcepos-source-viewer";
	viewer.style.cssText = "position:fixed;z-index:100000;background:#2a2a2a;color:#eee;border-radius:6px;padding:0;box-shadow:0 4px 16px rgba(0,0,0,0.5);display:flex;flex-direction:column;overflow:hidden;";
	// Click isolation handled by global capture handler in click-handler.js
	// Load saved layout
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
	var header = document.createElement("div");
	header.style.cssText = "padding:6px 12px;background:#3a3a3a;border-radius:6px 6px 0 0;font-family:monospace;font-size:13px;color:#ffd;display:flex;justify-content:space-between;align-items:center;cursor:move;flex-shrink:0;user-select:none;";
	var headerLabel = document.createElement("span");
	headerLabel.textContent = "Source Viewer";
	header.appendChild(headerLabel);
	var headerBtns = document.createElement("span");
	headerBtns.style.cssText = "display:flex;gap:8px;align-items:center;";
	// Clear all button
	var clearBtn = document.createElement("span");
	clearBtn.textContent = "Clear";
	clearBtn.style.cssText = "cursor:pointer;padding:2px 8px;border-radius:3px;font-size:11px;background:rgba(255,255,255,0.1);";
	clearBtn.addEventListener("mouseenter", function() { clearBtn.style.background = "rgba(255,255,255,0.25)"; });
	clearBtn.addEventListener("mouseleave", function() { clearBtn.style.background = "rgba(255,255,255,0.1)"; });
	clearBtn.addEventListener("click", function() {
		var headers = getAllHeaders();
		for(var i = 0; i < headers.length; i++) {
			if(headers[i]._unhighlightOrigin) headers[i]._unhighlightOrigin();
		}
		entries = [];
		snippetMap = {};
		var content = viewer.querySelector(".sourcepos-viewer-content");
		if(content) content.innerHTML = "";
	});
	headerBtns.appendChild(clearBtn);
	// Close button
	var closeBtn = document.createElement("span");
	closeBtn.textContent = "\u2715";
	closeBtn.style.cssText = "cursor:pointer;padding:2px 6px;border-radius:3px;font-size:14px;";
	closeBtn.addEventListener("mouseenter", function() { closeBtn.style.background = "rgba(255,255,255,0.2)"; });
	closeBtn.addEventListener("mouseleave", function() { closeBtn.style.background = ""; });
	closeBtn.addEventListener("click", function() {
		var headers = getAllHeaders();
		for(var i = 0; i < headers.length; i++) {
			if(headers[i]._unhighlightOrigin) headers[i]._unhighlightOrigin();
		}
		viewer.remove();
	});
	headerBtns.appendChild(closeBtn);
	header.appendChild(headerBtns);
	viewer.appendChild(header);
	// Scrollable content area
	var content = document.createElement("div");
	content.className = "sourcepos-viewer-content";
	content.style.cssText = "flex:1;overflow-y:auto;padding:0;font-family:monospace;font-size:12px;";
	viewer.appendChild(content);
	// Resize handle
	var resizeHandle = document.createElement("div");
	resizeHandle.style.cssText = "position:absolute;bottom:0;right:0;width:16px;height:16px;cursor:nwse-resize;";
	var grip = document.createElement("div");
	grip.style.cssText = "position:absolute;bottom:3px;right:3px;width:8px;height:8px;border-right:2px solid #666;border-bottom:2px solid #666;";
	resizeHandle.appendChild(grip);
	viewer.appendChild(resizeHandle);
	document.body.appendChild(viewer);
	// Drag to move
	header.addEventListener("mousedown", function(e) {
		if(e.target === closeBtn || e.target === clearBtn) return;
		e.preventDefault();
		var dragStartX = e.clientX;
		var dragStartY = e.clientY;
		var rect = viewer.getBoundingClientRect();
		var dragOrigLeft = rect.left;
		var dragOrigTop = rect.top;
		viewer.style.right = "auto";
		viewer.style.left = dragOrigLeft + "px";
		var onDragMove = function(me) {
			viewer.style.left = Math.max(0, dragOrigLeft + me.clientX - dragStartX) + "px";
			viewer.style.top = Math.max(0, dragOrigTop + me.clientY - dragStartY) + "px";
		};
		var onDragEnd = function() {
			document.removeEventListener("mousemove", onDragMove);
			document.removeEventListener("mouseup", onDragEnd);
			saveLayout({ left: String(parseInt(viewer.style.left, 10)), top: String(parseInt(viewer.style.top, 10)) });
		};
		document.addEventListener("mousemove", onDragMove);
		document.addEventListener("mouseup", onDragEnd);
	});
	// Resize
	resizeHandle.addEventListener("mousedown", function(e) {
		e.preventDefault();
		e.stopPropagation();
		var resizeStartX = e.clientX;
		var resizeStartY = e.clientY;
		var origW = viewer.offsetWidth;
		var origH = viewer.offsetHeight;
		var onResizeMove = function(me) {
			viewer.style.width = Math.max(300, origW + me.clientX - resizeStartX) + "px";
			viewer.style.height = Math.max(150, origH + me.clientY - resizeStartY) + "px";
		};
		var onResizeEnd = function() {
			document.removeEventListener("mousemove", onResizeMove);
			document.removeEventListener("mouseup", onResizeEnd);
			saveLayout({ width: String(viewer.offsetWidth), height: String(viewer.offsetHeight) });
		};
		document.addEventListener("mousemove", onResizeMove);
		document.addEventListener("mouseup", onResizeEnd);
	});
	return viewer;
}

// Build the snippet and proc name for a given info
function getSnippetInfo(info) {
	var sourceText = $tw.wiki.getTiddlerText(info.tiddler, "");
	var snippet = "";
	var procName = "";
	var snippetKey = "";
	if(!isNaN(info.charStart) && !isNaN(info.charEnd) && info.charEnd > info.charStart) {
		var defStart = -1;
		var defEnd = -1;
		var textBefore = sourceText.substring(0, info.charStart);
		var defMatch = textBefore.match(/[\s\S]*\\(procedure|define|widget|function)\s+([^\s(]+)/);
		if(defMatch) {
			defStart = textBefore.lastIndexOf("\\" + defMatch[1]);
			procName = defMatch[2];
			var endPattern = "\\end";
			var endIdx = sourceText.indexOf(endPattern, info.charEnd);
			defEnd = (endIdx !== -1) ? endIdx + endPattern.length : sourceText.length;
		}
		if(defStart >= 0 && defEnd > defStart) {
			snippet = sourceText.substring(defStart, defEnd);
			snippetKey = info.tiddler + ":" + defStart + "-" + defEnd;
		} else {
			snippet = sourceText.substring(info.charStart, info.charEnd);
			snippetKey = info.tiddler + ":" + info.charStart + "-" + info.charEnd;
		}
	} else {
		snippet = "(no char range available)";
		snippetKey = info.tiddler + ":no-range";
	}
	return { snippet: snippet, procName: procName, key: snippetKey };
}

// Create a header row for an entry
function createHeaderRow(info, procName, editAtPosition) {
	var sourceElement = info.element;
	var highlightClass = "sourcepos-highlight-origin";
	var row = document.createElement("div");
	row.style.cssText = "padding:4px 12px;background:#333;color:#ffd;font-size:11px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;";
	row._sourceElement = sourceElement;
	var blinkTimer = null;
	row._highlightOrigin = function() {
		if(!sourceElement || !document.body.contains(sourceElement)) return;
		// Blink 3 times in red, then stay with blue highlight
		var blinkCount = 0;
		var blinkClass = "sourcepos-highlight-blink";
		function doBlink() {
			if(blinkCount < 6) {
				sourceElement.classList.toggle(blinkClass);
				blinkCount++;
				blinkTimer = setTimeout(doBlink, 150);
			} else {
				sourceElement.classList.remove(blinkClass);
				sourceElement.classList.add(highlightClass);
				blinkTimer = null;
			}
		}
		// Clear any previous blink
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		sourceElement.classList.remove(blinkClass);
		sourceElement.classList.remove(highlightClass);
		doBlink();
	};
	row._unhighlightOrigin = function() {
		if(blinkTimer) { clearTimeout(blinkTimer); blinkTimer = null; }
		if(sourceElement) {
			sourceElement.classList.remove(highlightClass);
			sourceElement.classList.remove("sourcepos-highlight-blink");
		}
	};
	var label = document.createElement("span");
	label.textContent = info.raw;
	if(procName) {
		label.textContent += "  \u2014 " + procName;
	}
	if(info.context) {
		label.textContent += "  \u00BB " + info.context;
	}
	row.appendChild(label);
	var btns = document.createElement("span");
	btns.style.cssText = "display:flex;gap:4px;align-items:center;";
	// Edit button
	if(editAtPosition && !isNaN(info.charStart) && !isNaN(info.charEnd)) {
		var editBtn = document.createElement("span");
		editBtn.innerHTML = getEditIconHTML();
		editBtn.title = "Edit at " + info.range;
		editBtn.style.cssText = "cursor:pointer;fill:#ffd;font-size:0;line-height:0;padding:1px 3px;border-radius:3px;background:rgba(255,255,255,0.1);";
		var svg = editBtn.querySelector("svg");
		if(svg) { svg.setAttribute("width", "12px"); svg.setAttribute("height", "12px"); }
		editBtn.addEventListener("mouseenter", function() { editBtn.style.background = "rgba(255,255,255,0.25)"; });
		editBtn.addEventListener("mouseleave", function() { editBtn.style.background = "rgba(255,255,255,0.1)"; });
		editBtn.addEventListener("click", function(e) { e.stopPropagation(); editAtPosition(); });
		btns.appendChild(editBtn);
	}
	// Remove header row button
	var removeBtn = document.createElement("span");
	removeBtn.textContent = "\u2715";
	removeBtn.style.cssText = "cursor:pointer;padding:1px 4px;border-radius:3px;font-size:11px;color:#999;";
	removeBtn.addEventListener("mouseenter", function() { removeBtn.style.color = "#fff"; });
	removeBtn.addEventListener("mouseleave", function() { removeBtn.style.color = "#999"; });
	removeBtn.addEventListener("click", function(e) {
		e.stopPropagation();
		row._unhighlightOrigin();
		var entry = row.parentNode;
		row.remove();
		// If no headers remain, remove the whole entry
		if(entry && !entry.querySelector(".sourcepos-entry-header")) {
			var idx = entries.indexOf(entry);
			if(idx !== -1) entries.splice(idx, 1);
			entry.remove();
			// Also remove from snippetMap
			for(var k in snippetMap) {
				if(snippetMap[k] === entry) {
					delete snippetMap[k];
					break;
				}
			}
		}
		updateAutoHighlight();
	});
	btns.appendChild(removeBtn);
	row.appendChild(btns);
	row.className = "sourcepos-entry-header";
	// Highlight on hover
	row.addEventListener("mouseenter", row._highlightOrigin);
	row.addEventListener("mouseleave", row._unhighlightOrigin);
	return row;
}

// Map snippet keys to existing entry DOM elements
var snippetMap = {};

function addEntry(info, editAtPosition) {
	var v = getOrCreate();
	var content = v.querySelector(".sourcepos-viewer-content");
	var si = getSnippetInfo(info);
	// Check if this snippet already exists
	var existing = snippetMap[si.key];
	if(existing && document.body.contains(existing)) {
		// Add a new header row above the existing code block
		var headerRow = createHeaderRow(info, si.procName, editAtPosition);
		var codeBlock = existing.querySelector("pre");
		if(codeBlock) {
			existing.insertBefore(headerRow, codeBlock);
		} else {
			existing.appendChild(headerRow);
		}
		// Move entry to top
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
			// Clean up highlights for all headers in the removed entry
			var oldHeaders = oldest.querySelectorAll(".sourcepos-entry-header");
			for(var h = 0; h < oldHeaders.length; h++) {
				if(oldHeaders[h]._unhighlightOrigin) oldHeaders[h]._unhighlightOrigin();
			}
			// Remove from snippetMap
			for(var k in snippetMap) {
				if(snippetMap[k] === oldest) {
					delete snippetMap[k];
					break;
				}
			}
			oldest.remove();
			entries.pop();
		}
	}
	// Create new entry
	var entry = document.createElement("div");
	entry.style.cssText = "border-bottom:1px solid #444;";
	// Header row
	var headerRow = createHeaderRow(info, si.procName, editAtPosition);
	entry.appendChild(headerRow);
	// Source code (read-only)
	var code = document.createElement("pre");
	code.style.cssText = "margin:0;padding:6px 12px;background:#1e1e1e;color:#d4d4d4;font-size:12px;line-height:1.4;white-space:pre-wrap;word-wrap:break-word;overflow-x:auto;";
	code.textContent = si.snippet;
	entry.appendChild(code);
	// Prepend at top
	if(content.firstChild) {
		content.insertBefore(entry, content.firstChild);
	} else {
		content.appendChild(entry);
	}
	entries.unshift(entry);
	snippetMap[si.key] = entry;
	updateAutoHighlight();
}

// Get all header rows across all entries
function getAllHeaders() {
	var headers = [];
	for(var i = 0; i < entries.length; i++) {
		var rows = entries[i].querySelectorAll(".sourcepos-entry-header");
		for(var j = 0; j < rows.length; j++) {
			headers.push(rows[j]);
		}
	}
	return headers;
}

// When only 1 header total, auto-highlight its origin element
function updateAutoHighlight() {
	var headers = getAllHeaders();
	// Clear all highlights first
	for(var i = 0; i < headers.length; i++) {
		if(headers[i]._unhighlightOrigin) headers[i]._unhighlightOrigin();
	}
	// Auto-highlight if exactly 1 header
	if(headers.length === 1 && headers[0]._highlightOrigin) {
		headers[0]._highlightOrigin();
	}
}

exports.addEntry = addEntry;
