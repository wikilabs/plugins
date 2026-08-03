/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/markdown-flavour/backslash-escapes.js
type: application/javascript
module-type: wikirule

CommonMark backslash escapes: `\X` where X is one of the 30 ASCII
punctuation characters renders as the literal X (the leading backslash
is consumed). Lets authors write `\*literal asterisks\*` without
triggering the italic marker, `` \` `` without a code span, `\[` without
a linked-pair, etc. Backslash followed by anything other than ASCII
punctuation is left alone (CommonMark spec: `\A` stays `\A`).

Fires when any active vocab opts in via `backslash-escapes: yes`.
vocab/markdown does. The rule only fires at inline positions, so source
captured raw — fenced code blocks, code spans (`body-raw: yes`),
linked-pair `body-attribute` strings — is unaffected: backslashes inside
those bodies stay literal.

\*/

"use strict";

exports.name = "markdown-backslash-escapes";
exports.types = {inline: true};

// CommonMark Section 6.1 escapable characters:
//   ! " # $ % & ' ( ) * + , - . / : ; < = > ? @ [ \ ] ^ _ ` { | } ~
var ESCAPE_RE = /\\([!"#$%&'()*+,\-./:;<=>?@\[\\\]^_`{|}~])/g;

exports.init = function(parser) {
	this.parser = parser;
	this.matchRegExp = ESCAPE_RE;
	$tw.utils.CmRegistry.ensureRegistry(parser);
};

exports.findNextMatch = function(startPos) {
	if(!this.parser.cmRegistry || !this.parser.cmRegistry.hasVocabFlag("backslash-escapes")) {
		return undefined;
	}
	this.matchRegExp.lastIndex = startPos;
	this.match = this.matchRegExp.exec(this.parser.source);
	return this.match ? this.match.index : undefined;
};

exports.parse = function() {
	this.parser.pos = this.match.index + this.match[0].length;
	return [{type: "text", text: this.match[1]}];
};
