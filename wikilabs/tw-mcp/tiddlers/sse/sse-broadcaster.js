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
var DEFAULT_INLINE_THRESHOLD = 4096;
var HEARTBEAT_MS = 25000;
var INLINE_THRESHOLD_TIDDLER = "$:/config/wikilabs/tw-mcp/sse-inline-threshold";
var SYNC_FILTER_TIDDLER = "$:/config/SyncFilter";
var DEFAULT_SYNC_FILTER = "[all[tiddlers]] -[[$:/isEncrypted]] -[prefix[$:/temp/]] -[prefix[$:/status/]] -[has[plugin-type]]";

var KNOWN_TIDDLYWEB_FIELDS = ["bag","created","creator","modified","modifier","permissions","recipe","revision","tags","text","title","type","uri"];

function SSEBroadcaster(wiki) {
	var self = this;
	this.wiki = wiki;
	this.clients = new Set();
	this.ring = [];
	this.ringSize = DEFAULT_RING_SIZE;
	this.nextId = 1;
	this.serverInstanceId = generateInstanceId();
	this.pendingOriginators = Object.create(null);
	var filterText = wiki.getTiddlerText(SYNC_FILTER_TIDDLER) || DEFAULT_SYNC_FILTER;
	this.filterFn = wiki.compileFilter(filterText);
	wiki.addEventListener("change", function(changes) {
		self.handleWikiChange(changes);
	});
	setInterval(function() {
		self.sendHeartbeat();
	}, HEARTBEAT_MS);
}

function generateInstanceId() {
	var crypto = require("crypto");
	return Date.now().toString(36) + "-" + crypto.randomBytes(4).toString("hex");
}

SSEBroadcaster.prototype.getInlineThreshold = function() {
	var raw = this.wiki.getTiddlerText(INLINE_THRESHOLD_TIDDLER);
	var n = parseInt(raw, 10);
	return (n > 0 && n < 1024 * 1024) ? n : DEFAULT_INLINE_THRESHOLD;
};

// Echo-suppression hooks. PUT/DELETE handlers (task 51z) call recordOriginator
// before addTiddler/deleteTiddler so the change event carries the clientId.
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

SSEBroadcaster.prototype.shouldSkipDelete = function(title) {
	return title.indexOf("$:/temp/") === 0
		|| title.indexOf("$:/state/") === 0
		|| title === "$:/HistoryList";
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

SSEBroadcaster.prototype.handleWikiChange = function(changes) {
	var self = this;
	var titles = Object.keys(changes);
	var allowed = this.applySyncFilter(titles);
	titles.forEach(function(title) {
		var change = changes[title];
		if(change.deleted) {
			if(self.shouldSkipDelete(title)) return;
			self.broadcast("tiddler-delete", {
				title: title,
				clientId: self.consumeOriginatorClientId(title)
			});
		} else {
			if(!allowed[title]) return;
			var tiddler = self.wiki.getTiddler(title);
			if(!tiddler) return;
			var fields = self.serializeTiddler(tiddler);
			var json = JSON.stringify(fields);
			var payload = {
				title: title,
				revision: self.wiki.getChangeCount(title).toString(),
				clientId: self.consumeOriginatorClientId(title)
			};
			if(json.length <= self.getInlineThreshold()) {
				payload.fields = fields;
			}
			self.broadcast("tiddler-change", payload);
		}
	});
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
	this.clients.forEach(function(client) {
		try {
			client.res.write(formatted);
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
	this.clients.forEach(function(client) {
		try {
			client.res.write(": keep-alive\n\n");
		} catch(e) {}
	});
};

SSEBroadcaster.prototype.addClient = function(request, response) {
	var self = this;
	response.writeHead(200, {
		"Content-Type": "text/event-stream; charset=utf-8",
		"Cache-Control": "no-cache, no-transform",
		"Connection": "keep-alive",
		"X-Accel-Buffering": "no"
	});
	var client = { res: response };
	this.clients.add(client);
	request.on("close", function() {
		self.clients.delete(client);
	});
	// Initial flush + hello
	response.write(":\n\n");
	response.write(formatEventNoId("hello", {
		serverInstanceId: this.serverInstanceId,
		inlineThreshold: this.getInlineThreshold()
	}));
	// Replay if Last-Event-ID was sent
	var rawLastId = request.headers["last-event-id"];
	var lastEventId = parseInt(rawLastId || "", 10);
	if(!isNaN(lastEventId) && lastEventId > 0 && this.ring.length > 0) {
		var oldestRingId = this.ring[0].id;
		if(oldestRingId > lastEventId + 1) {
			response.write(formatEventNoId("cache-miss", {
				lastEventId: lastEventId,
				message: "Reconnect window expired - perform full sync"
			}));
		} else {
			for(var i = 0; i < this.ring.length; i++) {
				if(this.ring[i].id > lastEventId) {
					response.write(formatEvent(this.ring[i]));
				}
			}
		}
	}
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
