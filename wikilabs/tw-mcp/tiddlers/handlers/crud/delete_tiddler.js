/*\
title: $:/core/modules/commands/inspect/handlers/crud/delete_tiddler.js
type: application/javascript
module-type: library

MCP tool handler: delete_tiddler — unlink the on-disk file (if any) then
remove the tiddler from the wiki store. Honours the allowed-paths gate.

\*/

"use strict";

var shared = require("$:/core/modules/commands/inspect/handlers/shared.js");

module.exports = {
	"delete_tiddler": function(args) {
		var denied = shared.checkWritable("delete_tiddler");
		if(denied) return denied;
		var titleErr = shared.checkTitle(args.title, "delete_tiddler");
		if(titleErr) return titleErr;
		var checkPathAllowed = shared.getCheckPathAllowed();
		if(!$tw.wiki.tiddlerExists(args.title)) {
			return shared.errorResult("Tiddler not found: " + args.title);
		}
		var fileInfo = $tw.boot.files && $tw.boot.files[args.title];
		if(fileInfo) {
			var pathDenied = checkPathAllowed(fileInfo.filepath);
			if(pathDenied) return pathDenied;
			try {
				$tw.utils.deleteTiddlerFile(fileInfo, function(err) {
					if(err) {
						process.stderr.write("[tw-mcp] Error deleting file for tiddler: " + args.title + ": " + err + "\n");
					}
				});
				delete $tw.boot.files[args.title];
			} catch(e) {
				$tw.wiki.deleteTiddler(args.title);
				return shared.errorResult("Tiddler deleted from store but failed to remove file: " + e.message);
			}
		}
		$tw.wiki.deleteTiddler(args.title);
		return shared.textResult("Tiddler deleted: " + args.title);
	}
};
