/*\
title: $:/plugins/wikilabs/space-space-newline/ssnl.js
type: application/javascript
module-type: wikirule

Wiki text inline rule for <space><space><new-line> example:

```
	There are 2 spaces and 1 linebreak at the end of this line
	So we should see 2 lines
```

```
	There are 2 spaces and a backslash at the end of this line  \
	So we should see 2 lines
```

This wikiparser can be modified using the rules eg:

```
\rules except ssnl
\rules only ssnl
```

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false exports:false */
"use strict";

exports.name = "ssnl";
exports.types = {inline: true};

exports.init = function(parser) {
	this.parser = parser;
	// Regexp to match
	this.matchRegExp = /([ ]{2}|  \\)$/mg;
};

exports.parse = function() {
	// Move past the match
	this.parser.pos = this.matchRegExp.lastIndex;
	// Parse the run including the terminator
	var tree = this.parser.parseInlineRun(/\r?\n/mg,{eatTerminator: true});

	return [{
		type: "element",
		tag: "br",
		children: tree
	}];
};

})();
