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

// Body should be a tiny `{"clientId":"<uuid>"}` (~50 bytes). 1KB is a
// generous ceiling that closes audit L3 without rejecting any legitimate
// payload.
var MAX_GRANT_BODY_BYTES = 1024;

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
	var adminClientId = $tw.mcp.sse.assertCaller(request, response);
	if(!adminClientId) return;
	var body = state.data || "";
	if(body.length > MAX_GRANT_BODY_BYTES) {
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
