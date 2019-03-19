/*\
title: $:/plugins/wikilabs/webdav-lm/put-last-modified.js
type: application/javascript
module-type: saver

Saves wiki by performing a PUT request to the server

Works with any server which accepts a PUT request
to the current URL, such as a WebDAV server.

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

/*
Retrieve last-modified if available
*/
var getLastMod = function(self) {
	var headers = { "Accept": "*/*"};
	$tw.utils.httpRequest({
		url: self.uri(),
		type: "HEAD",
		headers: headers,
		callback: function(err, data, xhr) {
			var lastMod = xhr.getResponseHeader("last-modified");
			if(!err && lastMod) {
				self.lastMod = lastMod;
			}
		}
	});
};


/*
Select the appropriate saver module and set it up
*/
var PutSaver = function(wiki) {
	this.putEnabled = true;
	this.wiki = wiki;
	var self = this;
	var uri = this.uri();
	// Async server probe. Until probe finishes, save will fail fast
	// See also https://github.com/Jermolene/TiddlyWiki5/issues/2276
	$tw.utils.httpRequest({
		url: uri,
		type: "OPTIONS",
		callback: function(err, data, xhr) {
			// Check DAV header http://www.webdav.org/specs/rfc2518.html#rfc.section.9.1
			if(!err) {
				self.serverAcceptsPuts = xhr.status === 200 && !!xhr.getResponseHeader("dav");
			}
		}
	});
};

PutSaver.prototype.uri = function() {
	return document.location.toString().split("#")[0];
};

// TODO: in case of edit conflict
// Prompt: Do you want to save over this? Y/N
// Merging would be ideal, and may be possible using future generic merge flow
PutSaver.prototype.save = function(text, method, callback) {
	if(!this.serverAcceptsPuts) {
		return false;
	}
	var self = this;
	var headers = { "Content-Type": "text/html;charset=UTF-8" };
	if(this.lastMod) {
		headers["If-Unmodified-Since"] = this.lastMod;
	}
	$tw.utils.httpRequest({
		url: this.uri(),
		type: "PUT",
		headers: headers,
		data: text,
		callback: function(err, data, xhr) {
			if(err) {
				// response is textual: "XMLHttpRequest error code: 412"
				const status = Number(err.substring(err.indexOf(':') + 2, err.length))
				if(status === 412) { // edit conflict
					var message = $tw.language.getString("Error/EditConflict");
					callback(message);
				} else {
					callback(err); // fail
				}

				self.putEnabled = false;
			} else {
				self.lastMod = xhr.getResponseHeader("last-modified");
				if (self.lastMod == null) {
					getLastMod(self);
				}
				callback(null); // success
			}
		}
	});
	return true;
};

/*
Information about this saver
*/
PutSaver.prototype.info = {
	name: "put",
	priority: 2100,
	capabilities: ["save", "autosave"]
};

/*
Static method that returns true if this saver is capable of working
*/
exports.canSave = function(wiki) {
	return /^https?:/.test(location.protocol);
};

/*
Create an instance of this saver
*/
exports.create = function(wiki) {
	return new PutSaver(wiki);
};

})();
