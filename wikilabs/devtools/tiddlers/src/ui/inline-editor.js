/*\
title: $:/plugins/wikilabs/devtools/inline-editor.js
type: application/javascript
module-type: library

Inline editor: floating popup for direct wikitext editing (hidden by default).

\*/

"use strict";

var utils = require("$:/plugins/wikilabs/devtools/utils.js");
var el = utils.el;
var sharedState = utils.state;

function show(info, removeMenu) {
	var sourceText = $tw.wiki.getTiddlerText(info.tiddler, "");
	var snippet = sourceText.substring(info.charStart, info.charEnd);
	$tw.wiki.addTiddler(new $tw.Tiddler({
		title: "$:/temp/sourcepos/edit", text: snippet,
		"source-tiddler": info.tiddler, "source-start": String(info.charStart),
		"source-end": String(info.charEnd), "source-pos": info.raw
	}));
	if(removeMenu) removeMenu();

	var existingEditor = document.getElementById("sourcepos-inline-editor");
	if(existingEditor) existingEditor.remove();

	var layoutTitle = "$:/temp/sourcepos/editor-layout";
	var editorLayout = $tw.wiki.getTiddler(layoutTitle);
	var elF = editorLayout ? editorLayout.fields : {};
	var popupW = Math.max(300, parseInt(elF.width, 10) || 500);
	var popupH = Math.max(150, parseInt(elF.height, 10) || 300);

	var popup = el("div", "wltc-panel");
	popup.id = "sourcepos-inline-editor";
	popup.style.width = popupW + "px";
	popup.style.height = popupH + "px";

	var popupHeader = el("div", "wltc-panel-header");
	popupHeader.style.fontSize = "12px";
	popupHeader.appendChild(el("span", null, info.raw));
	var popCloseBtn = el("span", "wltc-btn-close", "\u2715");
	popCloseBtn.addEventListener("click", function() { popup.remove(); });
	popupHeader.appendChild(popCloseBtn);
	popup.appendChild(popupHeader);

	var editorArea = document.createElement("textarea");
	editorArea.value = snippet;
	editorArea.className = "wltc-editor-textarea";
	popup.appendChild(editorArea);

	var btnBar = el("div", "wltc-editor-btnbar");
	var cancelBtn = document.createElement("button");
	cancelBtn.textContent = "Cancel";
	cancelBtn.className = "wltc-editor-btn-cancel";
	cancelBtn.addEventListener("click", function() { popup.remove(); });
	btnBar.appendChild(cancelBtn);
	var applyBtn = document.createElement("button");
	applyBtn.textContent = "Apply";
	applyBtn.className = "wltc-editor-btn-apply";
	applyBtn.addEventListener("click", function() {
		var tiddler = $tw.wiki.getTiddler(info.tiddler);
		if(tiddler) {
			var fullText = tiddler.fields.text || "";
			$tw.wiki.addTiddler(new $tw.Tiddler(tiddler,
				{ text: fullText.substring(0, info.charStart) + editorArea.value + fullText.substring(info.charEnd) },
				$tw.wiki.getModificationFields()));
		}
		popup.remove();
	});
	btnBar.appendChild(applyBtn);
	popup.appendChild(btnBar);

	var resizeHandle = el("div", "wltc-panel-resize");
	resizeHandle.appendChild(el("div", "wltc-panel-grip"));
	popup.appendChild(resizeHandle);
	document.body.appendChild(popup);

	var rect = info.element.getBoundingClientRect();
	var left = Math.max(4, Math.min(rect.left, window.innerWidth - popupW - 4));
	var top = rect.bottom + 4;
	if(top + popupH > window.innerHeight) top = Math.max(4, rect.top - popupH - 4);
	popup.style.left = left + "px";
	popup.style.top = top + "px";

	utils.makeDraggable(popupHeader, popup, {
		ignore: function(e) { return e.target === popCloseBtn; }
	});
	utils.makeResizable(resizeHandle, popup, {
		onStart: function() { sharedState.isResizing = true; },
		onEnd: function() {
			sharedState.isResizing = false;
			var existing = $tw.wiki.getTiddler(layoutTitle);
			var ef = existing ? existing.fields : { title: layoutTitle };
			$tw.wiki.addTiddler(new $tw.Tiddler(ef, { title: layoutTitle, width: String(popup.offsetWidth), height: String(popup.offsetHeight) }));
		}
	});

	editorArea.focus();
	var onKeydown = function(e) {
		if(e.key === "Escape") { popup.remove(); document.removeEventListener("keydown", onKeydown, true); }
		else if(e.key === "Enter" && e.ctrlKey) { e.preventDefault(); applyBtn.click(); document.removeEventListener("keydown", onKeydown, true); }
	};
	document.addEventListener("keydown", onKeydown, true);
}

exports.show = show;
