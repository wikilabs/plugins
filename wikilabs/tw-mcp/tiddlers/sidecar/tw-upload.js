#!/usr/bin/env node

/*
tw-upload: CLI tool to upload binary files to a running TiddlyWiki MCP server.

Connects to the MCP server via named pipe, reads an image (JPG, PNG, GIF)
or PDF file, base64-encodes it, and calls the upload_file tool.

Usage:
  node tw-upload.js <file> [--wiki <path>] [--title <title>] [--tags <tags>] [--subfolder <dir>]

Examples:
  node tw-upload.js photo.png --wiki ./editions/tw5.com
  node tw-upload.js doc.pdf --title "My Document" --tags "docs reference"
  node tw-upload.js icon.gif --subfolder images

The --wiki option specifies the wiki directory to find the .tw-mcp/connect discovery file.
If omitted, the current directory is used.
*/

"use strict";

var fs = require("fs");
var path = require("path");
var net = require("net");

// Allowed file types
var ALLOWED_TYPES = {
	".png":  "image/png",
	".jpg":  "image/jpeg",
	".jpeg": "image/jpeg",
	".gif":  "image/gif",
	".pdf":  "application/pdf"
};

var MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

// Strip terminal escape sequences from server responses to prevent terminal injection
function sanitizeOutput(text) {
	if(typeof text !== "string") return "";
	// Remove ANSI escape codes and other control characters (keep newlines and tabs)
	return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|\x1B\[[0-9;]*[a-zA-Z]|\x1B\].*?\x07/g, "");
}

function parseArgs(argv) {
	var args = { file: null, wiki: ".", title: null, tags: null, subfolder: null };
	var i = 2; // skip node and script
	while(i < argv.length) {
		switch(argv[i]) {
			case "--wiki":
				args.wiki = argv[++i];
				break;
			case "--title":
				args.title = argv[++i];
				break;
			case "--tags":
				args.tags = argv[++i];
				break;
			case "--subfolder":
				args.subfolder = argv[++i];
				break;
			case "--help":
			case "-h":
				printUsage();
				process.exit(0);
				break;
			default:
				if(!args.file && argv[i][0] !== "-") {
					args.file = argv[i];
				} else {
					console.error("Unknown option: " + argv[i]);
					process.exit(1);
				}
		}
		i++;
	}
	return args;
}

function printUsage() {
	console.log("Usage: tw-upload <file> [--wiki <path>] [--title <title>] [--tags <tags>] [--subfolder <dir>]");
	console.log("");
	console.log("Uploads a binary file (PNG, JPG, GIF, PDF) to a running TiddlyWiki MCP server.");
	console.log("Connects via named pipe (the MCP server must be running with --mcp).");
	console.log("");
	console.log("Options:");
	console.log("  --wiki <path>       Wiki directory to find .tw-mcp/connect (defaults to current dir)");
	console.log("  --title <title>     Tiddler title (defaults to filename)");
	console.log("  --tags <tags>       Space-separated tags for the tiddler");
	console.log("  --subfolder <dir>   Subfolder within files/ to save to");
	console.log("  -h, --help          Show this help message");
	console.log("");
	console.log("Supported formats: PNG, JPG, GIF, PDF (max 50MB)");
}

function sendJsonRpc(socket, id, method, params) {
	var msg = JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} });
	socket.write(msg + "\n");
}

function main() {
	var args = parseArgs(process.argv);

	if(!args.file) {
		console.error("Error: No file specified.");
		printUsage();
		process.exit(1);
	}

	// Validate file exists
	var filePath = path.resolve(args.file);
	if(!fs.existsSync(filePath)) {
		console.error("Error: File not found: " + filePath);
		process.exit(1);
	}

	// Validate file type
	var ext = path.extname(filePath).toLowerCase();
	var mimeType = ALLOWED_TYPES[ext];
	if(!mimeType) {
		console.error("Error: Unsupported file type '" + ext + "'. Allowed: " + Object.keys(ALLOWED_TYPES).join(", "));
		process.exit(1);
	}

	// Validate file size
	var stat = fs.statSync(filePath);
	if(stat.size > MAX_FILE_SIZE) {
		console.error("Error: File too large (" + Math.round(stat.size / 1024 / 1024) + "MB). Max: 50MB");
		process.exit(1);
	}

	// Discover pipe path
	var wikiPath = path.resolve(args.wiki);
	var discoveryFile = path.resolve(wikiPath, ".tw-mcp/connect");
	// Parse discovery file (JSON format: { "pipe": "...", "token": "..." })
	// Clients should ignore unknown fields for forward compatibility
	var pipePath, authToken;
	try {
		var discoveryContent = fs.readFileSync(discoveryFile, "utf8").trim();
		var discovery = JSON.parse(discoveryContent);
		pipePath = discovery.pipe;
		authToken = discovery.token;
		if(!pipePath || typeof pipePath !== "string") {
			throw new Error("missing 'pipe' field");
		}
		if(!authToken || typeof authToken !== "string") {
			throw new Error("missing 'token' field");
		}
	} catch(e) {
		if(e.code === "ENOENT") {
			console.error("\nNo MCP server found for wiki: " + wikiPath);
			console.error("\nThe .tw-mcp/connect discovery file does not exist.");
			console.error("Start the MCP server first:\n");
			console.error("  tiddlywiki +plugins/tiddlywiki/filesystem " + args.wiki + " --mcp\n");
		} else {
			console.error("\nCould not read .tw-mcp/connect: " + e.message);
			console.error("The file may be corrupted. Restart the MCP server:\n");
			console.error("  tiddlywiki +plugins/tiddlywiki/filesystem " + args.wiki + " --mcp\n");
		}
		process.exit(1);
	}

	// Validate that the pipe path is a local named pipe, not an arbitrary network address
	if(process.platform === "win32") {
		if(!pipePath.startsWith("\\\\.\\pipe\\")) {
			console.error("Error: Invalid pipe path — must be a Windows named pipe (\\\\.\\pipe\\...)");
			process.exit(1);
		}
	} else {
		if(!path.isAbsolute(pipePath)) {
			console.error("Error: Invalid pipe path — must be an absolute path to a Unix socket");
			process.exit(1);
		}
	}

	// Read and encode
	var filename = path.basename(filePath);
	console.log("Reading " + filename + " (" + Math.round(stat.size / 1024) + "KB, " + mimeType + ")...");
	var data = fs.readFileSync(filePath).toString("base64");

	// Connect to MCP server via named pipe
	console.log("Connecting to MCP server: " + pipePath);

	var socket = net.createConnection(pipePath, function() {
		console.log("Connected.");
		// Send initialize request with auth token
		sendJsonRpc(socket, 1, "initialize", {
			protocolVersion: "2025-03-26",
			capabilities: {},
			clientInfo: { name: "tw-upload", version: "1.0.0" },
			_auth_token: authToken
		});
	});

	var buffer = "";
	var messageCount = 0;

	socket.setEncoding("utf8");
	socket.on("data", function(chunk) {
		buffer += chunk;
		var lines = buffer.split("\n");
		buffer = lines.pop();
		lines.forEach(function(line) {
			line = line.trim();
			if(!line) return;
			try {
				var response = JSON.parse(line);
				messageCount++;
				if(messageCount === 1) {
					// Response to initialize — send notification, then upload
					sendJsonRpc(socket, null, "notifications/initialized");
					var toolArgs = {
						filename: filename,
						data: data,
						type: mimeType
					};
					if(args.title) toolArgs.title = args.title;
					if(args.tags) toolArgs.tags = args.tags;
					if(args.subfolder) toolArgs.subfolder = args.subfolder;
					console.log("Uploading...");
					sendJsonRpc(socket, 2, "tools/call", {
						name: "upload_file",
						arguments: toolArgs
					});
				} else if(messageCount === 2) {
					// Response to upload_file
					if(response.result && response.result.content) {
						response.result.content.forEach(function(c) {
							var text = sanitizeOutput(c.text);
							if(response.result.isError) {
								console.error("Error: " + text);
							} else {
								console.log(text);
							}
						});
					} else if(response.error) {
						console.error("MCP Error: " + sanitizeOutput(response.error.message));
					}
					socket.end();
				}
			} catch(e) {
				console.error("Warning: Failed to parse server response: " + e.message);
			}
		});
	});

	socket.on("error", function(err) {
		console.error("Connection error: " + err.message);
		if(err.code === "ENOENT" || err.code === "ECONNREFUSED") {
			console.error("Is the MCP server running? Start it with: tiddlywiki +plugins/tiddlywiki/filesystem <wiki> --mcp");
		}
		process.exit(1);
	});

	socket.on("close", function() {
		process.exit(0);
	});
}

main();
