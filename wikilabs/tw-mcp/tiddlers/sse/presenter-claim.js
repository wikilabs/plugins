/*\
title: $:/core/modules/server/routes/sse-presenter-claim.js
type: application/javascript
module-type: route

POST /presenter/claim  --  the requesting tab claims the presenter role
in presentation/main mode. Last-claim-wins -- a new claim demotes the
previous presenter. The clientId is read from the X-MCP-Client-Id
header. Idempotent.

\*/

"use strict";

exports.methods = ["POST"];

exports.path = /^\/presenter\/claim$/;

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
	var username = request.headers["x-mcp-username"] || null;
	$tw.mcp.sse.claimPresenter(clientId, username);
	response.writeHead(204);
	response.end();
};
