/*\
title: $:/plugins/wikilabs/uuid7/fieldtype-c32.js
type: application/javascript
module-type: tiddlerfield

Tiddler field type: c32
=======================
Registers the "c32" field as a tiddler field type.
The c32 field stores a Crockford Base32 encoded UUID v7 string
in 6-4-12-4 format (parse/stringify are identity).

\*/

"use strict";

exports.name = "c32";
