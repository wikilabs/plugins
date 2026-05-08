/*\
title: $:/core/modules/server/routes/sse-clients-list.js
type: application/javascript
module-type: route

GET /clients  --  snapshot of currently-connected SSE clients. Used by
the admin UI in main mode to populate the grant-presenter picker.
Returns JSON array of {clientId, username}. Polled, not pushed.

Admin-only: caller's X-MCP-Client-Id must be bound to an active
EventSource connection AND must equal the current main. Otherwise
the connected-client list would leak the very identifiers the audit
H1 finding warned about.

\*/

"use strict";

exports.methods = ["GET"];

exports.path = /^\/clients$/;

exports.info = {
	priority: 500
};

exports.handler = function(request, response, state) {
	if(!$tw.mcp || !$tw.mcp.sse) {
		response.writeHead(503, {"Content-Type": "text/plain"});
		response.end("SSE not enabled\n");
		return;
	}
	var clientId = $tw.mcp.sse.assertCaller(request, response);
	if(!clientId) return;
	if(!$tw.mcp.sse.mainClientId || clientId !== $tw.mcp.sse.mainClientId) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Only the current main may list connected clients\n");
		return;
	}
	var clients = $tw.mcp.sse.getClients();
	response.writeHead(200, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	response.end(JSON.stringify(clients));
};
