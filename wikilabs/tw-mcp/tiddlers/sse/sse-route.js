/*\
title: $:/core/modules/server/routes/sse-events.js
type: application/javascript
module-type: route

GET /events  --  Server-Sent Events stream of tiddler change notifications.

Returns 503 if SSE is not enabled (i.e. the server was not started with the
`--mcp sse` keyword). When enabled, attaches the response to the broadcaster
which holds the connection open and writes events as they occur.

\*/

"use strict";

exports.methods = ["GET"];

exports.path = /^\/events$/;

exports.info = {
	priority: 500
};

exports.handler = function(request, response, state) {
	if(!$tw.mcp || !$tw.mcp.sse) {
		response.writeHead(503, {"Content-Type": "text/plain"});
		response.end("SSE not enabled - start the server with --mcp sse\n");
		return;
	}
	// clientId is server-issued in addClient() and returned via the hello
	// payload -- any caller-supplied ?clientId= query parameter is ignored.
	// Usernames are length-capped but otherwise unrestricted.
	var username = $tw.mcp.sse.capUsername(state.queryParameters && state.queryParameters.username || null);
	$tw.mcp.sse.addClient(request, response, username);
};
