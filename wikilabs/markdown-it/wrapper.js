/*\
title: $:/plugins/wikilabs/markdown-it/wrapper.js
type: application/javascript
module-type: parser

Wraps up the markdown-js parser for use in TiddlyWiki5

\*/

// Spec overview: https://www.iana.org/assignments/media-types/media-types.xhtml,
// MD spec: https://tools.ietf.org/html/rfc7763
// variants overvewi: https://www.iana.org/assignments/markdown-variants/markdown-variants.xhtml
// variants: https://tools.ietf.org/html/rfc7764

(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var CONFIG_VARIANT_TIDDLER = "$:/config/markdown/variant",
	DEFAULT_VARIANT = "markdown-it";

/*
The wiki text parser processes blocks of source text into a parse tree.

The parse tree is made up of nested arrays of these JavaScript objects:

	{type: "element", tag: <string>, attributes: {}, children: []} - an HTML element
	{type: "text", text: <string>} - a text node
	{type: "entity", value: <string>} - an entity
	{type: "raw", html: <string>} - raw HTML

Attributes are stored as hashmaps of the following objects:

	{type: "string", value: <string>} - literal string
	{type: "indirect", textReference: <textReference>} - indirect through a text reference
	{type: "macro", macro: <TBD>} - indirect through a macro invocation

*/


var MarkdownParser = function(type,text,options) {
	var variant = options.wiki.getTiddlerText(CONFIG_VARIANT_TIDDLER,DEFAULT_VARIANT),
		preset = "",
		twOptions = {};

	switch (variant) {
		case "gfm":
			preset = "default",
			twOptions = {
				breaks: true	// Convert '\n' in paragraphs into <br>
			}
		break;
		case "markdown-it":
			preset = "default";
		break;
		case "commonmark":
			preset = "commonmark";
			// this is a "strict" library preset. No special options needed.
		break;
		case "zero":
			preset = "zero";
		break;
	  	case "default":
	  	default: // fallthrough is intentional
			preset = "default",
			twOptions = {
	//			breaks: true	//TODO TW ControlPanel setting. 
			}
		break;
	}
	
	// additional options, which don't touch compatibility between variants!
	twOptions.linkify     = false;		// TODO create an option for this. 
	twOptions.typographer = true;		// TODO create an option for this. 

	var markdown = require("$:/plugins/wikilabs/markdown-it/markdown-it-min.js")(preset, twOptions);
	var element = {
			type: "raw",
			html: markdown.render(text)
		};
	this.tree = [element];
};

exports["text/x-markdown"] = MarkdownParser;

// "text/x-markdown;variant=commonmark"  should be possible too
// "text/x-markdown;variant=commonmark;plugin=xxx"  should be possible too

})();

