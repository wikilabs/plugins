/*\
title: $:/plugins/wikilabs/scroll-memory/startup.js
type: application/javascript
module-type: startup

Scroll position memory for long tiddlers in the story river.

Three cooperating behaviours, all session-only (state under $:/temp/volatile/):
1. Offset memory: navigating to a long tiddler restores the last scroll
   position within it instead of jumping to its top.
2. Click landmarks: following a link out of a long tiddler records where the
   click happened; the floating back button (tm-scroll-memory-back) scrolls
   that spot back into view, restoring the exact view at click time.
3. Auto-restore on close: closing the tiddler that a landmark navigated to
   scrolls back to the click spot automatically.

\*/

"use strict";

exports.name = "scroll-memory";
exports.platforms = ["browser"];
exports.after = ["render"];
exports.synchronous = true;

var OFFSET_PREFIX = "$:/temp/volatile/scroll-memory/offset/",
	DRAFT_OFFSET_PREFIX = "$:/temp/volatile/scroll-memory/draft-offset/",
	STACK_TITLE = "$:/temp/volatile/scroll-memory/back-stack",
	CURSOR_TITLE = "$:/temp/volatile/scroll-memory/cursor",
	TOGGLE_RETURN_TITLE = "$:/temp/volatile/scroll-memory/toggle-return",
	READING_POSITION_TITLE = "$:/temp/volatile/scroll-memory/reading-position",
	TOP_TARGET_TITLE = "$:/temp/volatile/scroll-memory/top-target",
	STORY_LIST_TITLE = "$:/StoryList",
	CONFIG_OFFSET_MEMORY = "$:/config/wikilabs/scroll-memory/offset-memory",
	CONFIG_LANDMARKS = "$:/config/wikilabs/scroll-memory/landmarks",
	CONFIG_AUTO_RESTORE = "$:/config/wikilabs/scroll-memory/auto-restore-on-close",
	CONFIG_BLINK = "$:/config/wikilabs/scroll-memory/blink",
	CONFIG_ALWAYS_ACTIVE = "$:/config/wikilabs/scroll-memory/always-active",
	CONFIG_LANDMARK_ON_OPEN = "$:/config/wikilabs/scroll-memory/landmark-on-open",
	CONFIG_TOP_BUTTON = "$:/config/wikilabs/scroll-memory/top-button",
	CONFIG_MIN_OFFSET = "$:/config/wikilabs/scroll-memory/min-offset",
	CONFIG_STACK_LIMIT = "$:/config/wikilabs/scroll-memory/stack-limit",
	NOTIFY_FIRST = "$:/language/wikilabs/scroll-memory/Notifications/First",
	NOTIFY_LAST = "$:/language/wikilabs/scroll-memory/Notifications/Last",
	STICKY_TITLES_TITLE = "$:/themes/tiddlywiki/vanilla/options/stickytitles",
	SCROLL_SETTLE_INTERVAL = 150;

// A draft carries `draft.of` (the title it edits). Its story frame is an edit
// frame, so getStoryFrames() (view frames only) never returns it.
function isDraftTitle(title) {
	var t = title && $tw.wiki.getTiddler(title);
	return !!(t && t.fields["draft.of"]);
}

// All story frames, view AND edit, in DOM (== story) order. Used by the toggle
// cycle and draft-position capture, which must see edit frames too.
function getAllStoryFrames() {
	return document.querySelectorAll(".tc-story-river > [data-tiddler-title]");
}

function findAnyFrame(title) {
	var frames = getAllStoryFrames();
	for(var i=0; i<frames.length; i++) {
		if(frames[i].getAttribute("data-tiddler-title") === title) {
			return frames[i];
		}
	}
	return null;
}

// Draft titles currently in the story, in story order.
function getOpenDraftTitles() {
	var story = $tw.wiki.getTiddlerList(STORY_LIST_TITLE),
		out = [];
	for(var i=0; i<story.length; i++) {
		if(isDraftTitle(story[i])) {
			out.push(story[i]);
		}
	}
	return out;
}

// Map of draft-title -> edited title (draft.of) for the drafts in `story`.
// Snapshotted each story change so that when a draft LEAVES the story (saved
// or cancelled), we can still tell which title it was editing even though its
// draft tiddler may already be deleted.
function buildDraftMap(story) {
	var map = Object.create(null);
	for(var i=0; i<story.length; i++) {
		var t = $tw.wiki.getTiddler(story[i]);
		if(t && t.fields["draft.of"]) {
			map[story[i]] = t.fields["draft.of"];
		}
	}
	return map;
}

function isEnabled(configTitle) {
	return $tw.wiki.getTiddlerText(configTitle,"yes").trim() !== "no";
}

function isAlwaysActive() {
	return $tw.wiki.getTiddlerText(CONFIG_ALWAYS_ACTIVE,"no").trim() === "yes";
}

function stickyTitlesActive() {
	return $tw.wiki.getTiddlerText(STICKY_TITLES_TITLE,"no").trim() === "yes";
}

function getNumberConfig(configTitle,defaultValue) {
	var value = parseInt($tw.wiki.getTiddlerText(configTitle,""),10);
	return isNaN(value) ? defaultValue : value;
}

// Same reference line the core PageScroller uses as "top of viewport"
function getToolbarOffset() {
	var toolbar = document.querySelector(".tc-adjust-top-of-scroll");
	return toolbar ? toolbar.offsetHeight : 0;
}

// View-mode frames only; edit frames carry the draft title and are not scroll targets
function getStoryFrames() {
	return document.querySelectorAll(".tc-story-river > .tc-tiddler-view-frame[data-tiddler-title]");
}

function findFrame(title) {
	var frames = getStoryFrames();
	for(var i=0; i<frames.length; i++) {
		if(frames[i].getAttribute("data-tiddler-title") === title) {
			return frames[i];
		}
	}
	return null;
}

function saveOffset(title,offset) {
	var tiddlerTitle = OFFSET_PREFIX + title,
		existing = $tw.wiki.getTiddler(tiddlerTitle);
	if(!existing || existing.fields["scroll-top"] !== String(offset)) {
		$tw.wiki.addTiddler(new $tw.Tiddler({title: tiddlerTitle,"scroll-top": String(offset)}));
	}
}

function clearOffset(title) {
	var tiddlerTitle = OFFSET_PREFIX + title;
	if($tw.wiki.tiddlerExists(tiddlerTitle)) {
		$tw.wiki.deleteTiddler(tiddlerTitle);
	}
}

function getOffset(title) {
	var tiddler = $tw.wiki.getTiddler(OFFSET_PREFIX + title),
		value = tiddler && parseInt(tiddler.fields["scroll-top"],10);
	return value && value > 0 ? value : 0;
}

/*
Draft offsets are the scroll position within an OPEN draft (edit frame),
keyed by the draft title. Used by the toggle cycle to return you to exactly
where you were writing. Recorded at any depth (unlike view offsets, which
only remember long tiddlers) and cleared when the draft leaves the story.
*/
function saveDraftOffset(title,offset) {
	var tiddlerTitle = DRAFT_OFFSET_PREFIX + title,
		existing = $tw.wiki.getTiddler(tiddlerTitle);
	if(!existing || existing.fields["scroll-top"] !== String(offset)) {
		$tw.wiki.addTiddler(new $tw.Tiddler({title: tiddlerTitle,"scroll-top": String(offset)}));
	}
}

function getDraftOffset(title) {
	var tiddler = $tw.wiki.getTiddler(DRAFT_OFFSET_PREFIX + title),
		value = tiddler && parseInt(tiddler.fields["scroll-top"],10);
	return value && value > 0 ? value : 0;
}

function clearDraftOffset(title) {
	var tiddlerTitle = DRAFT_OFFSET_PREFIX + title;
	if($tw.wiki.tiddlerExists(tiddlerTitle)) {
		$tw.wiki.deleteTiddler(tiddlerTitle);
	}
}

/*
The cursor is the history position while walking with back/forward in
always-active mode. Absent means "not walking", represented as one past the
newest entry, so the first back step lands on the newest landmark.
*/
function getCursor(stackLength) {
	var value = parseInt($tw.wiki.getTiddlerText(CURSOR_TITLE,""),10);
	return (isNaN(value) || value < 0 || value >= stackLength) ? stackLength : value;
}

function setCursor(index) {
	$tw.wiki.addTiddler(new $tw.Tiddler({title: CURSOR_TITLE,text: String(index)}));
}

function clearCursor() {
	if($tw.wiki.tiddlerExists(CURSOR_TITLE)) {
		$tw.wiki.deleteTiddler(CURSOR_TITLE);
	}
}

/*
The top target is the long tiddler currently scrolled beyond its own top; it
drives the go-to-start button. Maintained by the scroll settle capture, which
also covers positions reached by landmark restores.
*/
function setTopTarget(title) {
	if($tw.wiki.getTiddlerText(TOP_TARGET_TITLE,"") !== title) {
		$tw.wiki.addTiddler(new $tw.Tiddler({title: TOP_TARGET_TITLE,text: title}));
	}
}

function clearTopTarget() {
	if($tw.wiki.tiddlerExists(TOP_TARGET_TITLE)) {
		$tw.wiki.deleteTiddler(TOP_TARGET_TITLE);
	}
}

/*
Record the position within the tiddler currently under the reference line.
Only long tiddlers (frame taller than the viewport) scrolled beyond min-offset
are remembered; otherwise the stored offset is cleared so a later navigation
goes to the top as usual. Frames elsewhere on the page keep their memory.
*/
function recordScrollPosition() {
	var offsetOn = isEnabled(CONFIG_OFFSET_MEMORY),
		draftOn = getOpenDraftTitles().length > 0;
	if(!offsetOn && !draftOn) {
		return;
	}
	var refLine = getToolbarOffset(),
		viewportHeight = window.innerHeight,
		minOffset = getNumberConfig(CONFIG_MIN_OFFSET,100),
		frames = getAllStoryFrames();
	for(var i=0; i<frames.length; i++) {
		var frame = frames[i],
			rect = frame.getBoundingClientRect(),
			title = frame.getAttribute("data-tiddler-title");
		if(rect.top <= refLine && rect.bottom > refLine) {
			var offset = Math.round(refLine - rect.top);
			if(isDraftTitle(title)) {
				// Draft (edit frame): remember position at any depth so the
				// toggle cycle can return you exactly where you were writing.
				// No long-tiddler / min-offset constraint, no top-target.
				if(draftOn && offset > 0) {
					saveDraftOffset(title,offset);
				}
			} else {
				// Not a draft: this is where you are READING. Remembered so a
				// toggle whose only stop is your draft can bring you back here.
				saveReadingPosition(Math.round($tw.utils.getScrollPosition(window).y));
				if(!offsetOn) {
					return;
				}
				if(rect.height > viewportHeight && offset >= minOffset) {
					saveOffset(title,offset);
					// Sticky titles keep the tiddler toolbar visible, so the
					// go-to-start button is redundant there
					if(isEnabled(CONFIG_TOP_BUTTON) && !stickyTitlesActive()) {
						setTopTarget(title);
					} else {
						clearTopTarget();
					}
				} else {
					clearOffset(title);
					clearTopTarget();
				}
			}
			return;
		}
	}
}

function pushLandmark(landmark) {
	var stack = $tw.wiki.getTiddlerData(STACK_TITLE,[]),
		top = stack[stack.length - 1];
	// Re-clicking the same link replaces the top entry instead of stacking duplicates
	if(top && top.from === landmark.from && top["link-offset"] === landmark["link-offset"]) {
		stack.pop();
	}
	stack.push(landmark);
	var limit = getNumberConfig(CONFIG_STACK_LIMIT,50);
	if(stack.length > limit) {
		stack = stack.slice(stack.length - limit);
	}
	$tw.wiki.setTiddlerData(STACK_TITLE,stack,null,{suppressTimestamp: true});
	// A new recording always restarts the walk from the newest entry
	clearCursor();
}

/*
Re-find the clicked link: same navigation target, nearest to the recorded
offset within the frame (a tiddler can link to the same target repeatedly)
*/
function newestLandmarkFor(title,stack) {
	for(var i=stack.length-1; i>=0; i--) {
		if(stack[i].from === title) {
			return stack[i];
		}
	}
	return null;
}

function findLandmarkLink(frame,landmark) {
	var links = frame.querySelectorAll("a.tc-tiddlylink"),
		frameTop = frame.getBoundingClientRect().top,
		best = null,
		bestDistance = Infinity;
	for(var i=0; i<links.length; i++) {
		var href = links[i].getAttribute("href") || "";
		if(href.charAt(0) === "#" && decodeURIComponent(href.substring(1)) === landmark.to) {
			var distance = Math.abs(links[i].getBoundingClientRect().top - frameTop - landmark["link-offset"]);
			if(distance < bestDistance) {
				bestDistance = distance;
				best = links[i];
			}
		}
	}
	return best;
}

/*
Blink the landmark link once the scroll animation has arrived. Plugin-local
copy of the $tw.utils.pulseElement() logic as fixed by #9741, so the blink
also works on cores before 5.5.0, where pulseElement never cleans up its
class. animationend only fires after the last animation iteration, so the
class is removed after the third blink.
*/
function blinkLandmark(frame,landmark) {
	if(!isEnabled(CONFIG_BLINK)) {
		return;
	}
	// Flashing is unwanted under reduced motion; skipping here (instead of
	// animation:none in CSS) keeps the animationend cleanup path intact
	if(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
		return;
	}
	var link = findLandmarkLink(frame,landmark);
	if(!link) {
		return;
	}
	setTimeout(function() {
		var eventName = $tw.utils.convertEventName("animationEnd");
		link.addEventListener(eventName,function handler() {
			link.removeEventListener(eventName,handler,false);
			$tw.utils.removeClass(link,"wltc-scroll-memory-blink");
		},false);
		$tw.utils.removeClass(link,"wltc-scroll-memory-blink");
		$tw.utils.forceLayout(link);
		$tw.utils.addClass(link,"wltc-scroll-memory-blink");
	},$tw.utils.getAnimationDuration() + 50);
}

/*
Scroll so the landmark's click position returns to the viewport Y it had at
click time, then blink the clicked link. PageScroller subtracts the toolbar
offset and re-evaluates these bounds every animation frame, so the scroll
converges even while the layout is still animating (e.g. a closing tiddler
collapsing above)
*/
function scrollToLandmark(frame,landmark) {
	var linkOffset = landmark["link-offset"],
		viewportY = landmark["viewport-y"];
	$tw.pageScroller.scrollIntoView(frame,function() {
		var rect = frame.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top + linkOffset - viewportY + getToolbarOffset(),
			width: rect.width,
			height: rect.height
		};
	});
	blinkLandmark(frame,landmark);
}

/*
Reopen a closed source tiddler at the top of the story river, wait for its
frame to render, then scroll to the landmark. The story write is a plain
navigation-free open, so the landmark scroll is the only scroll. The
suppress flag stops the landmark-on-open handling from scrolling a second
time for this same open.
*/
var suppressLandmarkOnOpen = null;

function reopenThenScroll(landmark) {
	var story = $tw.wiki.getTiddlerList(STORY_LIST_TITLE);
	if(story.indexOf(landmark.from) === -1) {
		suppressLandmarkOnOpen = landmark.from;
		story.unshift(landmark.from);
		$tw.wiki.addTiddler(new $tw.Tiddler($tw.wiki.getTiddler(STORY_LIST_TITLE),{title: STORY_LIST_TITLE,list: story}));
	}
	var attempts = 10,
		tryScroll = function() {
			var frame = findFrame(landmark.from);
			if(frame) {
				scrollToLandmark(frame,landmark);
			} else if(attempts-- > 0) {
				setTimeout(tryScroll,100);
			}
		};
	setTimeout(tryScroll,50);
}

/*
Default mode: pop the newest landmark and return to it (consumed on use),
reopening its source tiddler when it has been closed
*/
function scrollBack() {
	var stack = $tw.wiki.getTiddlerData(STACK_TITLE,[]);
	if(stack.length === 0) {
		return;
	}
	var landmark = stack.pop();
	$tw.wiki.setTiddlerData(STACK_TITLE,stack,null,{suppressTimestamp: true});
	var frame = findFrame(landmark.from);
	if(frame) {
		scrollToLandmark(frame,landmark);
	} else {
		reopenThenScroll(landmark);
	}
}

/*
Always-active mode: walk the recorded history without consuming it.
direction -1 steps towards older entries, +1 towards newer. Landing on
either end shows a notification; the next step in the same direction wraps
around, so back at the first entry jumps to the newest recorded position.
A landmark whose source tiddler has been closed reopens it.
*/
function historyStep(direction) {
	var stack = $tw.wiki.getTiddlerData(STACK_TITLE,[]);
	if(stack.length === 0) {
		return;
	}
	var step = function(index) {
			if(direction < 0) {
				return index <= 0 ? stack.length - 1 : index - 1;
			}
			return index >= stack.length - 1 ? 0 : index + 1;
		},
		next = step(getCursor(stack.length)),
		landmark = stack[next],
		frame = findFrame(landmark.from);
	setCursor(next);
	if(frame) {
		scrollToLandmark(frame,landmark);
	} else {
		reopenThenScroll(landmark);
	}
	// Announce only the end of the walk direction: silently landing on the
	// newest entry with the first back step is not worth a notification
	if(direction < 0 && next === 0) {
		$tw.notifier.display(NOTIFY_FIRST);
	} else if(direction > 0 && next === stack.length - 1) {
		$tw.notifier.display(NOTIFY_LAST);
	}
}

/*
Scroll an open draft so the remembered writing position returns under the
reference line. No blink: a draft is not a landmark. Mirrors the offset-memory
restore used for view frames.
*/
function scrollToDraft(frame,title) {
	var offset = getDraftOffset(title);
	$tw.pageScroller.scrollIntoView(frame,function() {
		var rect = frame.getBoundingClientRect();
		return {
			left: rect.left,
			top: rect.top + offset,
			width: rect.width,
			height: rect.height
		};
	});
}

/*
Toggle mode replaces the consume-back button: permanently when config use-toggle
is set, and always while at least one draft is open. Step through
the cycle {each open draft in story order, then the last landmark} one slot per
click, wrapping. Never consumes the landmark and never closes anything, so you
can bounce between the source you are reading and the drafts you are writing.
Toggling to a draft restores your remembered writing position; toggling to the
landmark reopens its source tiddler if it was closed and blinks the clicked
link.
*/
function buildToggleCycle() {
	var stack = $tw.wiki.getTiddlerData(STACK_TITLE,[]),
		lastLandmark = stack.length ? stack[stack.length - 1] : null,
		drafts = getOpenDraftTitles(),
		cycle = [];
	for(var d=0; d<drafts.length; d++) {
		cycle.push({kind: "draft",title: drafts[d]});
	}
	if(lastLandmark) {
		cycle.push({kind: "landmark",landmark: lastLandmark});
	}
	return cycle;
}

// The story title a slot scrolls to. For a landmark that is its source
// tiddler, which is the frame you end up looking at.
function toggleSlotTitle(slot) {
	return slot.kind === "draft" ? slot.title : slot.landmark.from;
}

/*
The document scroll position a stop would take you to, clamped to what the
page can actually reach. The last tiddler in the story can never be brought to
the reference line, because the page runs out of scroll first, so every
"where am I" and "can this click move me" question is answered by comparing
clamped targets rather than frame positions.
*/
function toggleSlotTargetY(slot) {
	var frame = findAnyFrame(toggleSlotTitle(slot));
	if(!frame) {
		return null;
	}
	var rect = frame.getBoundingClientRect(),
		scrollY = $tw.utils.getScrollPosition(window).y,
		target;
	if(slot.kind === "landmark") {
		target = rect.top + scrollY + slot.landmark["link-offset"] - slot.landmark["viewport-y"];
	} else {
		target = rect.top + scrollY + getDraftOffset(slot.title) - getToolbarOffset();
	}
	return Math.min(Math.max(Math.round(target),0),
		Math.max(0,document.documentElement.scrollHeight - window.innerHeight));
}

/*
Which slot the reader is on: the one whose target is where we already are.
Derived on every click rather than kept in a stored index, because the cycle
is rebuilt each time and opening or closing a draft shifts every index in it.
Returns -1 when the reader is somewhere else, so the next step is the first
stop.
*/
function currentToggleIndex(cycle,here) {
	for(var c=0; c<cycle.length; c++) {
		var target = toggleSlotTargetY(cycle[c]);
		if(target !== null && Math.abs(target - here) <= 4) {
			return c;
		}
	}
	return -1;
}

// Scroll to one slot. Returns false when the slot turned out to be
// unreachable, so the caller can try the next one instead of wasting the click.
function gotoToggleSlot(slot) {
	if(slot.kind === "landmark") {
		var frame = findFrame(slot.landmark.from);
		if(frame) {
			scrollToLandmark(frame,slot.landmark);
		} else {
			// blinks via scrollToLandmark once the reopened frame renders
			reopenThenScroll(slot.landmark);
		}
		return true;
	}
	var draftFrame = findAnyFrame(slot.title);
	if(!draftFrame) {
		return false;
	}
	scrollToDraft(draftFrame,slot.title);
	return true;
}

/*
The position to come back to when the cycle has only one stop. Without it a
one-stop cycle is a dead button: the first click takes you to the stop, and
every click after that re-scrolls to where you already are. Cleared as soon as
the cycle has two stops of its own.
*/
/*
The last place you were reading: the scroll position while a non-draft frame
sat under the reference line. This is the other half of the toggle when your
only stop is a draft you are already standing in.
*/
function saveReadingPosition(y) {
	var existing = $tw.wiki.getTiddlerText(READING_POSITION_TITLE,"");
	if(existing !== String(y)) {
		$tw.wiki.addTiddler(new $tw.Tiddler({title: READING_POSITION_TITLE,text: String(y)}));
	}
}

function getReadingPosition() {
	var value = parseInt($tw.wiki.getTiddlerText(READING_POSITION_TITLE,""),10);
	return isNaN(value) ? null : value;
}

function getToggleReturn() {
	var value = parseInt($tw.wiki.getTiddlerText(TOGGLE_RETURN_TITLE,""),10);
	return isNaN(value) ? null : value;
}

function setToggleReturn(y) {
	$tw.wiki.addTiddler(new $tw.Tiddler({title: TOGGLE_RETURN_TITLE,text: String(y)}));
}

function clearToggleReturn() {
	if($tw.wiki.tiddlerExists(TOGGLE_RETURN_TITLE)) {
		$tw.wiki.deleteTiddler(TOGGLE_RETURN_TITLE);
	}
}

// Scroll to an absolute document position, animated like every other jump.
// PageScroller re-reads the callback each frame and turns client bounds into a
// document position, so the callback undoes that conversion.
function scrollToDocumentY(y) {
	$tw.pageScroller.scrollIntoView(null,function() {
		return {
			left: 0,
			top: y - $tw.utils.getScrollPosition(window).y + getToolbarOffset(),
			width: 0,
			height: 0
		};
	});
}

function toggleCycle() {
	var cycle = buildToggleCycle();
	if(cycle.length === 0) {
		return;
	}
	var here = Math.round($tw.utils.getScrollPosition(window).y),
		start = currentToggleIndex(cycle,here);
	// One stop is not a toggle by itself, so pair it with the position you
	// jumped from: out on the first click, back on the second.
	if(cycle.length === 1) {
		if(start === 0) {
			// Standing on the only stop, so the other half of the toggle is
			// the place you came from, or failing that where you last read
			var back = getToggleReturn();
			if(back === null) {
				back = getReadingPosition();
			}
			clearToggleReturn();
			if(back !== null && Math.abs(back - here) > 4) {
				scrollToDocumentY(back);
			}
			return;
		}
		if(gotoToggleSlot(cycle[0])) {
			setToggleReturn(here);
		}
		return;
	}
	// Walk forward from where the reader actually is until a slot accepts the
	// jump. A stop that would land on the position we are already at cannot
	// move anything, so skip it rather than let it swallow the click.
	clearToggleReturn();
	for(var step=1; step<=cycle.length; step++) {
		var slot = cycle[(start + step + cycle.length) % cycle.length],
			target = toggleSlotTargetY(slot);
		if(target !== null && Math.abs(target - here) <= 4) {
			continue;
		}
		if(gotoToggleSlot(slot)) {
			return;
		}
	}
}

exports.startup = function() {
	// Capture: remember the position within the long tiddler under the reference line
	var settleTimer = null;
	window.addEventListener("scroll",function() {
		if(settleTimer) {
			clearTimeout(settleTimer);
		}
		settleTimer = setTimeout(recordScrollPosition,SCROLL_SETTLE_INTERVAL);
	},{passive: true});
	// Capture: record a click landmark when a link navigates out of a long tiddler
	$tw.hooks.addHook("th-navigating",function(event) {
		if(isEnabled(CONFIG_LANDMARKS) && event.navigateTo && event.navigateFromTitle &&
				event.navigateFromClientRect && !event.navigateSuppressNavigation) {
			var frame = findFrame(event.navigateFromTitle);
			if(frame) {
				var frameRect = frame.getBoundingClientRect();
				if(isAlwaysActive() || frameRect.height > window.innerHeight) {
					pushLandmark({
						from: event.navigateFromTitle,
						to: event.navigateTo,
						"link-offset": Math.round(event.navigateFromClientRect.top - frameRect.top),
						"viewport-y": Math.round(event.navigateFromClientRect.top)
					});
				}
			}
		}
		return event;
	});
	// Restore: wrap the root tm-scroll handler installed by the rootwidget startup
	// (widget event listeners are one-per-message, so this replaces it) and divert
	// navigations to tiddlers with a remembered offset; everything else falls
	// through to the core PageScroller unchanged
	$tw.rootWidget.addEventListener("tm-scroll",function(event) {
		var target = event.target;
		if(isEnabled(CONFIG_OFFSET_MEMORY) && target && target.getAttribute &&
				!(event.paramObject && event.paramObject.selector) &&
				target.classList && target.classList.contains("tc-tiddler-view-frame")) {
			var title = target.getAttribute("data-tiddler-title"),
				offset = title ? getOffset(title) : 0;
			if(offset) {
				$tw.pageScroller.scrollIntoView(target,function() {
					var rect = target.getBoundingClientRect();
					return {
						left: rect.left,
						top: rect.top + offset,
						width: rect.width,
						height: rect.height
					};
				});
				return false;
			}
		}
		return $tw.pageScroller.handleEvent(event);
	});
	// Back and forward buttons
	$tw.rootWidget.addEventListener("tm-scroll-memory-back",function(event) {
		if(isAlwaysActive()) {
			historyStep(-1);
		} else {
			scrollBack();
		}
		return false;
	});
	$tw.rootWidget.addEventListener("tm-scroll-memory-forward",function(event) {
		if(isAlwaysActive()) {
			historyStep(1);
		}
		return false;
	});
	// Toggle button (replaces the consume-back button while a draft is open, or
	// permanently when use-toggle is on): step through the open-drafts +
	// last-landmark cycle without consuming
	$tw.rootWidget.addEventListener("tm-scroll-memory-toggle",function(event) {
		toggleCycle();
		return false;
	});
	// Get-to-top button: scroll the current long tiddler to its top.
	// Calls the PageScroller directly, so a remembered offset cannot divert it
	$tw.rootWidget.addEventListener("tm-scroll-memory-top",function(event) {
		var title = $tw.wiki.getTiddlerText(TOP_TARGET_TITLE,""),
			frame = title && findFrame(title);
		clearTopTarget();
		if(frame) {
			$tw.pageScroller.scrollIntoView(frame,null,{});
		}
		return false;
	});
	// Story changes: landmark scroll for reopened tiddlers, stale offset
	// cleanup, and auto-restore when the tiddler a landmark navigated to is
	// closed. This listener registers after the render startup's refresh
	// listener, so the DOM is already updated when it runs; a landmark scroll
	// started here replaces the in-flight scroll-to-top of a new frame.
	var lastStory = $tw.wiki.getTiddlerList(STORY_LIST_TITLE),
		lastDraftMap = buildDraftMap(lastStory);
	$tw.wiki.addEventListener("change",function(changes) {
		if(!changes[STORY_LIST_TITLE]) {
			return;
		}
		var story = $tw.wiki.getTiddlerList(STORY_LIST_TITLE),
			previousStory = lastStory,
			prevDraftMap = lastDraftMap,
			newDraftMap = buildDraftMap(story),
			removed = previousStory.filter(function(title) {
				return story.indexOf(title) === -1;
			}),
			added = story.filter(function(title) {
				return previousStory.indexOf(title) === -1;
			}),
			stack = $tw.wiki.getTiddlerData(STACK_TITLE,[]);
		// Edit-in-place is not a close/open. When a tiddler X is edited, X
		// leaves the story and its `Draft of 'X'` enters; on save/cancel the
		// draft leaves and X returns. Neither transition should fire a landmark
		// restore. Collect the underlying titles on both sides so the close /
		// open logic below can skip them.
		var editOpenUnderlying = Object.create(null), // X currently being edited
			draftClosedUnderlying = Object.create(null); // X returning from a saved/cancelled draft
		// Every title with a draft in the story right now, not merely the ones
		// whose draft just appeared: editing a tiddler whose draft was already
		// open re-inserts that draft, so `added` comes back empty and the
		// vanishing view frame would otherwise read as a real close.
		Object.keys(newDraftMap).forEach(function(draftTitle) {
			editOpenUnderlying[newDraftMap[draftTitle]] = true;
		});
		removed.forEach(function(title) {
			var of = prevDraftMap[title];
			if(of) { draftClosedUnderlying[of] = true; clearDraftOffset(title); }
		});
		lastStory = story;
		lastDraftMap = newDraftMap;
		// A tiddler that recorded a landmark and was reopened returns to the
		// landmark instead of its top. Skip drafts (never landmark sources) and
		// skip a tiddler that merely returned from its own saved draft (stay put).
		if(added.length && isEnabled(CONFIG_LANDMARK_ON_OPEN)) {
			for(var i=0; i<added.length; i++) {
				if(added[i] === suppressLandmarkOnOpen) {
					continue;
				}
				if(isDraftTitle(added[i]) || draftClosedUnderlying[added[i]]) {
					continue;
				}
				var openLandmark = newestLandmarkFor(added[i],stack),
					openFrame = openLandmark && findFrame(added[i]);
				if(openFrame) {
					scrollToLandmark(openFrame,openLandmark);
					break;
				}
			}
		}
		if(added.length) {
			suppressLandmarkOnOpen = null;
		}
		if(removed.length === 0) {
			return;
		}
		// A title that only went into edit mode (its draft opened) is not closed:
		// keep its offset and exclude it from the auto-restore close detection.
		$tw.utils.each(removed,function(title) {
			if(!editOpenUnderlying[title]) {
				clearOffset(title);
			}
		});
		if(removed.indexOf($tw.wiki.getTiddlerText(TOP_TARGET_TITLE,"")) !== -1) {
			clearTopTarget();
		}
		if(!isEnabled(CONFIG_AUTO_RESTORE)) {
			return;
		}
		var realRemoved = removed.filter(function(title) {
			return !editOpenUnderlying[title];
		});
		if(realRemoved.length !== 1) {
			return;
		}
		if(isAlwaysActive()) {
			// Jump to the newest landmark that navigated to the closed tiddler,
			// keeping it in the history
			for(var j=stack.length-1; j>=0; j--) {
				if(stack[j].to === realRemoved[0]) {
					setCursor(j);
					var closeFrame = findFrame(stack[j].from);
					if(closeFrame) {
						scrollToLandmark(closeFrame,stack[j]);
					} else {
						reopenThenScroll(stack[j]);
					}
					break;
				}
			}
		} else {
			var top = stack[stack.length - 1];
			if(top && top.to === realRemoved[0]) {
				scrollBack();
			}
		}
	});
};
