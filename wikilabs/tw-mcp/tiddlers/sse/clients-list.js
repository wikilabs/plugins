/*\
title: $:/core/modules/server/routes/sse-clients-list.js
type: application/javascript
module-type: route

GET /clients  --  snapshot of currently-connected SSE clients. Used by
the admin UI in main mode to populate the grant-presenter picker.
Returns JSON array of {clientId, username}. Polled, not pushed.

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
	var clients = $tw.mcp.sse.getClients();
	response.writeHead(200, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store"
	});
	response.end(JSON.stringify(clients));
};
