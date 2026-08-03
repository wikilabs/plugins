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
	var clientId = $tw.mcp.sse.assertCaller(request, response);
	if(!clientId) return;
	// In main mode with an admin set, the admin force-clears the granted
	// presenter, and the current presenter may release themselves. Other
	// tabs are 403'd.
	var sse = $tw.mcp.sse;
	if(sse.getMode() === "main" && sse.mainClientId) {
		if(clientId === sse.mainClientId) {
			sse.releasePresenter(null);
		} else if(clientId === sse.presenterClientId) {
			sse.releasePresenter(clientId);
		} else {
			response.writeHead(403, {"Content-Type": "text/plain"});
			response.end("Main mode: only the admin or current presenter can release\n");
			return;
		}
	} else {
		sse.releasePresenter(clientId);
	}
	response.writeHead(204);
	response.end();
};
