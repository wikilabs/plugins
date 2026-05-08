/*\
title: $:/core/modules/server/routes/sse-put-tiddler.js
type: application/javascript
module-type: route

PUT /recipes/default/tiddlers/:title  --  with X-MCP-Client-Id stash for SSE
echo suppression. Mirrors the core put-tiddler.js handler, but before
addTiddler() it records the originator clientId on $tw.mcp.sse so the
upcoming wiki "change" event can be broadcast tagged with that clientId
(letting receivers skip events they triggered themselves).

Higher priority than the core handler so it wins the route match.

\*/

"use strict";

exports.methods = ["PUT"];

exports.path = /^\/recipes\/default\/tiddlers\/(.+)$/;

exports.info = {
	priority: 200
};

exports.handler = function(request, response, state) {
	var title = $tw.utils.decodeURIComponentSafe(state.params[0]),
		fields = $tw.utils.parseJSONSafe(state.data);
	if(fields.fields) {
		$tw.utils.each(fields.fields, function(field, name) {
			fields[name] = field;
		});
		delete fields.fields;
	}
	if(fields.revision) {
		delete fields.revision;
	}
	if(fields._is_skinny !== undefined) {
		var existing = state.wiki.getTiddler(title);
		if(existing) {
			fields.text = existing.fields.text;
		}
		delete fields._is_skinny;
	}
	var clientId = request.headers["x-mcp-client-id"];
	if($tw.mcp && $tw.mcp.sse && $tw.mcp.sse.isConfigLockdownViolation(title, clientId)) {
		response.writeHead(403, {"Content-Type": "text/plain"});
		response.end("Main mode: only the admin can change SSE settings\n");
		return;
	}
	if(clientId && $tw.mcp && $tw.mcp.sse) {
		$tw.mcp.sse.recordOriginator(title, clientId);
	}
	state.wiki.addTiddler(new $tw.Tiddler(fields, {title: title}));
	var changeCount = state.wiki.getChangeCount(title).toString();
	response.writeHead(204, "OK", {
		Etag: "\"default/" + encodeURIComponent(title) + "/" + changeCount + ":\"",
		"Content-Type": "text/plain"
	});
	response.end();
};
