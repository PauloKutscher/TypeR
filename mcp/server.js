#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const DISCOVERY_PATH =
  process.env.TYPER_MCP_DISCOVERY || path.join(os.tmpdir(), "typer-mcp-bridge.json");

const RPC_TIMEOUT_MS = 130_000;

const BRIDGE_NOT_RUNNING_MESSAGE =
  "TypeR bridge not running. Open Photoshop with the TypeR panel (v3.1+) and retry.";

class BridgeUnavailableError extends Error {}

function readDiscovery() {
  let raw;
  try {
    raw = fs.readFileSync(DISCOVERY_PATH, "utf8");
  } catch {
    throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
  }
  try {
    const info = JSON.parse(raw);
    if (!info || typeof info.port !== "number" || typeof info.token !== "string") {
      throw new Error("malformed discovery file");
    }
    return info;
  } catch {
    throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
  }
}

/**
 * Calls the TypeR HTTP bridge's POST /rpc endpoint with the given command/params.
 * Re-reads the discovery file on every call so a rotated token/port is always fresh.
 * Throws BridgeUnavailableError when the bridge cannot be reached at all, or a plain
 * Error carrying the bridge's own error message when the bridge responds with
 * { ok: false, error }.
 */
async function callBridge(command, params) {
  const { port, token } = readDiscovery();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(`http://127.0.0.1:${port}/rpc`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TypeR-Token": token,
      },
      body: JSON.stringify({ command, params: params ?? {} }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new Error(`TypeR bridge timed out after ${RPC_TIMEOUT_MS}ms running "${command}".`);
    }
    if (err?.code === "ECONNREFUSED" || err?.cause?.code === "ECONNREFUSED") {
      throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
    }
    throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 403) {
    throw new Error("TypeR bridge rejected the request: forbidden (stale token, reload panel).");
  }
  if (!response.ok) {
    throw new Error(`TypeR bridge returned HTTP ${response.status} for "${command}".`);
  }

  const body = await response.json();
  if (!body || body.ok !== true) {
    throw new Error(body?.error || `TypeR bridge command "${command}" failed.`);
  }
  return body.result;
}

async function getHealth() {
  const { port } = readDiscovery();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RPC_TIMEOUT_MS);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: controller.signal });
    if (!response.ok) {
      throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
    }
    return await response.json();
  } catch (err) {
    if (err instanceof BridgeUnavailableError) throw err;
    throw new BridgeUnavailableError(BRIDGE_NOT_RUNNING_MESSAGE);
  } finally {
    clearTimeout(timer);
  }
}

function textResult(value) {
  return {
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function errorResult(message) {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

/**
 * Wraps a tool handler so BridgeUnavailableError and bridge-reported failures both
 * turn into isError:true MCP tool results instead of throwing.
 */
function withBridgeErrors(handler) {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      return errorResult(err?.message || String(err));
    }
  };
}

const server = new McpServer(
  { name: "typer-mcp", version: "1.0.0" },
  {
    instructions:
      "Call typer_status first. Inspect the page and bubbles. Reuse project styles; visually compare new fonts with typer_preview_fonts. Before writing, compare TextShapeR layouts with typer_preview_text_shapes using real bubble bounds. Dry-run, apply the chosen breaks, review, repair size and optical centering with targeted layer tools, and save only after review.",
  }
);

const boundsSchema = z
  .object({
    left: z.number(),
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
  })
  .describe("Bounding box in document pixels: {left, top, right, bottom}.");

const shapeProfileSchema = z.object({
  rows: z.array(z.object({
    y: z.number().min(0).max(1),
    left: z.number().min(0).max(1).optional(),
    right: z.number().min(0).max(1).optional(),
    width: z.number().min(0).max(1),
  })).min(2),
});

server.registerTool(
  "typer_status",
  {
    title: "TypeR status",
    description:
      "Get a quick health + status summary of the TypeR panel (line/style counts, current line, direction, whether the bridge is reachable at all). Call this first to check the bridge is up.",
    inputSchema: {},
  },
  withBridgeErrors(async () => {
    const health = await getHealth();
    const status = await callBridge("status");
    return textResult({ health, status });
  })
);

server.registerTool(
  "typer_get_state",
  {
    title: "Get TypeR panel state",
    description:
      "Get the full state of the TypeR panel: all script lines, current line/style, direction, multi-bubble mode, stored selections, loaded images, and settings. Set includeText to also get the raw script text.",
    inputSchema: {
      includeText: z.boolean().optional().describe("Also return the raw script text. Default false."),
    },
  },
  withBridgeErrors(async ({ includeText }) => {
    const result = await callBridge("get_state", { includeText: includeText ?? false });
    return textResult(result);
  })
);

server.registerTool(
  "typer_set_script",
  {
    title: "Set script text",
    description:
      "Replace the full script text in the TypeR panel (this is the list of lines to type into speech bubbles). Maps to the bridge's set_text command.",
    inputSchema: {
      text: z.string().describe("The full script text, one line per dialogue entry."),
    },
  },
  withBridgeErrors(async ({ text }) => {
    const result = await callBridge("set_text", { text });
    return textResult(result);
  })
);

server.registerTool(
  "typer_set_current_line",
  {
    title: "Set current line",
    description: "Jump the TypeR panel's current line cursor to a specific raw line index.",
    inputSchema: {
      rawIndex: z.number().int().describe("Index into the lines array returned by typer_get_state."),
    },
  },
  withBridgeErrors(async ({ rawIndex }) => {
    const result = await callBridge("set_current_line", { rawIndex });
    return textResult(result);
  })
);

server.registerTool(
  "typer_next_line",
  {
    title: "Next line",
    description: "Advance the TypeR panel's current line cursor to the next line.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("next_line")))
);

server.registerTool(
  "typer_prev_line",
  {
    title: "Previous line",
    description: "Move the TypeR panel's current line cursor back to the previous line.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("prev_line")))
);

server.registerTool(
  "typer_get_styles",
  {
    title: "Get text styles",
    description:
      "List all text styles defined in the TypeR panel (font, size, color, folder) plus which style is currently selected.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("get_styles")))
);

server.registerTool(
  "typer_select_style",
  {
    title: "Select text style",
    description: "Set the currently selected text style in the TypeR panel by id.",
    inputSchema: {
      styleId: z.string().describe("Style id, as returned by typer_get_styles."),
    },
  },
  withBridgeErrors(async ({ styleId }) => textResult(await callBridge("select_style", { styleId })))
);

server.registerTool(
  "typer_search_fonts",
  {
    title: "Search Photoshop fonts",
    description: "Search fonts installed in Photoshop before creating or updating a TypeR style.",
    inputSchema: {
      query: z.string().optional().describe("Case-insensitive family, style, font name, or PostScript-name search."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum results. Default 30."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async ({ query, limit }) => textResult(await callBridge("search_fonts", { query, limit })))
);

server.registerTool(
  "typer_preview_fonts",
  {
    title: "Preview installed Photoshop fonts",
    description:
      "Render a visual contact sheet using the actual installed Photoshop fonts. Use this after typer_search_fonts to compare a shortlist against the real dialogue before creating a style.",
    inputSchema: {
      fontPostScriptNames: z.array(z.string()).min(1).max(24).optional().describe("Ordered shortlist of PostScript names returned by typer_search_fonts."),
      query: z.string().optional().describe("Alternative font search when no explicit shortlist is provided."),
      text: z.string().max(500).optional().describe("Contextual sample text to render. Prefer real dialogue from the target bubble."),
      limit: z.number().int().min(1).max(24).optional().describe("Maximum fonts on the sheet. Default 12."),
      columns: z.number().int().min(1).max(3).optional().describe("Contact-sheet columns. Default 2."),
      fontSize: z.number().int().min(18).max(96).optional().describe("Preview sample size in pixels. Default 42."),
      width: z.number().int().min(700).max(2400).optional().describe("Output image width. Default 1400."),
      uppercase: z.boolean().optional().describe("Render the sample in uppercase."),
      theme: z.enum(["light", "dark"]).optional().describe("Contact-sheet theme. Default light."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async (params) => {
    const result = await callBridge("preview_fonts", params);
    let data;
    try {
      data = fs.readFileSync(result.path);
    } catch (err) {
      return errorResult(`Font preview was generated at "${result.path}" but could not be read: ${err.message}`);
    }
    const metadata = { ...result };
    delete metadata.path;
    return {
      content: [
        { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ],
      structuredContent: metadata,
    };
  })
);

server.registerTool(
  "typer_save_style",
  {
    title: "Create or update a TypeR style",
    description: "Create a TypeR style derived from the current style, or update an existing style by ID, using an installed Photoshop font.",
    inputSchema: {
      styleId: z.string().optional().describe("Existing style ID to update. Omit to create."),
      name: z.string().optional(),
      fontPostScriptName: z.string().optional(),
      fontFamily: z.string().optional(),
      fontStyle: z.string().optional(),
      fontSize: z.number().positive().optional(),
      alignment: z.enum(["left", "center", "right", "justifyAll", "justifyLeft", "justifyCenter", "justifyRight"]).optional(),
      color: z.object({ r: z.number().min(0).max(255), g: z.number().min(0).max(255), b: z.number().min(0).max(255) }).optional(),
      pointText: z.boolean().optional(),
      select: z.boolean().optional().describe("Select the saved style. Default true."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async (params) => textResult(await callBridge("save_style", params)))
);

server.registerTool(
  "typer_get_document",
  {
    title: "Get active Photoshop document",
    description: "Read the active Photoshop document name, path, dimensions, save state, and active layer.",
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async () => textResult(await callBridge("document_info")))
);

server.registerTool(
  "typer_get_page_image",
  {
    title: "See the current page",
    description:
      "Export and view a downscaled snapshot of the active Photoshop document as an image, so you can visually see the page, its speech bubbles, and artwork. This is how you 'look at' the page.",
    inputSchema: {
      maxDim: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Maximum dimension (width or height) in pixels of the exported snapshot. Default 1500."),
    },
  },
  withBridgeErrors(async ({ maxDim }) => {
    const result = await callBridge("get_snapshot", { maxDim: maxDim ?? 1500 });
    let data;
    try {
      data = fs.readFileSync(result.path);
    } catch (err) {
      return errorResult(`Snapshot was generated at "${result.path}" but could not be read: ${err.message}`);
    }
    return {
      content: [
        {
          type: "image",
          data: data.toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: JSON.stringify(
            {
              docWidth: result.docWidth,
              docHeight: result.docHeight,
              imageWidth: result.imageWidth,
              imageHeight: result.imageHeight,
              path: result.path,
            },
            null,
            2
          ),
        },
      ],
    };
  })
);

server.registerTool(
  "typer_detect_bubbles",
  {
    title: "Detect speech bubbles",
    description:
      "Run automatic speech-bubble detection on the active document (snapshot + learned bubble detector). Returns detected bubbles in reading order with bounds in document pixels and suggested script lines for each — use this before typer_typeset_bubbles.",
    inputSchema: {
      sensitivity: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .describe("Detection sensitivity 1-10. Default 5."),
      rtl: z.boolean().optional().describe("Order bubbles right-to-left. Defaults to the panel's current direction."),
      maxDim: z.number().int().positive().optional().describe("Max snapshot dimension in pixels. Default 1500."),
    },
  },
  withBridgeErrors(async ({ sensitivity, rtl, maxDim }) => {
    const params = {};
    if (sensitivity !== undefined) params.sensitivity = sensitivity;
    if (rtl !== undefined) params.rtl = rtl;
    if (maxDim !== undefined) params.maxDim = maxDim;
    return textResult(await callBridge("detect_bubbles", params));
  })
);

const batchPasteEntrySchema = z.object({
  bounds: boundsSchema,
  lineIndex: z.number().int().nullable().optional().describe("Raw line index to paste, or null to use text override."),
  text: z.string().nullable().optional().describe("Verbatim text to paste, overriding lineIndex."),
  styleId: z.string().nullable().optional().describe("Style id to use, overriding the line's own style."),
  autoShape: z.boolean().optional().describe("Run TextShapeR for this bubble. Defaults to the batch setting."),
  forceShape: z.boolean().optional().describe("Reshape even when the text already contains explicit line breaks."),
  allowHyphenation: z.boolean().optional(),
  profile: z.enum(["balanced", "tall", "wide"]).optional(),
});

server.registerTool(
  "typer_typeset_bubbles",
  {
    title: "Typeset detected bubbles",
    description:
      "Dry-run or create one centered text layer per bubble entry, automatically shape dialogue with TextShapeR, and advance the panel line cursor. Use one batch per page after visually validating detections.",
    inputSchema: {
      entries: z.array(batchPasteEntrySchema).min(1).describe("One entry per bubble to typeset."),
      pointText: z.boolean().nullable().optional().describe("Use point text instead of paragraph text."),
      padding: z.number().nullable().optional().describe("Internal padding in pixels."),
      advanceLines: z.boolean().optional().describe("Advance the current line cursor after pasting. Default true."),
      autoShape: z.boolean().optional().describe("Run TextShapeR for entries without an override. Default true."),
      allowHyphenation: z.boolean().optional().describe("Allow TextShapeR hyphenation."),
      profile: z.enum(["balanced", "tall", "wide"]).optional(),
      dryRun: z.boolean().optional().describe("Return final placements and shaped text without changing Photoshop."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async ({ entries, pointText, padding, advanceLines, autoShape, allowHyphenation, profile, dryRun }) => {
    const params = { entries };
    if (pointText !== undefined) params.pointText = pointText;
    if (padding !== undefined) params.padding = padding;
    if (advanceLines !== undefined) params.advanceLines = advanceLines;
    if (autoShape !== undefined) params.autoShape = autoShape;
    if (allowHyphenation !== undefined) params.allowHyphenation = allowHyphenation;
    if (profile !== undefined) params.profile = profile;
    if (dryRun !== undefined) params.dryRun = dryRun;
    return textResult(await callBridge("batch_paste", params));
  })
);

server.registerTool(
  "typer_paste_text",
  {
    title: "Paste text into a bubble",
    description:
      "Paste a single piece of text either into an explicit bounds rectangle, or into the live Photoshop selection if bounds is omitted. Does not move the panel's line cursor.",
    inputSchema: {
      text: z.string().describe("Text to paste."),
      styleId: z.string().nullable().optional().describe("Style id to apply."),
      bounds: boundsSchema.nullable().optional().describe("Target bounds in document pixels; omit to use the current Photoshop selection."),
      pointText: z.boolean().nullable().optional().describe("Use point text instead of paragraph text."),
      padding: z.number().nullable().optional().describe("Internal padding in pixels."),
    },
  },
  withBridgeErrors(async ({ text, styleId, bounds, pointText, padding }) => {
    const params = { text };
    if (styleId !== undefined) params.styleId = styleId;
    if (bounds !== undefined) params.bounds = bounds;
    if (pointText !== undefined) params.pointText = pointText;
    if (padding !== undefined) params.padding = padding;
    return textResult(await callBridge("paste_text", params));
  })
);

server.registerTool(
  "typer_apply_text",
  {
    title: "Apply text/style to active layer",
    description:
      "Apply new text and/or a new style to the currently active Photoshop text layer, in place. Maps to the bridge's apply_to_active command. At least one of text/styleId must be given.",
    inputSchema: {
      text: z.string().nullable().optional().describe("New text content for the active layer."),
      styleId: z.string().nullable().optional().describe("New style id to apply to the active layer."),
    },
  },
  withBridgeErrors(async ({ text, styleId }) => {
    const params = {};
    if (text !== undefined) params.text = text;
    if (styleId !== undefined) params.styleId = styleId;
    return textResult(await callBridge("apply_to_active", params));
  })
);

server.registerTool(
  "typer_align",
  {
    title: "Align active text layer",
    description:
      "Automatically center a Photoshop text layer within explicit bubble bounds or the current selection.",
    inputSchema: {
      layerId: z.number().int().optional().describe("Optional stable Photoshop layer ID returned by typer_get_layers."),
      resizeTextBox: z.boolean().nullable().optional().describe("Resize the text box to the selection. Defaults to the panel setting."),
      padding: z.number().nullable().optional().describe("Internal padding in pixels. Defaults to the panel setting."),
      bounds: boundsSchema.optional().describe("Optional bubble bounds; TypeR creates the selection before aligning."),
    },
  },
  withBridgeErrors(async ({ layerId, resizeTextBox, padding, bounds }) => {
    const params = {};
    if (layerId !== undefined) params.layerId = layerId;
    if (resizeTextBox !== undefined) params.resizeTextBox = resizeTextBox;
    if (padding !== undefined) params.padding = padding;
    if (bounds !== undefined) params.bounds = bounds;
    return textResult(await callBridge("align_active", params));
  })
);

server.registerTool(
  "typer_nudge_layer",
  {
    title: "Nudge text layer",
    description:
      "Manually correct optical centering by moving a targeted Photoshop text layer in document pixels. Positive X moves right; positive Y moves down.",
    inputSchema: {
      layerId: z.number().int().describe("Stable Photoshop layer ID returned by typer_get_layers."),
      deltaX: z.number().optional().describe("Horizontal offset in document pixels; positive moves right."),
      deltaY: z.number().optional().describe("Vertical offset in document pixels; positive moves down."),
    },
  },
  withBridgeErrors(async ({ layerId, deltaX, deltaY }) =>
    textResult(await callBridge("nudge_layer", { layerId, deltaX: deltaX ?? 0, deltaY: deltaY ?? 0 })))
);

server.registerTool(
  "typer_change_text_size",
  {
    title: "Change text layer size",
    description: "Grow or shrink a targeted Photoshop text layer's font size by a delta, in pixels.",
    inputSchema: {
      layerId: z.number().int().optional().describe("Optional stable Photoshop layer ID returned by typer_get_layers."),
      delta: z.number().describe("Font size delta in pixels; may be negative to shrink."),
    },
  },
  withBridgeErrors(async ({ layerId, delta }) => textResult(await callBridge("change_text_size", { layerId, delta })))
);

server.registerTool(
  "typer_shape_text",
  {
    title: "Shape text into line breaks",
    description:
      "Generate line-break variants for a piece of dialogue text using TextShapeR, so it fits a bubble nicely. Returns several candidate variants with their line arrays; join a variant's lines with \\n and pass it as the text override to typer_paste_text/typer_typeset_bubbles.",
    inputSchema: {
      text: z.string().describe("Text to shape into lines."),
      width: z.number().nullable().optional().describe("Target width in pixels."),
      height: z.number().nullable().optional().describe("Target height in pixels."),
      limit: z.number().int().positive().optional().describe("Max number of variants to return. Default 8."),
      allowHyphenation: z.boolean().optional().describe("Allow hyphenation. Default true."),
      manualLineCount: z.number().int().positive().nullable().optional().describe("Force a specific number of lines."),
      profile: z.enum(["balanced", "tall", "wide"]).optional(),
      shapeProfile: shapeProfileSchema.optional().describe("Normalized bubble outline rows when available."),
    },
  },
  withBridgeErrors(async ({ text, width, height, limit, allowHyphenation, manualLineCount, profile, shapeProfile }) => {
    const params = { text };
    if (width !== undefined) params.width = width;
    if (height !== undefined) params.height = height;
    if (limit !== undefined) params.limit = limit;
    if (allowHyphenation !== undefined) params.allowHyphenation = allowHyphenation;
    if (manualLineCount !== undefined) params.manualLineCount = manualLineCount;
    if (profile !== undefined) params.profile = profile;
    if (shapeProfile !== undefined) params.shapeProfile = shapeProfile;
    return textResult(await callBridge("shape_text", params));
  })
);

server.registerTool(
  "typer_preview_text_shapes",
  {
    title: "Preview TextShapeR variants visually",
    description:
      "Render a contact sheet of TextShapeR variants in the actual TypeR font and size. With bubble bounds, each variant is overlaid on a crop of the real Photoshop page and checked against a sampled bubble outline. Use this before choosing final line breaks.",
    inputSchema: {
      text: z.string().optional().describe("Dialogue to shape. Omit when lineIndex is provided."),
      lineIndex: z.number().int().min(0).optional().describe("Raw TypeR line index; supplies text and its resolved style."),
      styleId: z.string().optional().describe("TypeR style override. Defaults to the line/current style."),
      bounds: boundsSchema.optional().describe("Real bubble bounds in document pixels. Enables contextual page crops and automatic outline sampling."),
      width: z.number().positive().optional().describe("Bubble width when bounds are unavailable."),
      height: z.number().positive().optional().describe("Bubble height when bounds are unavailable."),
      shapeProfile: shapeProfileSchema.optional().describe("Normalized bubble outline rows, overriding automatic sampling."),
      shapeSamples: z.number().int().min(7).max(31).optional().describe("Rows sampled from the real bubble outline. Default 21."),
      limit: z.number().int().min(2).max(12).optional().describe("Variants on the sheet. Default 6."),
      allowHyphenation: z.boolean().optional(),
      profile: z.enum(["balanced", "tall", "wide"]).optional(),
      fontSize: z.number().min(6).max(300).optional().describe("Preview size override in document units."),
      lineHeight: z.number().min(0.8).max(1.8).optional().describe("Line-height multiplier. Default 1.14."),
      columns: z.number().int().min(1).max(3).optional().describe("Contact-sheet columns. Default 2."),
      sheetWidth: z.number().int().min(800).max(2400).optional().describe("Output image width. Default 1400."),
      theme: z.enum(["light", "dark"]).optional(),
      maxDim: z.number().int().min(600).max(3000).optional().describe("Page snapshot maximum dimension. Default 1800."),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async (params) => {
    const result = await callBridge("preview_text_shapes", params);
    let data;
    try {
      data = fs.readFileSync(result.path);
    } catch (err) {
      return errorResult(`Text-shape preview was generated at "${result.path}" but could not be read: ${err.message}`);
    }
    const metadata = { ...result };
    delete metadata.path;
    return {
      content: [
        { type: "image", data: data.toString("base64"), mimeType: "image/png" },
        { type: "text", text: JSON.stringify(metadata, null, 2) },
      ],
      structuredContent: metadata,
    };
  })
);

server.registerTool(
  "typer_get_layers",
  {
    title: "Get rendered text layers",
    description:
      "Read all rendered text layers of the active Photoshop document, with their text content and bounds. Optionally also scan for un-typeset bubbles.",
    inputSchema: {
      scanBubbles: z.boolean().optional().describe("Also scan for bubbles without text layers. Default false."),
    },
  },
  withBridgeErrors(async ({ scanBubbles }) => textResult(await callBridge("get_layers", { scanBubbles: scanBubbles ?? false })))
);

server.registerTool(
  "typer_select_layer",
  {
    title: "Select Photoshop layer",
    description: "Select a Photoshop text layer by the stable ID returned by typer_get_layers.",
    inputSchema: { layerId: z.number().int() },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async ({ layerId }) => textResult(await callBridge("select_layer", { layerId })))
);

server.registerTool(
  "typer_edit_layer",
  {
    title: "Edit Photoshop text layer",
    description: "Select a text layer by ID, update its text and/or TypeR style, optionally reshape it against the surrounding bubble and re-center it.",
    inputSchema: {
      layerId: z.number().int(),
      text: z.string().optional(),
      styleId: z.string().optional(),
      autoShape: z.boolean().optional(),
      allowHyphenation: z.boolean().optional(),
      profile: z.enum(["balanced", "tall", "wide"]).optional(),
      align: z.boolean().optional(),
      resizeTextBox: z.boolean().optional(),
      padding: z.number().min(0).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async (params) => textResult(await callBridge("edit_layer", params)))
);

server.registerTool(
  "typer_next_page",
  {
    title: "Go to next page",
    description:
      "Advance the TypeR panel to the next page (follows 'Page N' markers in the script) and opens the mapped image in Photoshop if any.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("next_page")))
);

server.registerTool(
  "typer_previous_page",
  {
    title: "Go to previous page",
    description:
      "Move the TypeR panel to the previous page (follows 'Page N' markers in the script) and opens the mapped image in Photoshop if any.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("previous_page")))
);

server.registerTool(
  "typer_open_image",
  {
    title: "Open an image",
    description: "Open a specific image in Photoshop, either by absolute path or by page number from the panel's image list.",
    inputSchema: {
      path: z.string().optional().describe("Absolute path to the image file."),
      page: z.number().int().optional().describe("Page number, resolved through the panel's image list."),
    },
  },
  withBridgeErrors(async ({ path: imagePath, page }) => {
    const params = {};
    if (imagePath !== undefined) params.path = imagePath;
    if (page !== undefined) params.page = page;
    return textResult(await callBridge("open_image", params));
  })
);

server.registerTool(
  "typer_save_document",
  {
    title: "Save Photoshop document",
    description: "Save the active layered Photoshop document after visual review, optionally to an explicit PSD path or as a copy.",
    inputSchema: {
      path: z.string().optional().describe("Optional destination .psd path."),
      asCopy: z.boolean().optional().describe("Save a copy without changing the active document path."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  withBridgeErrors(async ({ path: destination, asCopy }) => textResult(await callBridge("save_document", { path: destination, asCopy })))
);

server.registerTool(
  "typer_deselect",
  {
    title: "Deselect",
    description: "Clear the current Photoshop marquee selection.",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("deselect")))
);

server.registerTool(
  "typer_undo",
  {
    title: "Undo last TypeR change",
    description: "Undo the last change made by TypeR (host undoLastTyperChange).",
    inputSchema: {},
  },
  withBridgeErrors(async () => textResult(await callBridge("undo")))
);

const transport = new StdioServerTransport();
await server.connect(transport);
