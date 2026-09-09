/*\
title: $:/core/modules/commands/inspect/lsp/lsp-completion.js
type: application/javascript
module-type: library

Tiddler title completion inside [[...]] and {{...}}.

This one cannot use the parser, and that is not a compromise: at the moment
completion is asked for, the text reads "[[LSP Ser" with no closing bracket, and
TiddlyWiki parses that as a single text node. Incomplete input is the whole
point of completion, so the cursor context is read from the raw line.

\*/

"use strict";

// Cap on one response. A wiki of any size would otherwise send its whole title
// list on the first "[[".
var MAX_COMPLETIONS = 200;

// Shortest prefix worth answering. A single character matches too much of any
// real wiki to be a useful list.
var MIN_PREFIX = 2;

var KIND_REFERENCE = 18;

// A tiddler title separates its words with more than spaces: lsp_link_target
// and $:/core/ui/PageTemplate are each several words to a reader.
var WORD_SEPARATORS = /[\s_\-/:.]+/;

// What the cursor sits inside, or null when it is not inside an open link.
// Only an UNCLOSED opener counts, so a cursor after a finished [[link]] gets
// nothing rather than the whole title list.
function linkContext(lineText, character) {
	var upto = lineText.slice(0, character),
		link = upto.lastIndexOf("[["),
		trans = upto.lastIndexOf("{{");
	var opener = Math.max(link, trans);
	if(opener < 0) {
		return null;
	}
	var isLink = link > trans;
	var closer = isLink ? "]]" : "}}";
	if(upto.indexOf(closer, opener + 2) >= 0) {
		return null;
	}
	// A filtered transclusion is a filter, not a title. lastIndexOf lands on the
	// SECOND brace of "{{{", so the third is looked for on either side.
	if(!isLink && (upto.charAt(opener + 2) === "{" || upto.charAt(opener - 1) === "{")) {
		return null;
	}
	var start = opener + 2,
		typed = upto.slice(start);
	var pipe = typed.lastIndexOf("|");
	if(pipe >= 0) {
		start = start + pipe + 1;
		typed = typed.slice(pipe + 1);
	}
	// Past a !! the user is naming a field, which this does not complete.
	if(typed.includes("!!") || typed.includes("##")) {
		return null;
	}
	return { start: start, prefix: typed };
}

// System titles stay out of the way until the prefix asks for them, matching
// how the MCP tools treat $:/ by default.
function candidateTitles(prefix) {
	if(prefix.startsWith("$:/")) {
		return $tw.wiki.filterTiddlers("[all[shadows+tiddlers]]");
	}
	return $tw.wiki.filterTiddlers("[!is[system]!has[draft.of]]");
}

// Matching is by PREFIX, never by substring: typing "ink" must not offer
// lsp_link_target, because nobody looks for a title by its middle.
function anyWordStartsWith(lower, term) {
	if(lower.startsWith(term)) {
		return true;
	}
	var words = lower.split(WORD_SEPARATORS);
	for(var i = 0; i < words.length; i++) {
		if(words[i].startsWith(term)) {
			return true;
		}
	}
	return false;
}

function matchesEveryTerm(lower, terms) {
	for(var i = 0; i < terms.length; i++) {
		if(!anyWordStartsWith(lower, terms[i])) {
			return false;
		}
	}
	return true;
}

// A title opening with everything typed ranks above one merely beginning those
// words elsewhere, so "LS S" reaches "LSP Server" without displacing a closer
// match, and "LS " keeps its list because a space starts the next word.
function rankTitles(titles, prefix) {
	var needle = prefix.toLowerCase(),
		terms = needle.split(/\s+/).filter(function(t) { return t; }),
		starts = [],
		wordwise = [];
	for(var i = 0; i < titles.length; i++) {
		var lower = titles[i].toLowerCase();
		if(lower.startsWith(needle)) {
			starts.push(titles[i]);
		} else if(terms.length && matchesEveryTerm(lower, terms)) {
			wordwise.push(titles[i]);
		}
	}
	return starts.concat(wordwise);
}

function completions(uri, text, position) {
	var lines = text.split(/\r?\n/),
		lineText = lines[position.line] || "",
		context = linkContext(lineText, position.character);
	if(!context) {
		return { isIncomplete: false, items: [] };
	}
	// Reported as incomplete rather than complete, so the editor asks again on
	// the next keystroke instead of caching this emptiness.
	if(context.prefix.replace(/\s+/g, "").length < MIN_PREFIX) {
		return { isIncomplete: true, items: [] };
	}
	var ranked = rankTitles(candidateTitles(context.prefix), context.prefix),
		limit = Math.min(ranked.length, MAX_COMPLETIONS),
		items = [];
	var range = {
		start: { line: position.line, character: context.start },
		end: { line: position.line, character: position.character }
	};
	// What the editor considers the word being completed: the same span the edit
	// replaces. Every item claims exactly this as its filter text.
	var typed = lineText.slice(context.start, position.character);
	for(var i = 0; i < limit; i++) {
		var title = ranked[i],
			tiddler = $tw.wiki.getTiddler(title);
		items.push({
			label: title,
			kind: KIND_REFERENCE,
			// The server has already decided which titles match, so the editor
			// must not decide again. Its matching stops at the space in a title
			// and silently drops most of the list; handing every item the text
			// the user typed makes each an exact match, and sortText carries the
			// ranking chosen above.
			filterText: typed,
			sortText: ("0000" + i).slice(-4),
			textEdit: { range: range, newText: title },
			detail: tiddler && tiddler.fields.type ? tiddler.fields.type : undefined
		});
	}
	// Always incomplete, even when the whole list fits. A complete list lets the
	// client cache it and filter locally, and local filtering breaks on the
	// space in a title: the editor treats it as the end of a word and stops
	// asking. Incomplete makes every keystroke a fresh question to the wiki.
	return { isIncomplete: true, items: items };
}

exports.completions = completions;
exports.linkContext = linkContext;
