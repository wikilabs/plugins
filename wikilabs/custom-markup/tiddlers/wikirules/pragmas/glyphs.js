/*\
title: $:/plugins/wikilabs/custom-markup/wikirules/glyphs.js
type: application/javascript
module-type: glyphs

Glyph base class

\*/
(function(){

	/*jslint node: true, browser: true */
	/*global $tw: false */
	"use strict";
	
	/*
	docs
	*/
	var Glyphs = function() {
		// this.freeGlyphs = [
		// 	{
		// 		idType: "poem",
		// 		glyph: "GEDICHT",
		// 		useParagraph: true
		// 	},
		// 	{
		// 		idType: "note",
		// 		glyph: "ANMERKUNG",
		// 		useParagraph: true
		// 	}
		// ]

		this.initialise();
	};
	
	/*
	Initialise glyphs
	*/
	Glyphs.prototype.initialise = function() {
		var results = [];

		this.defaultGlyphs = $tw.wiki.getTiddlerDataCached("$:/config/WLCM/lineGlyphs/default",[])

		$tw.wiki.getTiddlerDataCached("$:/config/WLCM/lineGlyphs/free",[]).map(function(element) {
			if (element.glyph !== ".") results.push(element)
		})
		this.freeGlyphs = results;
	};

	exports.glyphs = Glyphs;

	})();
