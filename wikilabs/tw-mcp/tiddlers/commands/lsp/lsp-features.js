/*\
title: $:/core/modules/commands/inspect/lsp/lsp-features.js
type: application/javascript
module-type: library

The wiki-facing half of the LSP server, gathered into one import for lsp-lib.js.
Each feature lives in its own module, split by what it can rely on:

	lsp-source.js      offsets, .tid headers, parse tree walking
	lsp-links.js       link diagnostics, hand-scanned (see the note in that file)
	lsp-completion.js  title completion, necessarily hand-scanned
	lsp-filters.js     filter hover, parser-driven with a scanner fallback

Everything here is a pure function of a document's text plus the booted
$tw.wiki. Transport and protocol live in lsp-lib.js.

\*/

"use strict";

var links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js"),
	completion = require("$:/core/modules/commands/inspect/lsp/lsp-completion.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	definition = require("$:/core/modules/commands/inspect/lsp/lsp-definition.js"),
	source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js");

exports.diagnostics = links.diagnostics;
exports.completions = completion.completions;
exports.hover = filters.hover;
exports.definition = definition.definition;

// Test seams. Each is a pure function worth pinning without a document or a
// transport to reach it.
exports.bodyStartLine = source.bodyStartLine;
exports.scanLinks = links.scanLinks;
exports.titleOfTarget = links.titleOfTarget;
exports.linkContext = completion.linkContext;
exports.filterContext = filters.filterContext;
exports.bracketsBalanced = filters.bracketsBalanced;
exports.targetAt = definition.targetAt;
exports.pathToUri = definition.pathToUri;
