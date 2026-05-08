/*\
title: $:/core/modules/server/routes/sse-presenter-release.js
type: application/javascript
module-type: route

POST /presenter/release  --  the requesting tab releases the presenter
role. Only the current presenter can release the role; a release from a
different clientId is a no-op (returns 204 anyway, idempotent).

\*/

"use strict";

exports.methods = ["POST"];

exports.path = /^\/presenter\/release$/;

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
	if(!clientId) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("X-MCP-Client-Id header required\n");
		return;
	}
	$tw.mcp.sse.releasePresenter(clientId);
	response.writeHead(204);
	response.end();
};
