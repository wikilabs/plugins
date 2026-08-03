/*\
title: $:/plugins/wikilabs/tw-mcp/sse-bootstrap.js
type: application/javascript
module-type: startup

Runs before the core "startup" module (which is when the syncadaptor is
selected). When SSE is active on the server and the user hasn't opted
out, we replace tiddlyweb's `adaptorClass` with an SSE-aware subclass
built by sse-adaptor.js. The syncer then picks the wrapped class
instead of the original.

Two gates must both be "yes" for the takeover to happen:

* `$:/status/wikilabs/tw-mcp/sse-server-active` -- written by the
  server when it was started with `--mcp sse`. The `$:/status/`
  prefix keeps it out of the SyncFilter so it never hits disk and a
  subsequent --mcp listen run starts clean.
* `$:/config/wikilabs/tw-mcp/sse-enabled` -- user-toggle, default
  yes. Set to "no" to keep polling even when the server supports SSE.

Note: $tw.modules.types.syncadaptor[title] is the module *info* object,
not the executed exports. We must call $tw.modules.execute() to load
the module before mutating adaptorClass on its exports.

\*/

"use strict";

exports.name = "tw-mcp-sse-bootstrap";
exports.platforms = ["browser"];
exports.before = ["startup"];
exports.synchronous = true;

var TIDDLYWEB_MODULE = "$:/plugins/tiddlywiki/tiddlyweb/tiddlywebadaptor.js";
var SSE_ADAPTOR_MODULE = "$:/plugins/wikilabs/tw-mcp/sse-adaptor.js";
var ENABLED_TIDDLER = "$:/config/wikilabs/tw-mcp/sse-enabled";
// $:/status/ prefix keeps it out of the default SyncFilter so it never
// gets persisted to disk on the server -- important so a subsequent start
// WITHOUT --mcp sse doesn't see a stale "yes" loaded from .tid files.
var SERVER_ACTIVE_TIDDLER = "$:/status/wikilabs/tw-mcp/sse-server-active";

exports.startup = function() {
	if($tw.wiki.getTiddlerText(SERVER_ACTIVE_TIDDLER, "no").trim() !== "yes") {
		return; // server was not started with --mcp sse
	}
	if($tw.wiki.getTiddlerText(ENABLED_TIDDLER, "yes").trim() !== "yes") {
		return; // user opted out via config tiddler
	}
	if(!$tw.modules.titles[TIDDLYWEB_MODULE]) {
		return; // tiddlyweb plugin not loaded; nothing to wrap
	}
	var tw = $tw.modules.execute(TIDDLYWEB_MODULE);
	if(!tw || !tw.adaptorClass) {
		return;
	}
	var makeSSEAdaptor = require(SSE_ADAPTOR_MODULE).makeSSEAdaptor;
	tw.adaptorClass = makeSSEAdaptor(tw.adaptorClass);
	console.log("tw-mcp/sse: wrapped tiddlyweb adaptor with SSE subclass");
};
