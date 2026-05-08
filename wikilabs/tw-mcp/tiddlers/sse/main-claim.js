/*\
title: $:/core/modules/server/routes/sse-main-claim.js
type: application/javascript
module-type: route

POST /main/claim  --  the requesting tab claims the i-am-main admin role
in main mode. Last-claim-wins -- a new claim demotes the previous admin.
The clientId is read from the X-MCP-Client-Id header; an optional
X-MCP-Username header carries the friendly name.

\*/

"use strict";

exports.methods = ["POST"];

exports.path = /^\/main\/claim$/;

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
	// Main is exclusive. Reject takeover attempts with 409 so the UI can
	// distinguish "already held" from generic refusal.
	if($tw.mcp.sse.mainClientId && $tw.mcp.sse.mainClientId !== clientId) {
		response.writeHead(409, {"Content-Type": "text/plain"});
		response.end("Main role already held by another tab\n");
		return;
	}
	var username = $tw.mcp.sse.capUsername(request.headers["x-mcp-username"] || null);
	// Becoming main also takes presenter -- the admin starts the session
	// in control. Only on the initial claim (mainClientId was null); a
	// re-claim with updated username won't yank presenter back from
	// someone the admin previously granted.
	var wasInitial = !$tw.mcp.sse.mainClientId;
	$tw.mcp.sse.claimMain(clientId, username);
	if(wasInitial) {
		$tw.mcp.sse.claimPresenter(clientId, username);
	}
	response.writeHead(204);
	response.end();
};
