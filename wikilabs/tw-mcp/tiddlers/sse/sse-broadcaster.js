/*\
title: $:/core/modules/server/sse-broadcaster.js
type: application/javascript
module-type: library

Server-Sent Events broadcaster for the wikilabs/tw-mcp plugin.

Singleton lives at $tw.mcp.sse. Holds connected clients, a bounded ring
buffer of recent events for Last-Event-ID replay, the server instance id
(regenerated on every server start), and the wiki "change" listener that
turns mutations into `tiddler-change` and `tiddler-delete` events.

Use exports.initialize(wiki) once at server start to create the singleton.
The /events route handler reads $tw.mcp.sse to attach clients.

\*/

"use strict";

var DEFAULT_RING_SIZE = 500;
// Default inline threshold: above this size the SSE event carries only
// `title` + `revision` and the browser must fetch the body via the syncer
// (a ~250 ms wake-up cycle vs sub-ms for inlined content). 32 KiB covers
// the vast majority of doc tiddlers. Configurable per wiki via
// `$:/config/wikilabs/tw-mcp/sse-inline-threshold`.
var DEFAULT_INLINE_THRESHOLD = 32768;
var HEARTBEAT_MS = 25000;
var INLINE_THRESHOLD_TIDDLER = "$:/config/wikilabs/tw-mcp/sse-inline-threshold";
var SYNC_FILTER_TIDDLER = "$:/config/SyncFilter";
var DEFAULT_SYNC_FILTER = "[all[tiddlers]] -[[$:/isEncrypted]] -[prefix[$:/temp/]] -[prefix[$:/status/]] -[has[plugin-type]]";
// Per-tab view-state tiddlers: changes from a browser (clientId set) are NOT
// broadcast, so each tab keeps its own story river and history. MCP tools and
// filesystem-watcher edits have no clientId and broadcast normally.
var PER_TAB_TIDDLERS_TIDDLER = "$:/config/wikilabs/tw-mcp/per-tab-tiddlers";
var DEFAULT_PER_TAB_FILTER = "[[$:/StoryList]] [[$:/HistoryList]] [prefix[$:/state/]]";
var MODE_TIDDLER = "$:/config/wikilabs/tw-mcp/mode";
var MAX_CONNECTIONS = 50;

var KNOWN_TIDDLYWEB_FIELDS = ["bag","created","creator","modified","modifier","permissions","recipe","revision","tags","text","title","type","uri"];

// Input caps. clientIds are UUIDs in the shape
// `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` (36 chars, hex). The server issues
// them itself at /events connect (see addClient); role routes accept them
// only via X-MCP-Client-Id, validated against this regex. Strict length +
// charset rejects a single non-hex byte; combined with the `<$text>` wrap
// in the ControlPanel it is defence-in-depth against wikitext injection
// through any route that echoes the clientId back to admins. Usernames are
// display-only and can contain anything (spaces, emoji, accents) -- only
// the length is capped so a malicious EventSource can't blow up event
// payloads or /clients output.
var MAX_USERNAME_LENGTH = 64;
var CLIENT_ID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function isValidClientId(s) {
	return typeof s === "string" && CLIENT_ID_PATTERN.test(s);
}

function capUsername(s) {
	if(typeof s !== "string") return null;
	return s.length > MAX_USERNAME_LENGTH ? s.substring(0, MAX_USERNAME_LENGTH) : s;
}

exports.isValidClientId = isValidClientId;
exports.capUsername = capUsername;

function SSEBroadcaster(wiki) {
	var self = this;
	this.wiki = wiki;
	// Map<clientId, {res, username}>. Keyed by the server-issued clientId so
	// findUsernameFor / isClientConnected / updateClientUsername are O(1).
	this.clients = new Map();
	this.ring = [];
	this.ringSize = DEFAULT_RING_SIZE;
	this.nextId = 1;
	this.serverInstanceId = generateInstanceId();
	this.pendingOriginators = Object.create(null);
	this.presenterClientId = null;
	this.presenterUsername = null;
	this.mainClientId = null;
	this.mainUsername = null;
	var filterText = wiki.getTiddlerText(SYNC_FILTER_TIDDLER) || DEFAULT_SYNC_FILTER;
	this.filterFn = wiki.compileFilter(filterText);
	wiki.addEventListener("change", function(changes) {
		self.handleWikiChange(changes);
	});
	setInterval(function() {
		self.sendHeartbeat();
	}, HEARTBEAT_MS);
}

SSEBroadcaster.prototype.isValidClientId = isValidClientId;
SSEBroadcaster.prototype.capUsername = capUsername;

SSEBroadcaster.prototype.getInlineThreshold = function() {
	var raw = this.wiki.getTiddlerText(INLINE_THRESHOLD_TIDDLER);
	var n = parseInt(raw, 10);
	return (n > 0 && n < 1024 * 1024) ? n : DEFAULT_INLINE_THRESHOLD;
};

SSEBroadcaster.prototype.getMode = function() {
	var raw = (this.wiki.getTiddlerText(MODE_TIDDLER, "default") || "default").trim();
	if(raw === "presentation" || raw === "main") return raw;
	return "default";
};

function generateInstanceId() {
	var crypto = require("crypto");
	return Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
}

// Echo-suppression hooks. PUT/DELETE handlers call recordOriginator before
// addTiddler/deleteTiddler so the change event carries the clientId.
// Single-pending-originator-per-title is fine because Node's event loop is
// single-threaded -- the synchronous addTiddler that follows fires the wiki
// "change" event before the next request enters the handler.
SSEBroadcaster.prototype.recordOriginator = function(title, clientId) {
	if(clientId) {
		this.pendingOriginators[title] = clientId;
	}
};

SSEBroadcaster.prototype.consumeOriginatorClientId = function(title) {
	var id = this.pendingOriginators[title];
	delete this.pendingOriginators[title];
	return id || null;
};

SSEBroadcaster.prototype.applySyncFilter = function(titles) {
	var self = this;
	var source = function(callback) {
		titles.forEach(function(title) {
			var t = self.wiki.tiddlerExists(title) && self.wiki.getTiddler(title);
			callback(t, title);
		});
	};
	var allowed = Object.create(null);
	var filtered = this.filterFn.call(this.wiki, source);
	for(var i = 0; i < filtered.length; i++) {
		allowed[filtered[i]] = true;
	}
	return allowed;
};

// Returns a hashmap of titles that count as "per-tab view state" (StoryList,
// HistoryList, $:/state/* by default; user-extendable via the config tiddler).
// Recompiles the filter per call so edits to the config tiddler take effect
// without restart -- compile is microsecond-fast for short filters.
SSEBroadcaster.prototype.applyPerTabFilter = function(titles) {
	var self = this;
	var filterText = this.wiki.getTiddlerText(PER_TAB_TIDDLERS_TIDDLER, DEFAULT_PER_TAB_FILTER);
	var filterFn = this.wiki.compileFilter(filterText);
	var source = function(callback) {
		titles.forEach(function(title) {
			var t = self.wiki.tiddlerExists(title) && self.wiki.getTiddler(title);
			callback(t, title);
		});
	};
	var hits = filterFn.call(this.wiki, source);
	var set = Object.create(null);
	for(var i = 0; i < hits.length; i++) {
		set[hits[i]] = true;
	}
	return set;
};

SSEBroadcaster.prototype.serializeTiddler = function(tiddler) {
	var fields = {};
	$tw.utils.each(tiddler.fields, function(value, name) {
		var stringValue = name === "tags" ? tiddler.fields.tags : tiddler.getFieldString(name);
		if(KNOWN_TIDDLYWEB_FIELDS.indexOf(name) !== -1) {
			fields[name] = stringValue;
		} else {
			fields.fields = fields.fields || {};
			fields.fields[name] = stringValue;
		}
	});
	fields.revision = this.wiki.getChangeCount(tiddler.fields.title);
	fields.bag = fields.bag || "default";
	fields.type = fields.type || "text/vnd.tiddlywiki";
	return fields;
};

// Decide whether a browser-originated change to a per-tab tiddler should
// broadcast. Returns true when the change should pass through.
//   default mode -- never (each tab is independent)
//   presentation -- only when originator is the current presenter
//   main         -- same: only the current presenter broadcasts. The admin
//                   chose that presenter via /presenter/grant; this code
//                   path just honours whoever holds the role now.
SSEBroadcaster.prototype.shouldBroadcastPerTab = function(clientId) {
	var mode = this.getMode();
	if(mode === "presentation" || mode === "main") {
		return !!(this.presenterClientId && clientId === this.presenterClientId);
	}
	return false;
};

SSEBroadcaster.prototype.handleWikiChange = function(changes) {
	var self = this;
	var titles = Object.keys(changes);
	// The i-am-main role only has meaning in main mode. If the wiki's mode
	// tiddler flips to anything else, clear it so a later switch back to
	// main starts unowned and any tab can claim.
	if(changes[MODE_TIDDLER] && this.mainClientId && this.getMode() !== "main") {
		this.releaseMain(null);
	}
	var allowed = this.applySyncFilter(titles);
	var perTab = this.applyPerTabFilter(titles);
	titles.forEach(function(title) {
		var change = changes[title];
		var clientId = self.consumeOriginatorClientId(title);
		// Per-tab tiddlers (StoryList, HistoryList, $:/state/* by default)
		// are gated by mode, regardless of SyncFilter. This lets presentation
		// mode broadcast the presenter's UI state (which is in $:/state/*
		// and would otherwise be excluded from sync).
		// Non-per-tab tiddlers: changes respect the wiki's SyncFilter, but
		// deletes can't (the tiddler is gone, so [is[tiddler]] excludes it).
		// Always broadcast non-per-tab deletes except for the prefixes
		// SyncFilter would have excluded anyway.
		if(perTab[title]) {
			if(clientId && !self.shouldBroadcastPerTab(clientId)) return;
		} else if(change.deleted) {
			if(title.indexOf("$:/temp/") === 0) return;
			if(title.indexOf("$:/status/") === 0) return;
		} else {
			if(!allowed[title]) return;
		}
		if(change.deleted) {
			self.broadcast("tiddler-delete", {
				title: title,
				clientId: clientId
			});
		} else {
			var tiddler = self.wiki.getTiddler(title);
			if(!tiddler) return;
			var fields = self.serializeTiddler(tiddler);
			var json = JSON.stringify(fields);
			var payload = {
				title: title,
				revision: self.wiki.getChangeCount(title).toString(),
				clientId: clientId
			};
			if(json.length <= self.getInlineThreshold()) {
				payload.fields = fields;
			}
			self.broadcast("tiddler-change", payload);
		}
	});
};

// Look up the username an EventSource client supplied at connect time.
SSEBroadcaster.prototype.findUsernameFor = function(clientId) {
	var c = this.clients.get(clientId);
	return c ? (c.username || null) : null;
};

// Backfill the username on any matching EventSource client. Used when a
// claim arrives with X-MCP-Username for a tab whose SSE connection was
// opened before the user typed their name -- without this, getClients()
// keeps returning the connection-time empty value.
SSEBroadcaster.prototype.updateClientUsername = function(clientId, username) {
	if(!clientId || !username) return;
	var c = this.clients.get(clientId);
	if(c) c.username = username;
};

// Presenter election (last-claim-wins). Called from /presenter/claim, from
// grantPresenter (which is the /presenter/grant path), and from /main/claim
// when its initial claim auto-takes presenter. Username may come from the
// claim header (preferred -- always fresh) or from the connection-time
// lookup (fallback).
SSEBroadcaster.prototype.claimPresenter = function(clientId, username) {
	if(!clientId) return false;
	this.updateClientUsername(clientId, username);
	var resolvedUsername = username || this.findUsernameFor(clientId) || null;
	// No-op only if both clientId AND username already match (so a re-claim
	// after the user types their UserName promotes the friendly name).
	if(this.presenterClientId === clientId && this.presenterUsername === resolvedUsername) return false;
	this.presenterClientId = clientId;
	this.presenterUsername = resolvedUsername;
	this.broadcast("presenter-changed", { clientId: clientId, username: resolvedUsername });
	return true;
};

SSEBroadcaster.prototype.releasePresenter = function(clientId) {
	// Only the current presenter can release the role (or null clears it
	// unconditionally for disconnect-driven release).
	if(clientId !== null && clientId !== this.presenterClientId) return false;
	if(this.presenterClientId === null) return false;
	this.presenterClientId = null;
	this.presenterUsername = null;
	this.broadcast("presenter-changed", { clientId: null, username: null });
	return true;
};

// The admin role is exclusive: once a tab holds main, no other tab can
// take over. Same-tab re-claims update the friendly name (e.g. after the
// user types a UserName). Release/disconnect/mode-flip are the only ways
// the role changes hands.
SSEBroadcaster.prototype.claimMain = function(clientId, username) {
	if(!clientId) return false;
	if(this.mainClientId && this.mainClientId !== clientId) return false;
	this.updateClientUsername(clientId, username);
	var resolvedUsername = username || this.findUsernameFor(clientId) || null;
	if(this.mainClientId === clientId && this.mainUsername === resolvedUsername) return false;
	this.mainClientId = clientId;
	this.mainUsername = resolvedUsername;
	this.broadcast("main-changed", { clientId: clientId, username: resolvedUsername });
	return true;
};

SSEBroadcaster.prototype.releaseMain = function(clientId) {
	if(clientId !== null && clientId !== this.mainClientId) return false;
	if(this.mainClientId === null) return false;
	this.mainClientId = null;
	this.mainUsername = null;
	this.broadcast("main-changed", { clientId: null, username: null });
	return true;
};

SSEBroadcaster.prototype.isClientConnected = function(clientId) {
	return !!clientId && this.clients.has(clientId);
};

// True iff a PUT/DELETE on `title` from `clientId` should be 403'd because
// main-mode lockdown applies (admin set, caller is not the admin, target
// is under $:/config/wikilabs/tw-mcp/). Used by the put/delete handlers
// that wrap the core routes.
SSEBroadcaster.prototype.isConfigLockdownViolation = function(title, clientId) {
	if(!clientId) return false;
	if(title.indexOf("$:/config/wikilabs/tw-mcp/") !== 0) return false;
	if(this.getMode() !== "main") return false;
	if(!this.mainClientId) return false;
	return this.mainClientId !== clientId;
};

// Validate the X-MCP-Client-Id header for a role-gated route. Writes a
// 400 (missing/malformed) or 401 (not bound to a live connection) response
// directly when validation fails, so the caller can return immediately on
// a falsy result. Returns the clientId on success.
SSEBroadcaster.prototype.assertCaller = function(request, response) {
	var clientId = request.headers["x-mcp-client-id"];
	if(!clientId || !this.isValidClientId(clientId)) {
		response.writeHead(400, {"Content-Type": "text/plain"});
		response.end("X-MCP-Client-Id header missing or malformed\n");
		return null;
	}
	if(!this.isClientConnected(clientId)) {
		response.writeHead(401, {"Content-Type": "text/plain"});
		response.end("X-MCP-Client-Id not bound to an active connection\n");
		return null;
	}
	return clientId;
};

// Admin-gated presenter grant. Returns false if caller is not the current
// admin (handler converts to 403), or if the target isn't currently
// connected -- granting to a stale/typo'd UUID would otherwise leave the
// presenter role stuck on a non-existent client.
SSEBroadcaster.prototype.grantPresenter = function(adminClientId, targetClientId) {
	if(!this.mainClientId || adminClientId !== this.mainClientId) return false;
	if(!targetClientId) return false;
	if(!this.isClientConnected(targetClientId)) return false;
	var targetUsername = this.findUsernameFor(targetClientId);
	return this.claimPresenter(targetClientId, targetUsername);
};

// Snapshot of currently-connected clients for the admin UI's polling.
SSEBroadcaster.prototype.getClients = function() {
	var out = [];
	this.clients.forEach(function(c, clientId) {
		out.push({ clientId: clientId, username: c.username || null });
	});
	return out;
};

SSEBroadcaster.prototype.broadcast = function(eventName, payload) {
	var event = {
		id: this.nextId++,
		eventName: eventName,
		payload: payload
	};
	this.ring.push(event);
	if(this.ring.length > this.ringSize) {
		this.ring.shift();
	}
	var formatted = formatEvent(event);
	this.clients.forEach(function(c) {
		try {
			c.res.write(formatted);
		} catch(e) {
			// stale write; close handler will reap the client
		}
	});
};

function formatEvent(event) {
	return "id: " + event.id + "\n"
		+ "event: " + event.eventName + "\n"
		+ "data: " + JSON.stringify(event.payload) + "\n\n";
}

// Used for hello/cache-miss: SSE spec says events without `id:` do not advance
// the client cursor, so they can't poison Last-Event-ID on reconnect.
function formatEventNoId(eventName, payload) {
	return "event: " + eventName + "\n"
		+ "data: " + JSON.stringify(payload) + "\n\n";
}

SSEBroadcaster.prototype.sendHeartbeat = function() {
	this.clients.forEach(function(c) {
		try {
			c.res.write(": keep-alive\n\n");
		} catch(e) {}
	});
};

SSEBroadcaster.prototype.writeHello = function(response, clientId) {
	try {
		response.write(":\n\n");
		response.write(formatEventNoId("hello", {
			serverInstanceId: this.serverInstanceId,
			inlineThreshold: this.getInlineThreshold(),
			mode: this.getMode(),
			presenterClientId: this.presenterClientId,
			presenterUsername: this.presenterUsername,
			mainClientId: this.mainClientId,
			mainUsername: this.mainUsername,
			assignedClientId: clientId
		}));
	} catch(e) {
		// stale write; close handler will reap the client
	}
};

// Replay any events the client missed if it sent Last-Event-ID. Within the
// ring window the missed events go out in order; outside the window the
// client gets `cache-miss` and is expected to do a full sync.
SSEBroadcaster.prototype.replayFromLastEventId = function(request, response) {
	var rawLastId = request.headers["last-event-id"];
	var lastEventId = parseInt(rawLastId || "", 10);
	if(isNaN(lastEventId) || lastEventId <= 0 || this.ring.length === 0) return;
	try {
		var oldestRingId = this.ring[0].id;
		if(oldestRingId > lastEventId + 1) {
			response.write(formatEventNoId("cache-miss", {
				lastEventId: lastEventId,
				message: "Reconnect window expired - perform full sync"
			}));
			return;
		}
		for(var i = 0; i < this.ring.length; i++) {
			if(this.ring[i].id > lastEventId) {
				response.write(formatEvent(this.ring[i]));
			}
		}
	} catch(e) {
		// stale write; close handler will reap the client
	}
};

SSEBroadcaster.prototype.addClient = function(request, response, username) {
	var self = this;
	if(this.clients.size >= MAX_CONNECTIONS) {
		response.writeHead(503, {"Content-Type": "text/plain"});
		response.end("Too many SSE connections\n");
		return;
	}
	// Server-issued clientId. Browsers cannot supply their own (a `?clientId=`
	// query param is ignored at the route layer); the assigned id is returned
	// in the hello payload so the adaptor can adopt it. Role routes 401 any
	// X-MCP-Client-Id that isn't bound to a live connection here.
	var clientId = require("crypto").randomUUID();
	response.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no"
	});
	this.clients.set(clientId, { res: response, username: username || null });
	// "close" fires for both graceful (browser tab refresh, EventSource.close())
	// and abnormal (network drop) terminations. Idempotent role releases mean
	// it's safe even if the event somehow fires twice.
	request.on("close", function() {
		self.clients.delete(clientId);
		// If the disconnecting tab held the presenter role, clear it so a
		// remaining tab can claim. Last-wins on the next claim.
		if(clientId === self.presenterClientId) {
			self.releasePresenter(null);
		}
		if(clientId === self.mainClientId) {
			self.releaseMain(null);
		}
	});
	this.writeHello(response, clientId);
	this.replayFromLastEventId(request, response);
};

exports.SSEBroadcaster = SSEBroadcaster;

exports.initialize = function(wiki) {
	if(!$tw.mcp) {
		$tw.mcp = {};
	}
	if(!$tw.mcp.sse) {
		$tw.mcp.sse = new SSEBroadcaster(wiki);
		$tw.mcp.sseEnabled = true;
	}
	return $tw.mcp.sse;
};
