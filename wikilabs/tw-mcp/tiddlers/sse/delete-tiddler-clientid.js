/*\
title: $:/core/modules/server/routes/sse-delete-tiddler.js
type: application/javascript
module-type: route

DELETE /bags/default/tiddlers/:title  --  with X-MCP-Client-Id stash for SSE
echo suppression. Mirrors the core delete-tiddler.js handler, but before
deleteTiddler() it records the originator clientId on $tw.mcp.sse so the
upcoming wiki "change" event can be broadcast tagged with that clientId.

Higher priority than the core handler so it wins the route match.

\*/

"use strict";

exports.methods = ["DELETE"];

exports.path = /^\/bags\/default\/tiddlers\/(.+)$/;

exports.info = {
	priority: 200
};

exports.handler = function(request, response, state) {
	var title = $tw.utils.decodeURIComponentSafe(state.params[0]);
	var clientId = request.headers["x-mcp-client-id"];
	if($tw.mcp && $tw.mcp.sse && $tw.mcp.sse.isConfigLockdownViolation(title, clientId)) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Main mode: only the admin can change SSE settings\n");
		return;
	}
	if(clientId && $tw.mcp && $tw.mcp.sse) {
		$tw.mcp.sse.recordOriginator(title, clientId);
	}
	state.wiki.deleteTiddler(title);
	response.writeHead(204, "OK", {
		"Content-Type": "text/plain"
	});
	response.end();
};
