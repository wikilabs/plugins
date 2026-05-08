/*\
title: $:/core/modules/server/routes/sse-presenter-grant.js
type: application/javascript
module-type: route

POST /presenter/grant  --  the i-am-main admin grants the presenter role
to a target clientId. Body: {"clientId": "<target>"}. The caller's
clientId rides in X-MCP-Client-Id and must equal the current main, else
403.

\*/

"use strict";

exports.methods = ["POST"];

exports.path = /^\/presenter\/grant$/;

exports.info = {
	priority: 500
};

exports.bodyFormat = "string";

exports.handler = function(request, response, state) {
	if(!$tw.mcp || !$tw.mcp.sse) {
		response.writeHead(503, {"Content-Type": "text/plain"});
		response.end("SSE not enabled\n");
		return;
	}
	var adminClientId = request.headers["x-mcp-client-id"];
	if(!adminClientId || !$tw.mcp.sse.isValidClientId(adminClientId)) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("X-MCP-Client-Id header missing or malformed\n");
		return;
	}
	if(!$tw.mcp.sse.isClientConnected(adminClientId)) {
		response.writeHead(401, {"Content-Type": "text/plain"});
		response.end("clientId not bound to an active connection\n");
		return;
	}
	var body = state.data || "";
	if(body.length > 1024) {
		response.writeHead(413, {"Content-Type": "text/plain"});
		response.end("Request body too large\n");
		return;
	}
	var parsed = null;
	try { parsed = JSON.parse(body); } catch(e) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("Body must be JSON: {\"clientId\": \"...\"}\n");
		return;
	}
	var targetClientId = parsed && parsed.clientId;
	if(!targetClientId || !$tw.mcp.sse.isValidClientId(targetClientId)) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("Body clientId missing or malformed\n");
		return;
	}
	var ok = $tw.mcp.sse.grantPresenter(adminClientId, targetClientId);
	if(!ok) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Grant rejected: caller is not main, or target is not connected\n");
		return;
	}
	response.writeHead(204);
	response.end();
};
