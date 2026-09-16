/*\
title: $:/core/modules/commands/inspect/lsp/lsp-watch.js
type: application/javascript
module-type: library

Keeps a wiki the editor started in step with its folders: tiddler files a
running dev server writes for MCP tools and browser edits are read in as they
change, since this process has its own copy of the wiki.

\*/

"use strict";

var fs = $tw.node ? require("fs") : null,
	path = $tw.node ? require("path") : null;

var reload = require("$:/core/modules/commands/inspect/lsp/lsp-reload.js");

// A save arrives as several events, and the first can find the file half written.
var DEBOUNCE_MS = 100;
// Windows refuses to read a file another process is still writing.
var RETRY_CODES = ["EBUSY", "EPERM", "EACCES", "ENOENT"];
var MAX_ATTEMPTS = 5;
var META_SUFFIX = ".meta";
var NOT_TIDDLERS = ["tiddlywiki.files", "plugin.info"];

// The outermost folders holding the wiki's files, so each is watched once.
function watchRoots(tiddlersPath, filepaths) {
	var dirs = (tiddlersPath ? [path.resolve(tiddlersPath)] : []).concat(filepaths.map(function(filepath) {
		return path.dirname(path.resolve(filepath));
	}));
	return dirs.filter(function(dir, index) {
		return dirs.indexOf(dir) === index && !dirs.some(function(other) {
			return isInside(dir, other);
		});
	});
}

function isInside(dir, ancestor) {
	var relative = path.relative(ancestor, dir);
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// Boot skips these names wherever they appear, so they never were tiddlers.
function isExcluded(filepath) {
	return path.resolve(filepath).split(path.sep).some(function(name, index, names) {
		return $tw.boot.excludeRegExp.test(name) || (index === names.length - 1 && NOT_TIDDLERS.includes(name));
	});
}

// Reads one changed path into the wiki and returns the titles it touched, or null
// when the path is not a file of the wiki's.
function fileChanged(filepath) {
	if(filepath.endsWith(META_SUFFIX)) {
		filepath = filepath.slice(0, -META_SUFFIX.length);
	}
	if(isExcluded(filepath)) {
		return null;
	}
	var stat = fs.statSync(filepath, { throwIfNoEntry: false });
	if(!stat) {
		return reload.forgetFile(filepath);
	}
	return stat.isFile() ? reload.reloadFile(filepath) : null;
}

function startWatching(options) {
	options = options || {};
	var log = options.log || function() {},
		filepaths = Object.keys($tw.boot.files || {}).map(function(title) {
			return $tw.boot.files[title].filepath;
		}).filter(Boolean),
		roots = watchRoots($tw.boot.wikiTiddlersPath, filepaths).filter(function(dir) {
			return fs.existsSync(dir);
		}),
		timers = Object.create(null);

	function schedule(filepath, attempt) {
		clearTimeout(timers[filepath]);
		timers[filepath] = setTimeout(function() {
			delete timers[filepath];
			var titles;
			try {
				titles = fileChanged(filepath);
			} catch(err) {
				if(!RETRY_CODES.includes(err.code)) {
					throw err;
				}
				if(attempt + 1 < MAX_ATTEMPTS) {
					schedule(filepath, attempt + 1);
				} else {
					log("Could not read " + filepath + ": " + err.message);
				}
				return;
			}
			if(titles && titles.length) {
				log("Reloaded from disk: " + titles.join(", "));
			}
		}, DEBOUNCE_MS);
	}

	var watchers = roots.map(function(root) {
		var watcher = fs.watch(root, { recursive: true }, function(eventType, filename) {
			if(filename) {
				schedule(path.join(root, filename.toString()), 0);
			}
		});
		watcher.on("error", function(err) {
			log("Stopped watching " + root + ": " + err.message);
		});
		// The pipe keeps the process alive; a watcher alone must not.
		watcher.unref();
		return watcher;
	});

	return {
		roots: roots,
		close: function() {
			watchers.forEach(function(watcher) {
				watcher.close();
			});
			Object.keys(timers).forEach(function(filepath) {
				clearTimeout(timers[filepath]);
			});
		}
	};
}

exports.watchRoots = watchRoots;
exports.fileChanged = fileChanged;
exports.startWatching = startWatching;
