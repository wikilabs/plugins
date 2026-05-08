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
	// Main mode with an admin set: only the admin can grant presenter via
	// /presenter/grant. Self-claim from any other tab is forbidden. With
	// no admin, main behaves as last-wins (same as presentation).
	if($tw.mcp.sse.getMode() === "main"
		&& $tw.mcp.sse.mainClientId
		&& $tw.mcp.sse.mainClientId !== clientId) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Main mode: only the admin can grant presenter\n");
		return;
	}
	var username = $tw.mcp.sse.capUsername(request.headers["x-mcp-username"] || null);
	$tw.mcp.sse.claimPresenter(clientId, username);
	response.writeHead(204);
	response.end();
};
