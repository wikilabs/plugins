/*\
title: $:/plugins/wikilabs/tw-mcp/sync-filter-bootstrap.js
type: application/javascript
module-type: startup

Points the syncer at $:/config/wikilabs/tw-mcp/SyncFilter, which
subfilters the core $:/config/SyncFilter and `:except`s OTP. Keeps
$:/config/OriginalTiddlerPaths out of the syncer's working set so it
is never persisted to disk by the syncadaptor.

OTP is a derived runtime tiddler. TW core builds it once at boot,
where the syncer is not yet listening so the boot-time addTiddler is
silent. Any refresh callers after boot (reload_tiddlers) need the
syncer to skip it permanently.

\*/

"use strict";

exports.name = "tw-mcp-sync-filter-bootstrap";
exports.before = ["startup"];
exports.synchronous = true;

exports.startup = function() {
	if($tw.Syncer && $tw.Syncer.prototype) {
		$tw.Syncer.prototype.titleSyncFilter = "$:/config/wikilabs/tw-mcp/SyncFilter";
	}
};
