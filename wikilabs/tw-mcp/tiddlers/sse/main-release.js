/*\
title: $:/core/modules/server/routes/sse-main-release.js
type: application/javascript
module-type: route

POST /main/release  --  the requesting tab releases the i-am-main admin
role. Only the current admin can release the role; a release from a
different clientId is a no-op (returns 204 anyway, idempotent).

\*/

"use strict";

exports.methods = ["POST"];

exports.path = /^\/main\/release$/;

exports.info = {
	priority: 500
};

exports.handler = function(request, response, state) {
	if(!$tw.mcp || !$tw.mcp.sse) {
		response.writeHead(503, {"Content-Type": "text/plain"});
		response.end("SSE not enabled\n");
		return;
	}
	var clientId = request.headers["x-mcp-client-id"];
	if(!clientId || !$tw.mcp.sse.isValidClientId(clientId)) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("X-MCP-Client-Id header missing or malformed\n");
		return;
	}
	if(!$tw.mcp.sse.isClientConnected(clientId)) {
		response.writeHead(401, {"Content-Type": "text/plain"});
		response.end("clientId not bound to an active connection\n");
		return;
	}
	$tw.mcp.sse.releaseMain(clientId);
	response.writeHead(204);
	response.end();
};
