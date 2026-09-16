/*\
title: $:/core/modules/commands/inspect/lsp/lsp-features.js
type: application/javascript
module-type: library

The wiki-facing half of the LSP server, gathered into one import for lsp-lib.js.
Each feature lives in its own module, split by what it can rely on:

	lsp-source.js      offsets, .tid headers, parse tree walking
	lsp-links.js       link diagnostics, hand-scanned (see the note in that file)
	lsp-names.js       hints for calls whose name nothing in the wiki defines
	lsp-completion.js  title and name completion, necessarily hand-scanned
	lsp-typing.js      the call or filter being typed, before it parses
	lsp-signature.js   the parameter list of the call being typed
	lsp-reload.js      a .tid saved in the editor, read into the running wiki
	lsp-inlay.js       the parameter each positional argument binds to
	lsp-rename.js      rename a definition or a parameter, across files
	lsp-filters.js     filter hover, parser-driven with a scanner fallback
	lsp-pragmas.js     hover on pragma keywords, definition names and parameters
	lsp-files.js       call sites of every document the editor can open
	lsp-references.js  find references, over tw-mcp-core's calls.js
	lsp-definition.js  go to definition, for links and calls
	lsp-symbols.js     the outline: definitions, then headings
	lsp-highlight.js   the name under the cursor, lit where it means the same
	lsp-folding.js     fold arrows for definitions, clauses, widgets, comments
	lsp-scope.js       what binds a name at a position

Everything here is a pure function of a document's text plus the booted
$tw.wiki. Transport and protocol live in lsp-lib.js.

\*/

"use strict";

var links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js"),
	completion = require("$:/core/modules/commands/inspect/lsp/lsp-completion.js"),
	filters = require("$:/core/modules/commands/inspect/lsp/lsp-filters.js"),
	definition = require("$:/core/modules/commands/inspect/lsp/lsp-definition.js"),
	macros = require("$:/core/modules/commands/inspect/lsp/lsp-macros.js"),
	widgets = require("$:/core/modules/commands/inspect/lsp/lsp-widgets.js"),
	references = require("$:/core/modules/commands/inspect/lsp/lsp-references.js"),
	symbols = require("$:/core/modules/commands/inspect/lsp/lsp-symbols.js"),
	highlight = require("$:/core/modules/commands/inspect/lsp/lsp-highlight.js"),
	folding = require("$:/core/modules/commands/inspect/lsp/lsp-folding.js"),
	signature = require("$:/core/modules/commands/inspect/lsp/lsp-signature.js"),
	reload = require("$:/core/modules/commands/inspect/lsp/lsp-reload.js"),
	inlay = require("$:/core/modules/commands/inspect/lsp/lsp-inlay.js"),
	rename = require("$:/core/modules/commands/inspect/lsp/lsp-rename.js"),
	source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	names = require("$:/core/modules/commands/inspect/lsp/lsp-names.js");

exports.diagnostics = function(uri, text) {
	return links.diagnostics(uri, text).concat(names.hints(uri, text));
};
exports.completions = completion.completions;
exports.hover = filters.hover;
exports.definition = definition.definition;
exports.references = references.references;
exports.documentSymbols = symbols.documentSymbols;
exports.workspaceSymbols = symbols.workspaceSymbols;
exports.documentHighlights = highlight.documentHighlights;
exports.foldingRanges = folding.foldingRanges;
exports.signatureHelp = signature.signatureHelp;
exports.reloadSaved = reload.reloadSaved;
exports.inlayHints = inlay.inlayHints;
exports.prepareRename = rename.prepareRename;
exports.rename = rename.rename;
exports.virtualDocument = source.virtualDocument;
exports.isVirtualUri = source.isVirtualUri;

// Test seams. Each is a pure function worth pinning without a document or a
// transport to reach it.
exports.bodyStartLine = source.bodyStartLine;
exports.scanLinks = links.scanLinks;
exports.titleOfTarget = links.titleOfTarget;
exports.linkContext = completion.linkContext;
exports.filterContext = filters.filterContext;
exports.bracketsBalanced = filters.bracketsBalanced;
exports.targetAt = definition.targetAt;
exports.pathToUri = source.pathToUri;
exports.uriToPath = source.uriToPath;
exports.uriOfTitle = source.uriOfTitle;
exports.markdownLink = filters.markdownLink;
exports.widgetSites = widgets.widgetSites;
exports.resolveAttribute = widgets.resolveAttribute;
exports.variablesOf = widgets.variablesOf;
exports.callSites = macros.callSites;
exports.findDefinition = macros.findDefinition;
exports.bindArguments = macros.bindArguments;
exports.sameFileKey = references.sameFileKey;
exports.virtualUri = source.virtualUri;
exports.titleOfVirtualUri = source.titleOfVirtualUri;
exports.virtualText = source.virtualText;
exports.documentUriOf = source.documentUriOf;
