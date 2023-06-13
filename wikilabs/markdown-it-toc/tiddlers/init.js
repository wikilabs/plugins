/*\
title: $:/plugins/wikilabs/markdown-it/markdown-it-toc/init.js
type: application/javascript
module-type: startup

\*/

/*jslint node: true, browser: true */
/*global $tw: false, exports: true */
"use strict";

// Export name and synchronous status
exports.after = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	var plugin1 = require("$:/plugins/wikilabs/markdown-it/markdown-it-toc.js");

	var md = $tw.Wiki.parsers["text/markdown"].prototype.md;

	md.use(plugin1);
};