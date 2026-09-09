/*\
title: $:/core/modules/commands/inspect/lsp/lsp-definition.js
type: application/javascript
module-type: library

Go to definition: ctrl-click a [[link]] and open the .tid file that holds it.

The file is not searched for. $tw.boot.files is the same map TiddlyWiki uses to
save a tiddler back to disk, so it is authoritative: it survives a filename that
does not match the title, a FileSystemPaths rule that files the tiddler in a
subfolder, and a .tid whose fields live in a .meta sidecar. A regex over
"title:" would be wrong on all three, and would also match a title merely
mentioned in another tiddler's body.

\*/

"use strict";

var source = require("$:/core/modules/commands/inspect/lsp/lsp-source.js"),
	links = require("$:/core/modules/commands/inspect/lsp/lsp-links.js");

// Every link under the cursor, as {target, from, to} in document offsets.
// Both spellings are gathered: the hand-scanner sees [[X]] and {{X}}, and the
// parser sees <$link to="X"/>, which no line scanner could.
function linkSites(body) {
	var sites = [],
		scanned = links.scanLinks(body.lines, body.firstLine);
	for(var i = 0; i < scanned.length; i++) {
		var hit = scanned[i],
			lineStart = body.starts[hit.line];
		sites.push({ target: hit.target, from: lineStart + hit.start, to: lineStart + hit.end });
	}
	source.eachNode(source.parseBody(body.text), function(node) {
		if(node.type !== "link" || node.start === undefined) {
			return;
		}
		var to = (node.attributes || {}).to;
		if(to && to.type === "string" && to.value) {
			sites.push({ target: to.value, from: body.offset + node.start, to: body.offset + node.end });
		}
	});
	return sites;
}

// The tightest link containing the cursor. The scanner's range covers the
// target text and the parser's covers the whole widget, so the same [[X]] can
// appear twice; the narrower one describes what was clicked.
function targetAt(uri, text, position) {
	var body = source.bodyOf(uri, text),
		cursor = source.offsetAt(body.starts, position),
		gathered = linkSites(body),
		best = null;
	for(var i = 0; i < gathered.length; i++) {
		var site = gathered[i];
		if(cursor >= site.from && cursor <= site.to) {
			if(!best || (site.to - site.from) < (best.to - best.from)) {
				best = site;
			}
		}
	}
	return best ? best.target : null;
}

// LSP speaks URIs, and a Windows path is not one: the separators are wrong and
// a space in a title's filename must be escaped.
function pathToUri(filepath) {
	var slashed = filepath.replace(/\\/g, "/");
	if(slashed.charAt(0) !== "/") {
		slashed = "/" + slashed;
	}
	return "file://" + encodeURI(slashed).replace(/[?#]/g, function(ch) {
		return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
	});
}

// Where a title lives on disk, or null when it has no file of its own. A shadow
// tiddler is the ordinary case of that: it is supplied by a plugin, and neither
// $tw.boot.files nor the plugin tiddler records the folder it came from.
function fileOfTitle(title) {
	var entry = ($tw.boot.files || {})[title];
	return entry && entry.filepath ? entry.filepath : null;
}

function definition(uri, text, position) {
	var target = targetAt(uri, text, position);
	if(!target) {
		return null;
	}
	var filepath = fileOfTitle(links.titleOfTarget(target));
	if(!filepath) {
		return null;
	}
	// The whole file is the definition, so the range is its first character.
	return {
		uri: pathToUri(filepath),
		range: {
			start: { line: 0, character: 0 },
			end: { line: 0, character: 0 }
		}
	};
}

exports.definition = definition;
exports.targetAt = targetAt;
exports.pathToUri = pathToUri;
