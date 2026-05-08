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

var STATE_PRESENTER = "$:/state/wikilabs/tw-mcp/presenter-clientId";
var STATE_PRESENTER_USERNAME = "$:/state/wikilabs/tw-mcp/presenter-username";
var STATE_MY_CLIENT_ID = "$:/state/wikilabs/tw-mcp/my-clientId";
var USERNAME_TIDDLER = "$:/status/UserName";
var PER_TAB_TIDDLERS_TIDDLER = "$:/config/wikilabs/tw-mcp/per-tab-tiddlers";
var DEFAULT_PER_TAB_FILTER = "[[$:/StoryList]] [[$:/HistoryList]] [prefix[$:/state/]]";
var SYNC_FILTER_TIDDLER = "$:/config/SyncFilter";

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
		// Stash my clientId in a state tiddler so the ControlPanel UI can
		// show "(you)" by comparing to $:/state/.../presenter-clientId.
		this.wiki.addTiddler({title: STATE_MY_CLIENT_ID, text: this.clientId});
		// Hook UI buttons. The ControlPanel emits these messages.
		var self = this;
		if($tw.rootWidget) {
			$tw.rootWidget.addEventListener("tm-mcp-claim-presenter", function() {
				self.postPresenterAction("claim");
			});
			$tw.rootWidget.addEventListener("tm-mcp-release-presenter", function() {
				self.postPresenterAction("release");
			});
		}
		// Watch for per-tab tiddler changes the syncer would skip (most
		// notably $:/state/*) and push them directly when we're the
		// presenter. Without this the presenter's UI state wouldn't reach
		// followers because TW's SyncFilter excludes $:/state/* entirely.
		this.wiki.addEventListener("change", function(changes) {
			self.pushPerTabIfPresenter(changes);
		});
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
		// EventSource cannot set custom headers, so clientId+username ride in
		// the query string. The server tracks both on the connection: clientId
		// for presenter-role cleanup on disconnect, username so presenter UIs
		// can show a friendly name instead of just a UUID.
		var username = this.wiki.getTiddlerText(USERNAME_TIDDLER, "") || "";
		var url = this.host + "events?clientId=" + encodeURIComponent(this.clientId);
		if(username) {
			url += "&username=" + encodeURIComponent(username);
		}
		this.logger.log("Opening SSE stream:", url);
		var es = new EventSource(url, {withCredentials: true});
		this.eventSource = es;
		es.addEventListener("hello", function(ev) { self.handleHello(ev); });
		es.addEventListener("tiddler-change", function(ev) { self.handleTiddlerChange(ev); });
		es.addEventListener("tiddler-delete", function(ev) { self.handleTiddlerDelete(ev); });
		es.addEventListener("cache-miss", function(ev) { self.handleCacheMiss(ev); });
		es.addEventListener("presenter-changed", function(ev) { self.handlePresenterChanged(ev); });
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
		// Mirror server's presenter state into local state tiddlers so the UI
		// can show who is presenting (UUID + friendly username).
		this.wiki.addTiddler({title: STATE_PRESENTER, text: data.presenterClientId || ""});
		this.wiki.addTiddler({title: STATE_PRESENTER_USERNAME, text: data.presenterUsername || ""});
		// Auto-claim: in presentation/main mode, if no current presenter, this
		// tab takes the role. First-tab-wins by virtue of arriving first;
		// later tabs see a populated presenterClientId and don't claim.
		if((data.mode === "presentation" || data.mode === "main") && !data.presenterClientId) {
			this.postPresenterAction("claim");
		}
	};

	TiddlyWebSSEAdaptor.prototype.handlePresenterChanged = function(ev) {
		var data = parseSSEData(ev);
		if(!data) return;
		this.wiki.addTiddler({title: STATE_PRESENTER, text: data.clientId || ""});
		this.wiki.addTiddler({title: STATE_PRESENTER_USERNAME, text: data.username || ""});
	};

	// Returns a Set of titles in `changedTitles` that match the given filter.
	function runFilterOn(wiki, filterText, changedTitles) {
		var fn = wiki.compileFilter(filterText);
		var source = function(callback) {
			changedTitles.forEach(function(title) {
				var t = wiki.tiddlerExists(title) && wiki.getTiddler(title);
				callback(t, title);
			});
		};
		var hits = fn.call(wiki, source);
		var set = Object.create(null);
		for(var i = 0; i < hits.length; i++) set[hits[i]] = true;
		return set;
	}

	TiddlyWebSSEAdaptor.prototype.pushPerTabIfPresenter = function(changes) {
		if(!this.eventSource || !this.recipe) return;
		// Only the current presenter pushes per-tab tiddlers; followers do not.
		if(this.wiki.getTiddlerText(STATE_PRESENTER, "") !== this.clientId) return;
		var titles = Object.keys(changes);
		var perTab = runFilterOn(this.wiki, this.wiki.getTiddlerText(PER_TAB_TIDDLERS_TIDDLER, DEFAULT_PER_TAB_FILTER), titles);
		// Skip titles the syncer will already push (e.g. $:/StoryList) -- avoids
		// duplicate PUTs for tiddlers in both filters.
		var syncFilter = this.wiki.getTiddlerText(SYNC_FILTER_TIDDLER, "[all[tiddlers]]");
		var synced = runFilterOn(this.wiki, syncFilter, titles);
		var self = this;
		titles.forEach(function(title) {
			if(!perTab[title]) return;
			if(synced[title]) return;
			if(changes[title].deleted) {
				self.directDeleteForPresenter(title);
			} else {
				self.directPutForPresenter(title);
			}
		});
	};

	TiddlyWebSSEAdaptor.prototype.directPutForPresenter = function(title) {
		var tiddler = this.wiki.getTiddler(title);
		if(!tiddler) return;
		var self = this;
		$tw.utils.httpRequest({
			url: this.host + "recipes/" + encodeURIComponent(this.recipe) + "/tiddlers/" + encodeURIComponent(title),
			type: "PUT",
			headers: {
				"Content-type": "application/json",
				"X-MCP-Client-Id": this.clientId
			},
			data: this.convertTiddlerToTiddlyWebFormat(tiddler),
			callback: function(err) {
				if(err) self.logger.log("presenter direct PUT failed for " + title + ":", err);
			}
		});
	};

	TiddlyWebSSEAdaptor.prototype.directDeleteForPresenter = function(title) {
		var self = this;
		// State tiddlers were never tracked by the syncer so we don't have a
		// recorded bag; the default tiddlyweb bag is "default".
		$tw.utils.httpRequest({
			url: this.host + "bags/default/tiddlers/" + encodeURIComponent(title),
			type: "DELETE",
			headers: {
				"X-MCP-Client-Id": this.clientId
			},
			callback: function(err) {
				if(err) self.logger.log("presenter direct DELETE failed for " + title + ":", err);
			}
		});
	};

	TiddlyWebSSEAdaptor.prototype.postPresenterAction = function(action) {
		var self = this;
		var headers = {
			"X-MCP-Client-Id": this.clientId,
			"X-Requested-With": "TiddlyWiki"
		};
		// Send the current $:/status/UserName so the server can attach a
		// friendly name to the presenter event. The user may have set this
		// AFTER EventSource opened, so we read it fresh on every claim.
		var username = this.wiki.getTiddlerText(USERNAME_TIDDLER, "") || "";
		if(username) {
			headers["X-MCP-Username"] = username;
		}
		$tw.utils.httpRequest({
			url: this.host + "presenter/" + action,
			type: "POST",
			headers: headers,
			callback: function(err) {
				if(err) {
					self.logger.log("presenter/" + action + " failed:", err);
				}
			}
		});
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
