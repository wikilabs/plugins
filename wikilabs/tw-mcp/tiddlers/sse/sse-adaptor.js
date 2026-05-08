/*\
title: $:/plugins/wikilabs/tw-mcp/sse-adaptor.js
type: application/javascript
module-type: library

Factory that wraps the stock tiddlyweb syncadaptor with SSE behaviour.

The bootstrap calls makeSSEAdaptor(TiddlyWebAdaptor) and assigns the
returned class back to tiddlyweb's `exports.adaptorClass`. The syncer's
adaptor selection then instantiates the SSE-aware subclass.

We inherit four methods from tiddlyweb unchanged:
  getSkinnyTiddlers, loadTiddler, login, logout
And two prototype helpers:
  convertTiddlerToTiddlyWebFormat, convertTiddlerFromTiddlyWebFormat,
  parseEtag, getHost, getCsrfToken, getTiddlerInfo, getTiddlerRevision,
  setLoggerSaveBuffer, isReady

We override:
  getStatus     -- wraps the inherited one to also open the SSE stream
  saveTiddler   -- adds X-MCP-Client-Id header (tiddlyweb hardcodes
                   headers, so we must re-implement the body)
  deleteTiddler -- adds X-MCP-Client-Id header (same reason)

We add:
  connectEventStream, handleHello, handleTiddlerChange, handleTiddlerDelete,
  handleCacheMiss, forceFullSync, plus per-instance clientId / eventSource /
  lastServerInstanceId state.

This keeps all unchanged tiddlyweb logic in tiddlyweb's own module so any
upstream fixes flow through automatically.

\*/

"use strict";

function generateClientId() {
	if(typeof crypto !== "undefined" && crypto.randomUUID) {
		return crypto.randomUUID();
	}
	return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function parseSSEData(ev) {
	try {
		return JSON.parse(ev.data);
	} catch(e) {
		return null;
	}
}

exports.makeSSEAdaptor = function(BaseClass) {
	function TiddlyWebSSEAdaptor(options) {
		BaseClass.call(this, options);
		this.clientId = generateClientId();
		this.eventSource = null;
		this.lastServerInstanceId = null;
		// Re-stamp the logger so console output identifies the actual class
		this.logger = new $tw.utils.Logger("TiddlyWebSSEAdaptor");
	}
	TiddlyWebSSEAdaptor.prototype = Object.create(BaseClass.prototype);
	TiddlyWebSSEAdaptor.prototype.constructor = TiddlyWebSSEAdaptor;
	TiddlyWebSSEAdaptor.prototype.name = "tiddlywebsse";

	TiddlyWebSSEAdaptor.prototype.saveTiddler = function(tiddler, callback, options) {
		var self = this;
		if(this.isReadOnly) {
			return callback(null);
		}
		$tw.utils.httpRequest({
			url: this.host + "recipes/" + encodeURIComponent(this.recipe) + "/tiddlers/" + encodeURIComponent(tiddler.fields.title),
			type: "PUT",
			headers: {
				"Content-type": "application/json",
				"X-MCP-Client-Id": this.clientId
			},
			data: this.convertTiddlerToTiddlyWebFormat(tiddler),
			callback: function(err, data, request) {
				if(err) {
					return callback(err);
				}
				if($tw.browserStorage && $tw.browserStorage.isEnabled()) {
					$tw.browserStorage.removeTiddlerFromLocalStorage(tiddler.fields.title);
				}
				var etag = request.getResponseHeader("Etag");
				if(!etag) {
					callback("Response from server is missing required `etag` header");
				} else {
					var etagInfo = self.parseEtag(etag);
					callback(null, {bag: etagInfo.bag}, etagInfo.revision);
				}
			}
		});
	};

	TiddlyWebSSEAdaptor.prototype.deleteTiddler = function(title, callback, options) {
		if(this.isReadOnly) {
			return callback(null);
		}
		var bag = options.tiddlerInfo.adaptorInfo && options.tiddlerInfo.adaptorInfo.bag;
		if(!bag) {
			return callback(null, options.tiddlerInfo.adaptorInfo);
		}
		$tw.utils.httpRequest({
			url: this.host + "bags/" + encodeURIComponent(bag) + "/tiddlers/" + encodeURIComponent(title),
			type: "DELETE",
			headers: {
				"X-MCP-Client-Id": this.clientId
			},
			callback: function(err) {
				if(err) {
					return callback(err);
				}
				callback(null, null);
			}
		});
	};

	var baseGetStatus = BaseClass.prototype.getStatus;
	TiddlyWebSSEAdaptor.prototype.getStatus = function(callback) {
		var self = this;
		baseGetStatus.call(this, function(err, isLoggedIn, username, isReadOnly, isAnonymous) {
			if(!err) {
				self.connectEventStream();
			}
			if(callback) {
				callback(err, isLoggedIn, username, isReadOnly, isAnonymous);
			}
		});
	};

	TiddlyWebSSEAdaptor.prototype.connectEventStream = function() {
		var self = this;
		if(this.eventSource) return;
		if(typeof EventSource === "undefined") {
			this.logger.log("EventSource not available; SSE disabled, falling back to polling");
			return;
		}
		var url = this.host + "events";
		this.logger.log("Opening SSE stream:", url);
		var es = new EventSource(url, {withCredentials: true});
		this.eventSource = es;
		es.addEventListener("hello", function(ev) { self.handleHello(ev); });
		es.addEventListener("tiddler-change", function(ev) { self.handleTiddlerChange(ev); });
		es.addEventListener("tiddler-delete", function(ev) { self.handleTiddlerDelete(ev); });
		es.addEventListener("cache-miss", function(ev) { self.handleCacheMiss(ev); });
		es.addEventListener("error", function() {
			self.logger.log("SSE stream error; will auto-reconnect");
		});
	};

	TiddlyWebSSEAdaptor.prototype.handleHello = function(ev) {
		var data = parseSSEData(ev);
		if(!data) return;
		if(this.lastServerInstanceId !== null && this.lastServerInstanceId !== data.serverInstanceId) {
			this.logger.log("Server instance changed - forcing full sync");
			this.forceFullSync();
		}
		this.lastServerInstanceId = data.serverInstanceId;
	};

	TiddlyWebSSEAdaptor.prototype.handleTiddlerChange = function(ev) {
		var data = parseSSEData(ev);
		if(!data) return;
		if(data.clientId && data.clientId === this.clientId) return;
		var syncer = $tw.syncer;
		if(!syncer) return;
		if(data.fields) {
			var fields = this.convertTiddlerFromTiddlyWebFormat(data.fields);
			syncer.storeTiddler(fields);
		} else {
			syncer.titlesToBeLoaded[data.title] = true;
			syncer.processTaskQueue();
		}
	};

	TiddlyWebSSEAdaptor.prototype.handleTiddlerDelete = function(ev) {
		var data = parseSSEData(ev);
		if(!data) return;
		if(data.clientId && data.clientId === this.clientId) return;
		var syncer = $tw.syncer;
		if(!syncer) return;
		delete syncer.tiddlerInfo[data.title];
		this.wiki.deleteTiddler(data.title);
	};

	TiddlyWebSSEAdaptor.prototype.handleCacheMiss = function() {
		this.logger.log("SSE cache-miss - forcing full sync");
		this.forceFullSync();
	};

	TiddlyWebSSEAdaptor.prototype.forceFullSync = function() {
		var syncer = $tw.syncer;
		if(!syncer) return;
		syncer.forceSyncFromServer = true;
		syncer.processTaskQueue();
	};

	return TiddlyWebSSEAdaptor;
};
