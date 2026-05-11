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
		description: "Get tiddler fields. Default: metadata only. detailed:true adds text field as hashlines ('LINE#HASH: text' per line; pass anchors to edit_tiddler). format='tid': plain text. Plugin tiddlers return fields + shadow-tiddler tree (format/detailed ignored).",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "The tiddler title" },
				format: { type: "string", enum: ["tid", "json", "hashline"], default: "hashline", description: "hashline (default) — text with hash anchors for editing. tid — plain text. json — structured fields." },
				detailed: { type: "boolean", default: false, description: "Include the text field" }
			},
			required: ["title"]
		}
	},
	{
		name: "run_filter",
		description: "Execute TW filter expression. Returns titles, capped at 500 (output prefixed '(N total, showing first 500)' if truncated). Empty: '(no results)'. Filter max 10000 chars.",
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
		description: "Render tiddler to text/HTML. mode='raw' (default): type parser. mode='viewtemplate': $:/tags/ViewTemplateBodyFilter cascade — output depends on type/tags, may include framing widgets (e.g. code-mirror frame) for non-wikitext types instead of body content.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Tiddler title" },
				type: { type: "string", enum: ["text/plain", "text/plain-formatted", "text/html"], default: "text/plain-formatted" },
				mode: { type: "string", enum: ["raw", "viewtemplate"], default: "raw", description: "raw = type parser (default), viewtemplate = ViewTemplate body cascade" }
			},
			required: ["title"]
		}
	},
	{
		name: "render_field",
		description: "Render tiddler field or data tiddler index as wikitext. Errors on missing/empty (not silent empty).",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", description: "Tiddler title" },
				field: { type: "string", default: "text", description: "Field name (default: text)" },
				index: { type: "string", description: "Data tiddler index (alternative to field)" },
				output: { type: "string", enum: ["text/plain", "text/plain-formatted", "text/html"], default: "text/html", description: "Output type" }
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
		description: "Analyze rendered widget tree. Output: type counts, unique link targets, depth-limited JSON (depth=3, structural recursion only). Text nodes ≤10 chars shown verbatim; longer shown as '…N' (length only — leading ellipsis chosen because real text rarely starts with one). include:['text'] inlines text in full, but caps individual nodes at 2000 chars: above that, output is '…N:<first 100>…<last 100>' (head+tail sample with full length N) to prevent runaway. Children capped at 10/parent ('+N more'). exclude drops attributes.",
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
		description: "Render wikitext to HTML with source-position attrs + title index header. Header: [0=Title 1=Title ...]. Each node may carry p=\"idx:line\" or p=\"idx:start-end\" (idx→header, lines in defining tiddler), v=\"name\" (transcluded procedure/macro/variable that produced this node), c=\"A|B|C\" (caller chain — closest enclosing transclude first, outermost last), and ctx=\"Title\" (currentTiddler when it differs from the source-context tiddler — distinguishes repeated list items). Pair with inspect_scope.",
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
		description: "List tiddler titles as '/'-namespace tree with common-prefix header (NOT flat list). Filter flags mutually exclusive, priority: plugin > overwrittenShadows > tag > includeSystem (only highest applies). limit caps result.",
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
		description: "Re-read tiddlers from disk; reports diff vs last call (first call may show large initial set). scope='shadows': refreshes non-JS plugin subtiddlers (doc/wikitext/CSS) — does NOT re-execute plugin JS. For JS in tw-mcp plugin use reload_mcp_modules. Refreshes $:/config/OriginalTiddlerPaths when retain-original-tiddler-path is set.",
		inputSchema: {
			type: "object",
			properties: {
				scope: { type: "string", enum: ["tiddlers", "shadows", "all"], default: "tiddlers", description: "tiddlers = edition tiddlers on disk (default). shadows = re-register plugins and re-unpack shadow tiddlers from in-memory plugin JSON (does NOT re-read plugin folders from disk). all = both." }
			},
			required: []
		}
	},
	{
		name: "inspect_tw",
		description: "Read-only $tw navigation. path: dot-path (e.g. 'wiki.boot.wikiPath'); blocks __proto__/constructor/prototype. Objects → keys+types+values, depth auto-reduces above 10KB. Functions without call → signature + source (truncated; fullSource:true for full). Functions with call → invoked, gated by read-only safe-list ($tw.wiki.* getters/filters, $tw.utils.*, heartbeats; full list in error). Writes go through put_tiddler/edit_tiddler/delete_tiddler. Auto-resolve: object path + call[0]=methodName rewrites to path.method(...rest) before safe-list.",
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
		description: "Variable scope at a source position. tiddler+charPos OR text+charPos. charPos = char offset into wikitext text field, NOT line number — p= from inspect_pos is lines including header, must be converted via source text. Output: per-var line w/ kind prefix (widget/fn/proc/macro/def/var), name, params, value (≤70 chars), source. Sections: local scope, used globals (parse-tree refs + transitive macro body expansion), other globals (all:true). match: requires named vars to equal given values — disambiguates sibling widgets sharing parseTreeNode.start (repeating lists). renderContext: 'isolated' (default), 'viewtemplate' (tiddler-render context), 'root' (PageTemplate context).",
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
		description: "Create or update tiddler, persists to disk. overwrite=true replaces existing. WITHOUT overwrite: existing-title silently creates duplicate with uniquified title (e.g. 'MyTiddler 1') — does NOT error. Check response title; use overwrite=true or edit_tiddler when updating.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", maxLength: 1024, description: "Tiddler title (max 1024 chars)" },
				fields: { type: "object", description: "Tiddler fields (text, tags, type, etc.)", additionalProperties: true },
				overwrite: { type: "boolean", default: false }
			},
			required: ["title", "fields"]
		}
	},
	{
		name: "edit_tiddler",
		description: "Edit tiddler text and/or fields. Text edits via LINE#HASH anchors (e.g. '5#AB'); anchors come from get_tiddler. Stale anchors → HashlineMismatchError lists fresh anchors for retry. Fields via set_fields/delete_fields. One call covers both.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", maxLength: 1024, description: "Tiddler title (max 1024 chars)" },
				edits: {
					type: "array",
					description: "Text line edits using hashline anchors (optional if only changing fields)",
					items: {
						type: "object",
						properties: {
							op: { type: "string", enum: ["replace_line", "replace_range", "append_at", "prepend_at"] },
							pos: { type: "string", description: "LINE#HASH anchor (e.g. '5#AB')" },
							end: { type: "string", description: "End anchor for replace_range" },
							lines: { type: "array", items: { type: "string" }, description: "New lines to insert/replace" }
						},
						required: ["op", "lines"]
					}
				},
				set_fields: { type: "object", description: "Fields to add or update (key: value). Does not affect text field — use edits for text.", additionalProperties: true },
				delete_fields: { type: "array", items: { type: "string" }, description: "Field names to remove" }
			},
			required: ["title"]
		}
	},
	{
		name: "delete_tiddler",
		description: "Delete tiddler + .tid file. Shadow-only tiddlers (plugin-provided): removed from store only, no file touched, reappear on reload. Path gated by allowed-paths.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", maxLength: 1024, description: "Tiddler title (max 1024 chars)" }
			},
			required: ["title"]
		}
	},
	{
		name: "rename_tiddler",
		description: "Rename a tiddler: updates title field + moves on-disk file via FSP rules + removes the old file (and .meta sidecar if present). Cross-references inside other tiddlers are NOT touched (use replace_in_tiddlers). preserve_timestamps=true (default) keeps the original `modified` field; set false to bump it. WITHOUT overwrite: errors if `to` exists. Refuses bundled plugin/theme/language tiddlers and .multids entries.",
		inputSchema: {
			type: "object",
			properties: {
				from: { type: "string", maxLength: 1024, description: "Current tiddler title" },
				to: { type: "string", maxLength: 1024, description: "New tiddler title" },
				overwrite: { type: "boolean", default: false, description: "If true, replace an existing tiddler at `to`" },
				preserve_timestamps: { type: "boolean", default: true, description: "If true (default), keep the original `modified` field. Set false to set `modified` to now." }
			},
			required: ["from", "to"]
		}
	},
	{
		name: "reload_mcp_modules",
		description: "Hot-reload tw-mcp plugin. Re-reads plugin folder, refreshes ALL subtiddlers (JS + non-JS doc/wikitext/CSS), re-executes JS modules. Non-JS applies immediately; JS modules apply on next tool call. Excludes mcp.js/mcp-lib.js/shared.js/filesystem.js (hold live state — need server restart).",
		inputSchema: {
			type: "object",
			properties: {
				skip_disk_reload: { type: "boolean", default: false, description: "Skip the $tw.loadPlugin step. Use only when the wiki store already has fresh plugin source (e.g., after a manual reload_tiddlers)." }
			},
			required: []
		}
	},
	{
		name: "resave_tiddler",
		description: "Rewrite a tiddler's .tid file using current FileSystemPaths. Relocates the file if path rules changed. Preserves modified/modifier by default. Refuses on shadow-only, plugin/theme/language, or .multids-bundled tiddlers.",
		inputSchema: {
			type: "object",
			properties: {
				title: { type: "string", maxLength: 1024, description: "Tiddler title (max 1024 chars)" },
				preserve_timestamps: { type: "boolean", default: true, description: "Keep modified/modifier unchanged (default). Set false to stamp current time and user." },
				strip_redundant: { type: "boolean", default: true, description: "Drop 'revision' and drop 'type' when it equals text/vnd.tiddlywiki (default)." },
				dry_run: { type: "boolean", default: false, description: "Report old/new path and fields that would be stripped; do not write." }
			},
			required: ["title"]
		}
	},
	{
		name: "save_wiki_folder",
		description: "Export wiki to folder. filter selects tiddlers (default '[all[tiddlers]]'). explodePlugins='yes' (default): plugins as exploded subtiddler folders; 'no': single .json bundles. Path gated by allowed-paths.",
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
		description: "Render wiki as single HTML. Silently overwrites output, creates parent dirs. template = renderable tiddler (default '$:/core/save/all'); invalid template → empty output, not error. Verify result.",
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
		name: "import_html_wiki",
		description: "Stage a single-file HTML wiki for import. Loads tiddlers from the file into memory, classifies them, proposes FileSystemPaths rules, and writes the staged analysis to $:/temp/mcp/html-import. Nothing is written to disk yet — call extract_html_wiki to commit. Refuses if the wiki folder is already populated or another import is already pending.",
		inputSchema: {
			type: "object",
			properties: {
				path: { type: "string", description: "Path to the .html single-file wiki to import. Paths with `.`-prefixed directory or filename segments (e.g. `.ssh/`, `.config/`, `.env`) are refused as a defence-in-depth against reading hidden config." }
			},
			required: ["path"]
		}
	},
	{
		name: "extract_html_wiki",
		description: "Commit a previously staged HTML wiki import (see import_html_wiki) to disk as .tid files. Reads $:/config/FileSystemPaths from the wiki by default; the user can edit it in the browser before this call. Optionally override the rules via fileSystemPaths.",
		inputSchema: {
			type: "object",
			properties: {
				fileSystemPaths: { type: "string", description: "Approved FileSystemPaths rules (one filter per line). If omitted, reads $:/config/FileSystemPaths from the wiki." }
			},
			required: []
		}
	},
	{
		name: "upload_file",
		description: "Upload base64 file to files/, create canonical tiddler. tags = TW-format STRING (e.g. 'foo [[bar baz]]'), NOT array. Writes binary file + .tid sidecar with _canonical_uri.",
		inputSchema: {
			type: "object",
			properties: {
				filename: { type: "string", description: "Filename (no path separators)" },
				data: { type: "string", description: "Base64 content" },
				type: { type: "string", description: "MIME type" },
				title: { type: "string", maxLength: 1024, description: "Tiddler title (max 1024 chars; defaults to filename)" },
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
