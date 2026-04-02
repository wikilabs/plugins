/*\
title: $:/core/modules/commands/inspect/mcp-tools.js
type: application/javascript
module-type: library

MCP tool definitions (input schemas) for TiddlyWiki MCP server.

\*/

"use strict";

var readTools = [
	{
		name: "get_tiddler",
		description: "Get a tiddler's fields by title. Returns metadata only by default; set detailed=true to include the text field.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "The tiddler title" },
				format: { type: "string", enum: ["tid", "json"], default: "tid" },
				detailed: { type: "boolean", default: false, description: "Include the text field" }
			},
			required: ["title"]
		}
	},
	{
		name: "run_filter",
		description: "Execute a TiddlyWiki filter expression. Returns matching titles.",
		inputSchema: {
			type: "object",
			properties: {
				filter: { type: "string", description: "TiddlyWiki filter expression" }
			},
			required: ["filter"]
		}
	},
	{
		name: "render_tiddler",
		description: "Render a tiddler to plain text or HTML.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Tiddler title" },
				type: { type: "string", enum: ["text/plain", "text/plain-formatted", "text/html"], default: "text/plain-formatted" }
			},
			required: ["title"]
		}
	},
	{
		name: "render_text",
		description: "Render wikitext to plain text, HTML, or parse tree. Full macro/procedure context.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string", description: "Wikitext to render" },
				type: { type: "string", default: "text/vnd.tiddlywiki", description: "Input type" },
				output: { type: "string", enum: ["text/plain", "text/plain-formatted", "text/html", "parsetree"], default: "text/plain", description: "Output type" },
				context: { type: "string", description: "Context tiddler (sets currentTiddler)" },
				exclude: { type: "array", items: { type: "string" }, description: "Keys to omit from parsetree" },
				include: { type: "array", items: { type: "string" }, description: "Keys to unfold in parsetree" }
			},
			required: ["text"]
		}
	},
	{
		name: "inspect_tree",
		description: "Analyze rendered widget tree: type counts, links, transclusions, depth-limited JSON.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string", description: "Wikitext to analyze" },
				type: { type: "string", default: "text/vnd.tiddlywiki" },
				context: { type: "string", description: "Context tiddler" },
				exclude: { type: "array", items: { type: "string" }, description: "Attributes to omit" },
				include: { type: "array", items: { type: "string" }, description: "Keys to unfold" },
				depth: { type: "number", default: 3, description: "Max tree depth" }
			},
			required: ["text"]
		}
	},
	{
		name: "inspect_pos",
		description: "Render wikitext to HTML with data-source-pos attributes (file-ready line numbers). Use with inspect_scope.",
		inputSchema: {
			type: "object",
			properties: {
				text: { type: "string", description: "Wikitext to render" },
				type: { type: "string", default: "text/vnd.tiddlywiki" },
				context: { type: "string", description: "Context tiddler" }
			},
			required: ["text"]
		}
	},
	{
		name: "get_wiki_info",
		description: "Wiki metadata: title, version, tiddler counts, plugins, themes, settings.",
		inputSchema: {
			type: "object",
			properties: {},
			required: []
		}
	},
	{
		name: "list_tiddlers",
		description: "List tiddler titles grouped by namespace. Filter by tag, plugin, or overwritten shadows.",
		inputSchema: {
			type: "object",
			properties: {
				tag: { type: "string", description: "Filter by tag" },
				plugin: { type: "string", description: "List plugin subtiddlers" },
				overwrittenShadows: { type: "boolean", default: false },
				limit: { type: "number", default: 100 },
				includeSystem: { type: "boolean", default: false }
			},
			required: []
		}
	},
	{
		name: "reload_tiddlers",
		description: "Re-read tiddlers from disk + report changes since last call.",
		inputSchema: {
			type: "object",
			properties: {},
			required: []
		}
	},
	{
		name: "inspect_tw",
		description: "Navigate $tw object. Returns keys with types/values at the given path.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", default: "", description: "Dot path (e.g. 'wiki', 'boot.wikiPath')" },
				call: { type: "array", items: { type: "string" }, description: "Call function with args" },
				depth: { type: "number", default: 1 },
				fullSource: { type: "boolean", default: false },
				exclude: { type: "array", items: { type: "string" }, description: "Keys to skip" }
			},
			required: []
		}
	},
	{
		name: "inspect_scope",
		description: "Variable scope at a source position. Shows local vars and used globals. Use data-source-pos from inspect_pos.",
		inputSchema: {
			type: "object",
			properties: {
				tiddler: { type: "string", description: "Tiddler title" },
				charPos: { type: "number", description: "Character position in text field" },
				text: { type: "string", description: "Wikitext instead of tiddler" },
				context: { type: "string", description: "Context tiddler" },
				match: { type: "object", description: "Match widget by variable values", additionalProperties: { type: "string" } },
				filter: { type: "string", description: "Substring filter" },
				limit: { type: "number", default: 20 },
				all: { type: "boolean", default: false, description: "Include unused globals" },
				renderContext: { type: "string", enum: ["isolated", "viewtemplate", "root"], default: "isolated" }
			},
			required: []
		}
	}
];

var writeTools = [
	{
		name: "put_tiddler",
		description: "Create or update a tiddler. Persists to disk. Set overwrite=true to replace existing.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" },
				fields: { type: "object", description: "Tiddler fields (text, tags, type, etc.)", additionalProperties: true },
				overwrite: { type: "boolean", default: false }
			},
			required: ["title", "fields"]
		}
	},
	{
		name: "delete_tiddler",
		description: "Delete a tiddler and its .tid file.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string" }
			},
			required: ["title"]
		}
	},
	{
		name: "save_wiki_folder",
		description: "Export wiki as a folder structure.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Output directory" },
				filter: { type: "string", default: "[all[tiddlers]]" },
				explodePlugins: { type: "string", enum: ["yes", "no"], default: "yes" }
			},
			required: ["path"]
		}
	},
	{
		name: "build_wiki",
		description: "Render wiki as a single HTML file.",
		inputSchema: {
			type: "object",
			properties: {
				output: { type: "string", description: "Output file path" },
				template: { type: "string", default: "$:/core/save/all" }
			},
			required: ["output"]
		}
	},
	{
		name: "upload_file",
		description: "Upload base64 file to files/ and create a canonical tiddler.",
		inputSchema: {
			type: "object",
			properties: {
				filename: { type: "string", description: "Filename (no path separators)" },
				data: { type: "string", description: "Base64 content" },
				type: { type: "string", description: "MIME type" },
				title: { type: "string", description: "Tiddler title (defaults to filename)" },
				tags: { type: "string" },
				subfolder: { type: "string", description: "Subfolder in files/" }
			},
			required: ["filename", "data", "type"]
		}
	}
];

function getToolDefinitions(isReadonly) {
	if(isReadonly) {
		return readTools;
	}
	return readTools.concat(writeTools);
}

exports.readTools = readTools;
exports.writeTools = writeTools;
exports.getToolDefinitions = getToolDefinitions;
