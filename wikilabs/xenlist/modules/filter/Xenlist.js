/*\
title: $:/core/modules/filters/Xenlist.js
type: application/javascript
module-type: filteroperator

Filter operator returning its operand parsed as a list

\*/
(function(){

	/*jslint node: true, browser: true */
	/*global $tw: false, exports: false */
	"use strict";
	
	/*
	Export our filter function
	*/
	exports.xenlist = function(source,operator,options) {
		var allowDuplicates = false,
			useFilterArray = false,
			mode = "filter"; // default - detect filter string elements
		var list = [];
		
		switch(operator.suffix) {
			case "raw":
				allowDuplicates = true;
				break;
			case "dedupe":
				allowDuplicates = false;
				break;
			case "array":
				allowDuplicates = true;
				useFilterArray = true;
				break;
			case "stringify":
				allowDuplicates = true;
				useFilterArray = true;
				mode = "stringify";
				break;
		}
		var x = $tw.utils.parseFilterArray;
		list = (useFilterArray) ? x(operator.operand,allowDuplicates,mode) : $tw.utils.parseStringArray(operator.operand,allowDuplicates);
		if(operator.prefix === "!") {
			var results = [];
			source(function(tiddler,title) {
				if(list.indexOf(title) === -1) {
					results.push(title);
				}
			});
			return results;
		} else {
			return list;
		}
	};
	
	})();
	