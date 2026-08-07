#!/usr/bin/env node

// Dependency-free MCP proxy packaged with the TypeR Codex plugin. The TypeR
// Photoshop panel owns the authenticated localhost bridge; this process only
// translates MCP stdio calls to that bridge.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_NAME = "typer-mcp";
const SERVER_VERSION = "1.0.0";
const RPC_TIMEOUT_MS = Math.max(10_000, Number(process.env.TYPER_MCP_TOOL_TIMEOUT_MS) || 130_000);
const DISCOVERY_PATH = process.env.TYPER_MCP_DISCOVERY || path.join(os.tmpdir(), "typer-mcp-bridge.json");
const BRIDGE_ERROR = "TypeR bridge not running. Open Photoshop with the TypeR panel (v3.1+) and retry.";

const object = (properties = {}, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const string = (description, extra = {}) => ({ type: "string", description, ...extra });
const number = (description, extra = {}) => ({ type: "number", description, ...extra });
const integer = (description, extra = {}) => ({ type: "integer", description, ...extra });
const boolean = (description) => ({ type: "boolean", description });
const bounds = object({
  left: number("Left edge in document pixels."),
  top: number("Top edge in document pixels."),
  right: number("Right edge in document pixels."),
  bottom: number("Bottom edge in document pixels."),
}, ["left", "top", "right", "bottom"]);
const profile = string("TextShapeR profile.", { enum: ["balanced", "tall", "wide"] });
const styleProperties = {
  styleId: string("Existing style ID to update; omit to create."),
  name: string("Style name."),
  fontPostScriptName: string("Installed Photoshop PostScript font name."),
  fontFamily: string("Installed font family."),
  fontStyle: string("Font face/style."),
  fontSize: number("Font size.", { exclusiveMinimum: 0 }),
  alignment: string("Paragraph alignment.", { enum: ["left", "center", "right", "justifyAll", "justifyLeft", "justifyCenter", "justifyRight"] }),
  color: object({ r: number("Red.", { minimum: 0, maximum: 255 }), g: number("Green.", { minimum: 0, maximum: 255 }), b: number("Blue.", { minimum: 0, maximum: 255 }) }, ["r", "g", "b"]),
  pointText: boolean("Use Photoshop point text."),
  select: boolean("Select the saved style; defaults to true."),
};
const batchEntry = object({
  bounds,
  lineIndex: integer("Raw TypeR script line index."),
  text: string("Explicit text; overrides lineIndex."),
  styleId: string("TypeR style ID override."),
  autoShape: boolean("Run TextShapeR for this bubble."),
  forceShape: boolean("Reshape text containing explicit line breaks."),
  allowHyphenation: boolean("Allow TextShapeR hyphenation."),
  profile,
}, ["bounds"]);

const specs = [
  ["typer_status", "status", "Check the TypeR bridge and return current line, style, direction, and page counts. Call this first.", object(), "status"],
  ["typer_get_state", "get_state", "Read TypeR script state, cursor, styles, settings, image mappings, and usable lines.", object({ includeText: boolean("Include the full raw TextBlock script.") })],
  ["typer_set_script", "set_text", "Replace the complete TypeR TextBlock script.", object({ text: string("Full script, one dialogue per line with optional Page markers and style prefixes.") }, ["text"])],
  ["typer_set_current_line", "set_current_line", "Select a raw TextBlock line index.", object({ rawIndex: integer("Raw script line index.", { minimum: 0 }) }, ["rawIndex"])],
  ["typer_next_line", "next_line", "Advance to the next TextBlock line.", object()],
  ["typer_prev_line", "prev_line", "Move to the previous TextBlock line.", object()],
  ["typer_get_styles", "get_styles", "List TypeR styles with IDs, prefixes, font, size, alignment, color, and point-text mode.", object()],
  ["typer_select_style", "select_style", "Select a TypeR style for subsequent operations.", object({ styleId: string("Style ID returned by typer_get_styles.") }, ["styleId"])],
  ["typer_search_fonts", "search_fonts", "Search fonts installed in Photoshop by family, face, name, or PostScript name.", object({ query: string("Case-insensitive search."), limit: integer("Maximum results.", { minimum: 1, maximum: 100 }) })],
  ["typer_preview_fonts", "preview_fonts", "Render a visual contact sheet with the actual installed Photoshop fonts so their tone, weight, width, and readability can be compared.", object({ fontPostScriptNames: { type: "array", minItems: 1, maxItems: 24, items: { type: "string" }, description: "Ordered shortlist returned by typer_search_fonts." }, query: string("Alternative search when no shortlist is provided."), text: string("Contextual sample dialogue to render.", { maxLength: 500 }), limit: integer("Maximum fonts.", { minimum: 1, maximum: 24 }), columns: integer("Sheet columns.", { minimum: 1, maximum: 3 }), fontSize: integer("Sample size in pixels.", { minimum: 18, maximum: 96 }), width: integer("Output image width.", { minimum: 700, maximum: 2400 }), uppercase: boolean("Render uppercase."), theme: string("Sheet theme.", { enum: ["light", "dark"] }) }), "image"],
  ["typer_save_style", "save_style", "Create a TypeR style or update one by ID using an installed Photoshop font.", object(styleProperties)],
  ["typer_get_document", "document_info", "Read the active Photoshop document, dimensions, save state, and active layer.", object()],
  ["typer_get_page_image", "get_snapshot", "Render the active Photoshop page for visual inspection.", object({ maxDim: integer("Maximum rendered dimension.", { minimum: 300, maximum: 4000 }) }), "image"],
  ["typer_detect_bubbles", "detect_bubbles", "Detect and order speech bubbles, returning document bounds and suggested script lines.", object({ sensitivity: integer("Detector sensitivity 1-10.", { minimum: 1, maximum: 10 }), rtl: boolean("Order right-to-left."), maxDim: integer("Maximum snapshot dimension.", { minimum: 300, maximum: 4000 }) })],
  ["typer_typeset_bubbles", "batch_paste", "Dry-run or create centered text layers for a whole page with automatic TextShapeR shaping.", object({ entries: { type: "array", minItems: 1, items: batchEntry, description: "One entry per bubble." }, pointText: boolean("Override point/paragraph text."), padding: number("Inner padding.", { minimum: 0 }), advanceLines: boolean("Advance the TextBlock cursor."), autoShape: boolean("Run TextShapeR by default."), allowHyphenation: boolean("Allow hyphenation."), profile, dryRun: boolean("Compute placements without changing Photoshop.") }, ["entries"])],
  ["typer_paste_text", "paste_text", "Paste one styled text layer into explicit bounds or the current Photoshop selection.", object({ text: string("Text to paste."), styleId: string("TypeR style ID."), bounds, pointText: boolean("Override point/paragraph text."), padding: number("Inner padding.", { minimum: 0 }) }, ["text"])],
  ["typer_apply_text", "apply_to_active", "Apply text and/or a TypeR style to the active Photoshop text layer.", object({ text: string("Replacement text."), styleId: string("Style ID to apply.") })],
  ["typer_align", "align_active", "Automatically center a text layer inside explicit bubble bounds or the current selection.", object({ layerId: integer("Optional Photoshop layer ID to target."), resizeTextBox: boolean("Resize paragraph text before centering."), padding: number("Inner padding.", { minimum: 0 }), bounds })],
  ["typer_nudge_layer", "nudge_layer", "Manually correct optical centering by moving a text layer in document pixels; positive X moves right and positive Y moves down.", object({ layerId: integer("Photoshop layer ID returned by typer_get_layers."), deltaX: number("Horizontal offset in document pixels; positive moves right."), deltaY: number("Vertical offset in document pixels; positive moves down.") }, ["layerId"])],
  ["typer_change_text_size", "change_text_size", "Grow or shrink a targeted text layer by a signed size delta.", object({ layerId: integer("Optional Photoshop layer ID to target."), delta: number("Signed font-size delta.") }, ["delta"])],
  ["typer_shape_text", "shape_text", "Generate ranked TextShapeR line-break variants for a bubble shape.", object({ text: string("Dialogue text."), width: number("Bubble width.", { exclusiveMinimum: 0 }), height: number("Bubble height.", { exclusiveMinimum: 0 }), limit: integer("Maximum variants.", { minimum: 1, maximum: 12 }), allowHyphenation: boolean("Allow hyphenation."), manualLineCount: integer("Force a line count.", { minimum: 1 }), profile, shapeProfile: { type: "object", description: "Normalized bubble outline rows." } }, ["text"])],
  ["typer_preview_text_shapes", "preview_text_shapes", "Render TextShapeR variants in the actual TypeR font and size, overlaid on the real Photoshop bubble crop when bounds are supplied.", object({ text: string("Dialogue; omit when lineIndex is supplied."), lineIndex: integer("Raw TypeR line index.", { minimum: 0 }), styleId: string("TypeR style override."), bounds, width: number("Bubble width without bounds.", { exclusiveMinimum: 0 }), height: number("Bubble height without bounds.", { exclusiveMinimum: 0 }), shapeProfile: { type: "object", description: "Normalized bubble outline rows." }, shapeSamples: integer("Outline sample rows.", { minimum: 7, maximum: 31 }), limit: integer("Variants on the sheet.", { minimum: 2, maximum: 12 }), allowHyphenation: boolean("Allow hyphenation."), profile, fontSize: number("Preview size override.", { minimum: 6, maximum: 300 }), lineHeight: number("Line-height multiplier.", { minimum: 0.8, maximum: 1.8 }), columns: integer("Sheet columns.", { minimum: 1, maximum: 3 }), sheetWidth: integer("Output width.", { minimum: 800, maximum: 2400 }), theme: string("Sheet theme.", { enum: ["light", "dark"] }), maxDim: integer("Page snapshot maximum dimension.", { minimum: 600, maximum: 3000 }) }), "image"],
  ["typer_get_layers", "get_layers", "List rendered Photoshop text layers with stable IDs, text, bounds, and optional surrounding bubbles.", object({ scanBubbles: boolean("Scan the bubble around each layer; slower.") })],
  ["typer_select_layer", "select_layer", "Select a Photoshop text layer by stable ID.", object({ layerId: integer("Layer ID returned by typer_get_layers.") }, ["layerId"])],
  ["typer_edit_layer", "edit_layer", "Edit, restyle, reshape, and re-center one Photoshop text layer by ID.", object({ layerId: integer("Photoshop layer ID."), text: string("Replacement text."), styleId: string("TypeR style ID."), autoShape: boolean("Run TextShapeR."), allowHyphenation: boolean("Allow hyphenation."), profile, align: boolean("Re-center after editing."), resizeTextBox: boolean("Resize paragraph text box."), padding: number("Inner padding.", { minimum: 0 }) }, ["layerId"])],
  ["typer_next_page", "next_page", "Advance to the next Page marker and open its mapped PSD/image.", object()],
  ["typer_previous_page", "previous_page", "Return to the previous Page marker and open its mapped PSD/image.", object()],
  ["typer_open_image", "open_image", "Open an explicit Photoshop file or a page from TypeR's mapped image list.", object({ path: string("Absolute PSD/image path."), page: integer("Mapped page number.") })],
  ["typer_save_document", "save_document", "Save the active layered PSD, optionally to another path or as a copy.", object({ path: string("Optional destination PSD path."), asCopy: boolean("Save as copy.") })],
  ["typer_deselect", "deselect", "Clear the active Photoshop selection.", object()],
  ["typer_undo", "undo", "Undo the last TypeR Photoshop change.", object()],
];

const readOnly = new Set(["typer_status", "typer_get_state", "typer_get_styles", "typer_search_fonts", "typer_preview_fonts", "typer_get_document", "typer_get_page_image", "typer_detect_bubbles", "typer_get_layers", "typer_shape_text", "typer_preview_text_shapes"]);
const tools = specs.map(([name, , description, inputSchema]) => ({
  name,
  title: name.replace(/^typer_/, "TypeR: ").replaceAll("_", " "),
  description,
  inputSchema,
  annotations: { readOnlyHint: readOnly.has(name), destructiveHint: false, openWorldHint: false },
}));
const specByName = new Map(specs.map((spec) => [spec[0], spec]));

function readDiscovery() {
  try {
    const info = JSON.parse(fs.readFileSync(DISCOVERY_PATH, "utf8"));
    if (typeof info.port !== "number" || typeof info.token !== "string") throw new Error();
    return info;
  } catch {
    throw new Error(BRIDGE_ERROR);
  }
}

async function requestBridge(route, options = {}) {
  const info = readDiscovery();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${info.port}${route}`, { ...options, signal: controller.signal });
    if (response.status === 403) throw new Error("TypeR bridge rejected a stale token. Reload the TypeR panel and retry.");
    if (!response.ok) throw new Error(`TypeR bridge returned HTTP ${response.status}.`);
    return await response.json();
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("TypeR bridge timed out while Photoshop was processing the operation.");
    if (error?.message?.startsWith("TypeR bridge")) throw error;
    throw new Error(BRIDGE_ERROR);
  } finally {
    clearTimeout(timer);
  }
}

async function callBridge(command, params = {}) {
  const { token } = readDiscovery();
  const body = await requestBridge("/rpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-TypeR-Token": token },
    body: JSON.stringify({ command, params }),
  });
  if (body?.ok !== true) throw new Error(body?.error || `TypeR command ${command} failed.`);
  return body.result;
}

const textContent = (value) => ({ type: "text", text: JSON.stringify(value, null, 2) });

async function callTool(name, args) {
  const spec = specByName.get(name);
  if (!spec) throw new Error(`Unknown TypeR tool: ${name}`);
  const [, command, , , mode] = spec;
  if (mode === "status") {
    const [health, status] = await Promise.all([requestBridge("/health"), callBridge(command, args)]);
    return { content: [textContent({ health, status })], structuredContent: { health, status } };
  }
  const result = await callBridge(command, args);
  if (mode === "image") {
    const data = fs.readFileSync(result.path);
    const metadata = { ...result };
    delete metadata.path;
    return {
      content: [
        { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        textContent(metadata),
      ],
      structuredContent: metadata,
    };
  }
  return { content: [textContent(result)], structuredContent: result };
}

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

async function respond(message) {
  if (!message || message.jsonrpc !== "2.0" || message.id === undefined) return;
  try {
    let result;
    if (message.method === "initialize") {
      result = {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: "Call typer_status first. Inspect the page and detections. Reuse project styles; visually compare new fonts with typer_preview_fonts. Compare line-break layouts with typer_preview_text_shapes using real bubble bounds, then dry-run, apply the chosen breaks, review, repair size and optical centering with targeted layer tools, save, and advance.",
      };
    } else if (message.method === "ping") {
      result = {};
    } else if (message.method === "tools/list") {
      result = { tools };
    } else if (message.method === "tools/call") {
      result = await callTool(message.params?.name, message.params?.arguments || {});
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } });
      return;
    }
    send({ jsonrpc: "2.0", id: message.id, result });
  } catch (error) {
    if (message.method === "tools/call") {
      send({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: error?.message || String(error) }], isError: true } });
    } else {
      send({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: error?.message || String(error) } });
    }
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let newline = buffer.indexOf("\n");
  while (newline !== -1) {
    const line = buffer.slice(0, newline).trim();
    buffer = buffer.slice(newline + 1);
    if (line) {
      try {
        void respond(JSON.parse(line));
      } catch {
        send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
      }
    }
    newline = buffer.indexOf("\n");
  }
});
