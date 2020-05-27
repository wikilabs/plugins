/*\
title: $:/plugins/wikilabs/uni-link/relinkoperations/text/wikitext/unilink.js
type: application/javascript
module-type: relinkwikitextrule

Handles replacement in wiki text inline rules, like,

[[Introduction]]

[[link description|TiddlerTitle]]

\*/

// var prettylink = require('$:/plugins/flibbles/relink/js/relinkoperations/text/wikitext/prettylink.js');

exports.name = "unilink";
exports.relink = require('$:/plugins/flibbles/relink/js/relinkoperations/text/wikitext/prettylink.js').relink;
