/*\
title: $:/plugins/wikilabs/markdown-it/wrapper.js
type: application/javascript
module-type: parser

Wraps up the markdown-js parser for use in TiddlyWiki5

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

var CONFIG_DIALECT_TIDDLER = "$:/config/markdown/dialect",
	DEFAULT_DIALECT = "markdown-it";

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
	var dialect = options.wiki.getTiddlerText(CONFIG_DIALECT_TIDDLER,DEFAULT_DIALECT) || "gfm",
		preset = "",
		twOptions = {};

	switch (dialect) {
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
	
	// additional options, which don't touch compatibility between dialects!
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

// "text/x-markdown;flavour=commonmark"  should be possible too
// "text/x-markdown;flavour=commonmark;plugin=xxx"  should be possible too

})();

