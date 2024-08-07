/*\
title: $:/plugins/wikilabs/uni-link/relinkoperations/text/wikitext/unilink.js
type: application/javascript
module-type: relinkwikitextrule

Handles replacement in wiki text inline rules, like,

[[Introduction]]

[[link description|TiddlerTitle]]

\*/

"use strict";

var prettylink = require('$:/plugins/flibbles/relink/js/relinkoperations/text/wikitext/prettylink.js');

function Unilink() {}

Unilink.prototype = prettylink;

module.exports = new Unilink();
module.exports.name = "unilink";

module.exports.relink = function(text_or_tiddler, fromTitle, toTitle, options) {
    // Check that this version of Relink supports [object] return.
    if (typeof text_or_tiddler === "string") {
        if (this.match[3] == "?") {
            this.parser.pos = this.matchRegExp.lastIndex;
            // Ignore this unilink. The link portion has a "?", so it's an alias.
            return undefined;
        }
        if (this.match[1] === fromTitle && this.match[2] === "|" && !this.match[3] && !this.match[4]) {
            this.parser.pos = this.matchRegExp.lastIndex;
            return { name: "unilink", impossible: true};
        }
    }
    // The underlying prettylink rule expects everything after the "|" to
    // be the link. We'll just swap it in from the 4th position before we
    // apply prettylink relinking.
    this.match[2] = this.match[4];
    return prettylink.relink.apply(this, arguments);
};
