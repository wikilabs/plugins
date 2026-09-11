/*\
title: $:/core/modules/commands/inspect/lsp/lsp-discovery.js
type: application/javascript
module-type: library

The .tw-mcp/lsp file that tells an editor which port this wiki's --lsp serves.
It is kept apart from .tw-mcp/connect, which MCP takeover rewrites and whose
readers require a pipe and a token.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null;

var DIR_NAME = ".tw-mcp",
	FILE_NAME = "lsp";

function discoveryFile(wikiDir) {
	return path.resolve(wikiDir, DIR_NAME, FILE_NAME);
}

function writeDiscovery(wikiDir, data) {
	$tw.utils.createDirectory(path.resolve(wikiDir, DIR_NAME));
	fs.writeFileSync(discoveryFile(wikiDir), JSON.stringify(data), "utf8");
}

// Returns the parsed file, or null when there is none.
function readDiscovery(wikiDir) {
	var file = discoveryFile(wikiDir);
	if(!fs.existsSync(file)) {
		return null;
	}
	return JSON.parse(fs.readFileSync(file, "utf8"));
}

// Removes the file only while it still names pid: a later server for the same
// wiki may have replaced it.
function removeDiscovery(wikiDir, pid) {
	var data = readDiscovery(wikiDir);
	if(data && data.pid === pid) {
		fs.unlinkSync(discoveryFile(wikiDir));
		return true;
	}
	return false;
}

exports.discoveryFile = discoveryFile;
exports.writeDiscovery = writeDiscovery;
exports.readDiscovery = readDiscovery;
exports.removeDiscovery = removeDiscovery;
