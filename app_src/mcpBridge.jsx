import React from "react";

import pkg from "../package.json";
import {
  buildRichTextPayload,
  csInterface,
  deselectDocument,
  exportDocumentSnapshot,
  getAllLayersRenderedTexts,
  getDefaultStroke,
  getDefaultStyle,
  getUserFonts,
  openFile,
  readStorage,
  refreshUserFonts,
  rgbToHex,
  trackHostAction,
  undoLastTextChange,
} from "./utils";
import { useContext } from "./context";
import { getScaledStyle, resolveStylePointText } from "./textLayerPayload";
import {
  assignLinesToBubbles,
  bubbleToSelection,
  detectLearnedBubbles,
  getDetectionOptions,
  getNextUsableLineIndex,
  normalizeBubbleLearning,
  orderBubbles,
} from "./bubbleDetection";
import { createPageImageLookup, getImageForPage } from "./pageImageMapping";
import { createFontContactSheet } from "./fontContactSheet";
import { createTextShapeContactSheet, sampleBubbleShapeProfile } from "./textShapeContactSheet";

// Local HTTP bridge for the TypeR MCP server (see docs/mcp/BRIDGE_API.md and
// mcp/). It listens on 127.0.0.1 only and requires the random token written
// to the discovery file, so only same-user local processes can drive it.
// Set storage key "mcpBridgeDisabled" to true to keep it off.
const BRIDGE_PORTS = [17845, 17846, 17847, 17848, 17849, 17850, 17851, 17852, 17853, 17854];
const DISCOVERY_FILENAME = "typer-mcp-bridge.json";
const MAX_BODY_BYTES = 20 * 1024 * 1024;
const DEFAULT_TIMEOUT = 30000;
const LONG_TIMEOUT = 120000;
const LONG_COMMANDS = [
  "detect_bubbles",
  "get_snapshot",
  "preview_fonts",
  "preview_text_shapes",
  "batch_paste",
  "edit_layer",
  "save_document"
];
const LEARNING_STORAGE_KEY = "bubbleDetectionLearning";
const SNAPSHOT_MAX_DIM = 1500;

const appVersion = pkg.version;

const getNodeRequire = () =>
  (window.cep_node && window.cep_node.require) ||
  (typeof window.require === "function" ? window.require : null);

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

class BridgeError extends Error {}
const fail = (message) => {
  throw new BridgeError(message);
};

// dispatch comes from useReducer and is asynchronous: after dispatching, the
// new state only reaches getState() on the next render. Poll until the
// predicate holds instead of guessing with a fixed delay.
const waitForState = (getState, predicate, timeout = 1500) => new Promise((resolve) => {
  const startedAt = Date.now();
  const check = () => {
    const state = getState();
    if (predicate(state)) return resolve(state);
    if (Date.now() - startedAt >= timeout) return resolve(state);
    setTimeout(check, 16);
  };
  check();
});

const evalHost = (expression) => new Promise((resolve) => {
  csInterface.evalScript(expression, trackHostAction(resolve));
});

const lineSummary = (line) => (line ? {
  rawIndex: line.rawIndex,
  displayIndex: line.ignore ? null : line.index,
  text: line.text,
  ignore: !!line.ignore,
  styleId: (line.usedStyle || line.style || {}).id || null,
  styleName: (line.usedStyle || line.style || {}).name || null,
} : null);

const styleSummary = (style, folders) => {
  const textStyle = ((((style.textProps || {}).layerText || {}).textStyleRange || [])[0] || {}).textStyle || {};
  const paragraphStyle = ((((style.textProps || {}).layerText || {}).paragraphStyleRange || [])[0] || {}).paragraphStyle || {};
  const color = textStyle.color || null;
  const folder = style.folder ? (folders || []).find((candidate) => candidate.id === style.folder) : null;
  return {
    id: style.id,
    name: style.name,
    folder: style.folder || null,
    folderName: folder ? folder.name : null,
    prefixes: (style.prefixes || []).filter(Boolean),
    textType: style.textType || null,
    fontPostScriptName: textStyle.fontPostScriptName || textStyle.fontName || null,
    fontFamily: textStyle.fontName || null,
    fontStyle: textStyle.fontStyleName || null,
    fontSize: typeof textStyle.size === "number" ? textStyle.size : null,
    alignment: paragraphStyle.alignment || "center",
    pointText: style.pointText === true,
    colorHex: color ? rgbToHex({ r: color.red, g: color.green, b: color.blue }) : null,
  };
};

const boundsSummary = (selection) => ({
  left: selection.left,
  top: selection.top,
  right: selection.right,
  bottom: selection.bottom,
  width: selection.width,
  height: selection.height,
});

const requireBounds = (bounds) => {
  if (!bounds || !["left", "top", "right", "bottom"].every((key) => typeof bounds[key] === "number")) {
    fail("bad_params: bounds requires numeric left/top/right/bottom");
  }
  if (bounds.right - bounds.left < 2 || bounds.bottom - bounds.top < 2) {
    fail("bad_params: bounds too small");
  }
  const left = Math.round(bounds.left);
  const top = Math.round(bounds.top);
  const right = Math.round(bounds.right);
  const bottom = Math.round(bounds.bottom);
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
};

// Same flow as the bubbleDetect modal scan: host snapshot PNG, decoded to
// ImageData through an off-screen canvas (the bridge runs in the panel DOM).
const decodeSnapshot = (maxDim) => new Promise((resolve, reject) => {
  exportDocumentSnapshot(maxDim || SNAPSHOT_MAX_DIM, (result) => {
    if (!result || result.error || !result.path) {
      return reject(new BridgeError(result && result.error === "doc" ? "no_document" : "snapshot_failed"));
    }
    const read = window.cep.fs.readFile(result.path, window.cep.encoding.Base64);
    if (!read || read.err || !read.data) return reject(new BridgeError("snapshot_read_failed"));
    const image = new Image();
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const canvasContext = canvas.getContext("2d");
        canvasContext.drawImage(image, 0, 0);
        resolve({
          pixels: canvasContext.getImageData(0, 0, canvas.width, canvas.height),
          path: result.path,
          imageWidth: canvas.width,
          imageHeight: canvas.height,
          docWidth: result.docWidth || canvas.width,
          docHeight: result.docHeight || canvas.height,
        });
      } catch (error) {
        reject(new BridgeError("snapshot_decode_failed"));
      }
    };
    image.onerror = () => reject(new BridgeError("snapshot_decode_failed"));
    image.src = "data:image/png;base64," + read.data;
  });
});

const resolveStyle = (state, styleId, line) => {
  if (styleId) {
    const style = (state.styles || []).find((candidate) => candidate.id === styleId);
    if (!style) fail(`bad_params: unknown styleId ${styleId}`);
    return style;
  }
  return (line && (line.usedStyle || line.style)) || state.currentStyle || null;
};

const getFonts = () => new Promise((resolve) => {
  const cached = getUserFonts();
  if (cached.length) {
    resolve(cached);
    return;
  }
  refreshUserFonts(resolve);
});

const clone = (value) => JSON.parse(JSON.stringify(value));

const applyStyleOverrides = async (baseStyle, params) => {
  const style = clone(baseStyle || { textProps: getDefaultStyle(), stroke: getDefaultStroke() });
  if (!style.textProps) style.textProps = getDefaultStyle();
  if (!style.stroke) style.stroke = getDefaultStroke();
  const textStyle = style.textProps.layerText.textStyleRange[0].textStyle;
  const paragraphStyle = style.textProps.layerText.paragraphStyleRange[0].paragraphStyle;
  if (params.fontPostScriptName || params.fontFamily) {
    const fonts = await getFonts();
    const font = fonts.find((candidate) => candidate.postScriptName === params.fontPostScriptName)
      || fonts.find((candidate) => candidate.family === params.fontFamily && (!params.fontStyle || candidate.style === params.fontStyle));
    if (!font) fail("bad_params: requested font is not installed in Photoshop");
    textStyle.fontPostScriptName = font.postScriptName;
    textStyle.fontStyleName = font.style;
    textStyle.fontName = font.name;
  }
  if (typeof params.fontSize === "number" && params.fontSize > 0) {
    textStyle.size = params.fontSize;
    if (textStyle.impliedFontSize != null) textStyle.impliedFontSize = params.fontSize;
  }
  if (params.alignment) paragraphStyle.alignment = params.alignment;
  if (params.color && [params.color.r, params.color.g, params.color.b].every((value) => typeof value === "number")) {
    textStyle.color = { red: params.color.r, green: params.color.g, blue: params.color.b };
  }
  if (typeof params.pointText === "boolean") style.pointText = params.pointText;
  return style;
};

const generateShapeVariants = async (state, text, options) => {
  const engine = await import(/* webpackChunkName: "text-shaper-engine" */ "./textShapeR");
  engine.setDehyphenationEnabled(state.dehyphenateTextShapeR === true);
  engine.setTextShapeRTuning(state.textShapeRTuning || null);
  if (typeof options.manualLineCount === "number") {
    const manual = engine.generateManualTextShapeRVariant(text, {
      lineCount: options.manualLineCount,
      width: options.width,
      height: options.height,
      shapeProfile: options.shapeProfile || null,
    });
    return manual ? [manual] : [];
  }
  return engine.generateTextShapeRVariants(text, {
    limit: clamp(options.limit || 8, 1, 20),
    allowHyphenation: options.allowHyphenation !== false,
    profile: options.profile || "balanced",
    width: options.width,
    height: options.height,
    shapeProfile: options.shapeProfile || null,
  });
};

// Mirrors utils.createTextLayersInStoredSelections without its nativeAlert
// error path: a headless caller must get the host error string back, never a
// modal Photoshop dialog.
const hostBatchPaste = async (state, texts, styles, selections, pointText, padding) => {
  const parsedTexts = texts.map((line) => buildRichTextPayload(line));
  const data = JSON.stringify({
    texts: parsedTexts.map((entry) => entry.text),
    richTextRuns: parsedTexts.map((entry) => entry.richTextRuns),
    styles,
    pointModes: styles.map((style) => resolveStylePointText(style, pointText)),
    selections,
    padding: padding || 0,
    direction: state.direction,
  });
  const error = await evalHost("createTextLayersInStoredSelections(" + data + ", " + !!pointText + ")");
  if (error) fail(String(error));
};

const buildPasteEntries = async (state, entries, options) => {
  const texts = [];
  const styles = [];
  const selections = [];
  const commitEntries = [];
  let fallbackCursor = state.currentLineIndex;
  const capturedAt = Date.now();

  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const selection = requireBounds(entry.bounds);
    let line = null;
    if (typeof entry.lineIndex === "number") {
      line = (state.lines || [])[entry.lineIndex];
      if (!line || line.ignore) fail(`bad_params: entry ${index} lineIndex ${entry.lineIndex} is not a usable line`);
      fallbackCursor = Math.max(fallbackCursor, entry.lineIndex + 1);
    } else if (entry.text == null) {
      const usable = getNextUsableLineIndex(state.lines || [], fallbackCursor);
      if (usable === null) fail(`bad_params: entry ${index} has no text and no script line is left`);
      line = state.lines[usable];
      fallbackCursor = usable + 1;
    }
    let text = entry.text != null ? String(entry.text) : line.text;
    if (!text) fail(`bad_params: entry ${index} resolves to empty text`);
    const style = resolveStyle(state, entry.styleId, line)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    const autoShape = entry.autoShape != null ? !!entry.autoShape : options.autoShape !== false;
    if (autoShape && (entry.forceShape || text.indexOf("\n") === -1)) {
      const variants = await generateShapeVariants(state, text, {
        limit: 1,
        allowHyphenation: entry.allowHyphenation != null ? entry.allowHyphenation : options.allowHyphenation,
        profile: entry.profile || options.profile,
        width: selection.width,
        height: selection.height,
        shapeProfile: entry.shapeProfile || null,
      });
      if (variants[0]) text = variants[0].text;
    }
    texts.push(text);
    styles.push(getScaledStyle(style, state.textScale));
    selections.push({
      ...selection,
      capturedAt,
      styleId: style.id || null,
      lineIndex: line ? line.rawIndex : undefined,
    });
    if (line) commitEntries.push({ lineIndex: line.rawIndex, styleId: style.id || null });
  }

  return { texts, styles, selections, commitEntries };
};

const commands = {
  status: async ({ getState }) => {
    const state = getState();
    return {
      version: appVersion,
      linesTotal: (state.lines || []).length,
      currentLineIndex: state.currentLineIndex,
      stylesTotal: (state.styles || []).length,
      multiBubbleMode: !!state.multiBubbleMode,
      storedSelections: (state.storedSelections || []).length,
      direction: state.direction || "ltr",
      imagesTotal: (state.images || []).length,
    };
  },

  get_state: async ({ getState }, params) => {
    const state = getState();
    const result = {
      lines: (state.lines || []).map(lineSummary),
      currentLineIndex: state.currentLineIndex,
      currentLine: lineSummary(state.currentLine),
      currentStyleId: state.currentStyleId || null,
      direction: state.direction || "ltr",
      multiBubbleMode: !!state.multiBubbleMode,
      storedSelections: (state.storedSelections || []).length,
      images: (state.images || []).map((image) => ({
        name: image.name,
        path: image.path,
        page: (image.name || "").match(/[0-9]+/) ? Number((image.name || "").match(/[0-9]+/)[0]) : null,
      })),
      lastOpenedImagePath: state.lastOpenedImagePath || null,
      settings: {
        pastePointText: !!state.pastePointText,
        internalPadding: state.internalPadding || 0,
        textScale: state.textScale || null,
      },
    };
    if (params.includeText) result.text = state.text || "";
    return result;
  },

  set_text: async ({ getState, dispatch }, params) => {
    if (typeof params.text !== "string") fail("bad_params: text must be a string");
    dispatch({ type: "setText", text: params.text });
    const state = await waitForState(getState, (next) => next.text === params.text);
    return { linesTotal: (state.lines || []).length };
  },

  set_current_line: async ({ getState, dispatch }, params) => {
    const state = getState();
    const line = (state.lines || [])[params.rawIndex];
    if (!line) fail(`bad_params: no line at rawIndex ${params.rawIndex}`);
    dispatch({ type: "setCurrentLineIndex", index: params.rawIndex });
    const next = await waitForState(getState, (candidate) => candidate.currentLineIndex === params.rawIndex);
    return { currentLineIndex: next.currentLineIndex };
  },

  next_line: async ({ getState, dispatch }) => {
    const before = getState().currentLineIndex;
    dispatch({ type: "nextLine" });
    const state = await waitForState(getState, (next) => next.currentLineIndex !== before, 500);
    return { currentLineIndex: state.currentLineIndex };
  },

  prev_line: async ({ getState, dispatch }) => {
    const before = getState().currentLineIndex;
    dispatch({ type: "prevLine" });
    const state = await waitForState(getState, (next) => next.currentLineIndex !== before, 500);
    return { currentLineIndex: state.currentLineIndex };
  },

  get_styles: async ({ getState }) => {
    const state = getState();
    return {
      styles: (state.styles || []).map((style) => styleSummary(style, state.folders)),
      currentStyleId: state.currentStyleId || null,
    };
  },

  select_style: async ({ getState, dispatch }, params) => {
    const state = getState();
    if (!(state.styles || []).some((style) => style.id === params.styleId)) {
      fail(`bad_params: unknown styleId ${params.styleId}`);
    }
    dispatch({ type: "setCurrentStyleId", id: params.styleId });
    const next = await waitForState(getState, (candidate) => candidate.currentStyleId === params.styleId);
    // The style-prefix → line mapping is recomputed ~75 ms after the style
    // change (deferred in context.jsx); ride that window out so an immediate
    // get_state/batch_paste reads fresh lines[].styleId.
    await new Promise((resolve) => setTimeout(resolve, 120));
    return { currentStyleId: next.currentStyleId };
  },

  search_fonts: async (ctx, params) => {
    const query = String(params.query || "").toLocaleLowerCase();
    const limit = clamp(params.limit || 30, 1, 100);
    const fonts = await getFonts();
    return {
      fonts: fonts
        .filter((font) => !query || `${font.family} ${font.style} ${font.name} ${font.postScriptName}`.toLocaleLowerCase().indexOf(query) !== -1)
        .slice(0, limit),
    };
  },

  preview_fonts: async (ctx, params) => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) fail("node_unavailable");
    const fonts = await getFonts();
    return createFontContactSheet(fonts, params || {}, nodeRequire);
  },

  save_style: async ({ getState, dispatch }, params) => {
    const state = getState();
    const styles = state.styles || [];
    const existing = params.styleId
      ? resolveStyle(state, params.styleId, null)
      : (state.currentStyle || styles[0] || { textProps: getDefaultStyle(), stroke: getDefaultStroke() });
    const style = await applyStyleOverrides(existing, params);
    const id = params.styleId || `mcp-${Date.now().toString(36)}`;
    style.id = id;
    style.name = params.name || style.name || "MCP Style";
    dispatch({ type: "saveStyle", id, data: style });
    if (params.select !== false) dispatch({ type: "setCurrentStyleId", id });
    const next = await waitForState(getState, (candidate) => (candidate.styles || []).some((item) => item.id === id));
    return { style: styleSummary((next.styles || []).find((item) => item.id === id) || style, next.folders) };
  },

  document_info: async () => {
    const result = JSON.parse(await evalHost("getTypeRMcpDocumentInfo()") || "{}");
    if (result.error) fail(result.error);
    return result;
  },

  get_snapshot: async (ctx, params) => {
    const snapshot = await decodeSnapshot(params.maxDim);
    return {
      path: snapshot.path,
      docWidth: snapshot.docWidth,
      docHeight: snapshot.docHeight,
      imageWidth: snapshot.imageWidth,
      imageHeight: snapshot.imageHeight,
    };
  },

  detect_bubbles: async ({ getState }, params) => {
    const state = getState();
    const snapshot = await decodeSnapshot(params.maxDim);
    const sensitivity = clamp(params.sensitivity || 5, 1, 10);
    const learning = normalizeBubbleLearning(readStorage(LEARNING_STORAGE_KEY));
    const bubbles = detectLearnedBubbles(snapshot.pixels, getDetectionOptions(sensitivity), learning)
      .map((bubble, index) => ({ ...bubble, id: index }));
    const rtl = params.rtl != null ? !!params.rtl : state.direction === "rtl";
    const ordered = orderBubbles(bubbles, rtl);
    const scaleX = snapshot.docWidth / snapshot.imageWidth;
    const scaleY = snapshot.docHeight / snapshot.imageHeight;
    const startRawIndex = getNextUsableLineIndex(state.lines || [], state.currentLineIndex);
    const assignments = assignLinesToBubbles(
      ordered,
      state.lines || [],
      startRawIndex === null ? state.currentLineIndex : startRawIndex
    );
    return {
      docWidth: snapshot.docWidth,
      docHeight: snapshot.docHeight,
      snapshotPath: snapshot.path,
      bubbles: ordered.map((bubble, order) => ({
        id: bubble.id,
        order,
        docBounds: boundsSummary(bubbleToSelection(bubble, scaleX, scaleY)),
        confidence: typeof bubble.confidence === "number" ? bubble.confidence : null,
        area: bubble.area,
        fillRatio: bubble.fillRatio,
        suggestedLine: typeof assignments[bubble.id] === "number"
          ? lineSummary((state.lines || [])[assignments[bubble.id]])
          : null,
      })),
    };
  },

  batch_paste: async (ctx, params) => {
    const { getState, dispatch } = ctx;
    const state = getState();
    if (!Array.isArray(params.entries) || !params.entries.length) {
      fail("bad_params: entries must be a non-empty array");
    }
    const { texts, styles, selections, commitEntries } = await buildPasteEntries(state, params.entries, params);
    const pointText = params.pointText != null ? !!params.pointText : !!state.pastePointText;
    const padding = params.padding != null ? params.padding : (state.internalPadding || 0);
    if (params.dryRun) {
      return {
        dryRun: true,
        placements: selections.map((selection, index) => ({
          bounds: boundsSummary(selection),
          text: texts[index],
          lineIndex: selection.lineIndex,
          styleId: selection.styleId,
        })),
      };
    }
    await hostBatchPaste(state, texts, styles, selections, pointText, padding);
    // If the caller already received busy_timeout, don't mutate the panel line
    // state behind its back: the paste happened in Photoshop, but the cursor
    // stays where the client believes it is.
    if (ctx.isCancelled && ctx.isCancelled()) fail("busy_timeout");
    deselectDocument();

    let nextLineIndex = state.currentLineIndex;
    if (params.advanceLines !== false && commitEntries.length) {
      const lastLineIndex = Math.max(...commitEntries.map((entry) => entry.lineIndex));
      const usable = getNextUsableLineIndex(state.lines || [], lastLineIndex + 1);
      nextLineIndex = usable === null ? lastLineIndex : usable;
      dispatch({ type: "commitLineBatch", entries: commitEntries, nextLineIndex });
      await waitForState(getState, (next) => next.currentLineIndex === nextLineIndex, 500);
    }
    return {
      pasted: texts.length,
      nextLineIndex,
      placements: selections.map((selection, index) => ({
        bounds: boundsSummary(selection),
        text: texts[index],
        lineIndex: selection.lineIndex,
        styleId: selection.styleId,
      })),
    };
  },

  paste_text: async (ctx, params) => {
    const { getState } = ctx;
    if (typeof params.text !== "string" || !params.text) fail("bad_params: text is required");
    if (params.bounds) {
      const result = await commands.batch_paste(ctx, {
        entries: [{ bounds: params.bounds, text: params.text, styleId: params.styleId || null }],
        pointText: params.pointText,
        padding: params.padding,
        advanceLines: false,
      });
      return { pasted: result.pasted };
    }
    const state = getState();
    const style = resolveStyle(state, params.styleId, null)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    const scaledStyle = getScaledStyle(style, state.textScale);
    const pointText = params.pointText != null ? !!params.pointText : !!state.pastePointText;
    const parsed = buildRichTextPayload(params.text);
    const data = JSON.stringify({
      text: parsed.text,
      style: scaledStyle,
      padding: params.padding != null ? params.padding : (state.internalPadding || 0),
      direction: state.direction,
      richTextRuns: parsed.richTextRuns,
    });
    const error = await evalHost(
      "createTextLayerInSelection(" + data + ", " + resolveStylePointText(scaledStyle, pointText) + ")"
    );
    if (error) fail(String(error));
    return { pasted: 1 };
  },

  apply_to_active: async ({ getState }, params) => {
    const state = getState();
    const hasText = typeof params.text === "string" && params.text;
    const style = params.styleId ? resolveStyle(state, params.styleId, null) : null;
    if (!hasText && !style) fail("bad_params: text or styleId is required");
    let text = hasText ? params.text : "";
    if (!hasText && style) {
      let snapshot = null;
      try { snapshot = JSON.parse(await evalHost(`getTypeRPanelSnapshot(${JSON.stringify({})})`) || "{}"); } catch (error) {}
      text = snapshot && snapshot.activeLayer && snapshot.activeLayer.textProps
        ? snapshot.activeLayer.textProps.layerText.textKey || ""
        : "";
      if (!text) fail("no_text_layer");
    }
    const parsed = buildRichTextPayload(text);
    const payload = style
      ? { text: parsed.text, style: getScaledStyle(style, state.textScale), direction: state.direction, richTextRuns: parsed.richTextRuns }
      : { text: parsed.text, style: null, contentOnly: true, richTextRuns: parsed.richTextRuns };
    const error = await evalHost("setActiveLayerText(" + JSON.stringify(payload) + ")");
    if (error) fail(String(error));
    return { ok: true };
  },

  align_active: async (ctx, params) => {
    const state = ctx.getState();
    if (params.layerId != null) await commands.select_layer(ctx, { layerId: params.layerId });
    if (params.bounds) {
      const bounds = requireBounds(params.bounds);
      const selectionError = await evalHost("selectTypeRMcpBounds(" + JSON.stringify(bounds) + ")");
      if (selectionError) fail(String(selectionError));
    }
    const data = JSON.stringify({
      resizeTextBox: params.resizeTextBox != null ? !!params.resizeTextBox : !!state.resizeTextBoxOnCenter,
      padding: params.padding != null ? params.padding : (state.internalPadding || 0),
    });
    const error = await evalHost("alignTextLayerToSelection(" + data + ")");
    if (error) fail(String(error));
    return { ok: true };
  },

  change_text_size: async (ctx, params) => {
    if (typeof params.delta !== "number" || !params.delta) fail("bad_params: delta must be a non-zero number");
    if (params.layerId != null) await commands.select_layer(ctx, { layerId: params.layerId });
    const error = await evalHost("changeActiveLayerTextSize(" + params.delta + ")");
    if (error) fail(String(error));
    return { ok: true, layerId: params.layerId != null ? Math.round(params.layerId) : null, delta: params.delta };
  },

  nudge_layer: async (ctx, params) => {
    if (typeof params.layerId !== "number") fail("bad_params: layerId must be a number");
    const deltaX = typeof params.deltaX === "number" ? params.deltaX : 0;
    const deltaY = typeof params.deltaY === "number" ? params.deltaY : 0;
    if (!deltaX && !deltaY) fail("bad_params: deltaX or deltaY must be non-zero");
    await commands.select_layer(ctx, { layerId: params.layerId });
    const data = JSON.stringify({ deltaX, deltaY });
    const error = await evalHost("nudgeActiveTextLayer(" + data + ")");
    if (error) fail(String(error));
    return { ok: true, layerId: Math.round(params.layerId), deltaX, deltaY };
  },

  get_layers: async (ctx, params) => new Promise((resolve) => {
    getAllLayersRenderedTexts(!!params.scanBubbles, (entries) => resolve({ layers: entries }));
  }),

  shape_text: async ({ getState }, params) => {
    if (typeof params.text !== "string" || !params.text) fail("bad_params: text is required");
    const state = getState();
    const width = typeof params.width === "number" ? params.width : undefined;
    const height = typeof params.height === "number" ? params.height : undefined;
    const variants = await generateShapeVariants(state, params.text, {
      limit: clamp(params.limit || 8, 1, 20),
      allowHyphenation: params.allowHyphenation,
      manualLineCount: params.manualLineCount,
      profile: params.profile,
      width,
      height,
      shapeProfile: params.shapeProfile || null,
    });
    return {
      variants: variants.map((variant) => ({
        lines: variant.lines,
        lineCount: variant.lines.length,
        score: variant.score != null ? variant.score : null,
      })),
    };
  },

  preview_text_shapes: async ({ getState }, params) => {
    const state = getState();
    const line = typeof params.lineIndex === "number" ? (state.lines || [])[params.lineIndex] : null;
    if (typeof params.lineIndex === "number" && (!line || line.ignore)) {
      fail(`bad_params: lineIndex ${params.lineIndex} is not a usable line`);
    }
    const text = typeof params.text === "string" && params.text ? params.text : (line && line.text);
    if (!text) fail("bad_params: text or a usable lineIndex is required");
    const targetBounds = params.bounds ? requireBounds(params.bounds) : null;
    const width = targetBounds ? targetBounds.width : params.width;
    const height = targetBounds ? targetBounds.height : params.height;
    if (!(width > 0) || !(height > 0)) fail("bad_params: bounds or positive width/height are required");

    let snapshot = null;
    let shapeProfile = params.shapeProfile || null;
    if (targetBounds) {
      snapshot = await decodeSnapshot(params.maxDim || 1800);
      if (!shapeProfile) {
        const scaleX = snapshot.imageWidth / snapshot.docWidth;
        const scaleY = snapshot.imageHeight / snapshot.docHeight;
        shapeProfile = sampleBubbleShapeProfile(snapshot.pixels, {
          left: targetBounds.left * scaleX,
          top: targetBounds.top * scaleY,
          right: targetBounds.right * scaleX,
          bottom: targetBounds.bottom * scaleY,
        }, params.shapeSamples || 21);
      }
    }

    const variants = await generateShapeVariants(state, text, {
      limit: clamp(params.limit || 6, 2, 12),
      allowHyphenation: params.allowHyphenation,
      profile: params.profile,
      width,
      height,
      shapeProfile,
    });
    const style = resolveStyle(state, params.styleId, line)
      || { textProps: getDefaultStyle(), stroke: getDefaultStroke() };
    const scaledStyle = getScaledStyle(style, state.textScale);
    const textStyle = ((((scaledStyle.textProps || {}).layerText || {}).textStyleRange || [])[0] || {}).textStyle || {};
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) fail("node_unavailable");
    return createTextShapeContactSheet({
      variants,
      fonts: await getFonts(),
      textStyle,
      params: { ...params, text, width, height },
      nodeRequire,
      snapshot,
      bounds: targetBounds,
      shapeProfile,
    });
  },

  next_page: async ({ getState, dispatch }) => {
    const before = getState();
    dispatch({ type: "nextPage" });
    await waitForState(getState, (next) => next.currentLineIndex !== before.currentLineIndex, 800);
    // The page image opens from a textBlock effect watching currentLineIndex;
    // give it a moment to run so lastOpenedImagePath is fresh (best effort).
    const state = await waitForState(
      getState,
      (next) => next.lastOpenedImagePath !== before.lastOpenedImagePath,
      1200
    );
    return { currentLineIndex: state.currentLineIndex, openedImagePath: state.lastOpenedImagePath || null };
  },

  previous_page: async ({ getState, dispatch }) => {
    const before = getState();
    dispatch({ type: "previousPage" });
    await waitForState(getState, (next) => next.currentLineIndex !== before.currentLineIndex, 800);
    const state = await waitForState(
      getState,
      (next) => next.lastOpenedImagePath !== before.lastOpenedImagePath,
      1200
    );
    return { currentLineIndex: state.currentLineIndex, openedImagePath: state.lastOpenedImagePath || null };
  },

  open_image: async ({ getState, dispatch }, params) => {
    const state = getState();
    let path = null;
    if (typeof params.path === "string" && params.path) {
      path = params.path;
    } else if (typeof params.page === "number") {
      const lookup = createPageImageLookup(state.images || []);
      const image = getImageForPage(state.images || [], params.page, lookup);
      if (!image) fail(`bad_params: no image mapped to page ${params.page}`);
      path = image.path;
    } else {
      fail("bad_params: path or page is required");
    }
    openFile(path, state.autoClosePSD);
    dispatch({ type: "setLastOpenedImagePath", path });
    return { opened: path };
  },

  select_layer: async (ctx, params) => {
    if (typeof params.layerId !== "number") fail("bad_params: layerId must be a number");
    const error = await evalHost(`selectLayerById(${Math.round(params.layerId)})`);
    if (error) fail("layer_not_found");
    return { selectedLayerId: Math.round(params.layerId) };
  },

  edit_layer: async (ctx, params) => {
    await commands.select_layer(ctx, params);
    let text = params.text;
    let bubbleShape = null;
    if ((params.autoShape && typeof text === "string" && text) || (params.align && !params.bounds)) {
      const shapeRaw = await evalHost(`getActiveLayerBubbleShape(${JSON.stringify({ samples: 21, tolerance: 20 })})`);
      try { bubbleShape = JSON.parse(shapeRaw || "{}"); } catch (error) {}
    }
    if (params.autoShape && typeof text === "string" && text) {
      const variants = await generateShapeVariants(ctx.getState(), text, {
        limit: 1,
        allowHyphenation: params.allowHyphenation,
        profile: params.profile,
        width: bubbleShape && bubbleShape.bounds ? bubbleShape.bounds.width : undefined,
        height: bubbleShape && bubbleShape.bounds ? bubbleShape.bounds.height : undefined,
        shapeProfile: bubbleShape && bubbleShape.rows ? bubbleShape : null,
      });
      if (variants[0]) text = variants[0].text;
    }
    const applied = await commands.apply_to_active(ctx, { text, styleId: params.styleId });
    if (params.align) {
      await commands.align_active(ctx, {
        ...params,
        bounds: params.bounds || (bubbleShape && bubbleShape.bounds) || null,
      });
    }
    return { ...applied, layerId: Math.round(params.layerId), text: text || null };
  },

  save_document: async (ctx, params) => {
    const data = JSON.stringify({ path: params.path || null, asCopy: !!params.asCopy });
    const result = JSON.parse(await evalHost(`saveTypeRMcpDocument(${data})`) || "{}");
    if (result.error) fail(result.error);
    return result;
  },

  deselect: async () => new Promise((resolve) => {
    deselectDocument(() => resolve({ ok: true }));
  }),

  undo: async () => new Promise((resolve, reject) => {
    undoLastTextChange((ok) => (ok ? resolve({ ok: true }) : reject(new BridgeError("undo_failed"))));
  }),
};

const runCommand = async (ctx, command, params) => {
  const handler = commands[command];
  if (!handler) fail("unknown_command");
  const timeout = LONG_COMMANDS.indexOf(command) !== -1 ? LONG_TIMEOUT : DEFAULT_TIMEOUT;
  let cancelled = false;
  const scopedCtx = { ...ctx, isCancelled: () => cancelled };
  const pending = Promise.resolve().then(() => handler(scopedCtx, params || {}));
  // Side branch so the abandoned promise never surfaces as an unhandled
  // rejection once the timeout has already answered the client.
  const settled = pending.catch(() => {});
  let timer = null;
  try {
    return await Promise.race([
      pending,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => {
          cancelled = true;
          reject(new BridgeError("busy_timeout"));
        }, timeout);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (cancelled) {
      // busy_timeout was already reported, but an in-flight evalScript chain
      // cannot be aborted: hold the queue (bounded) so the next command never
      // interleaves with it, and let handlers check isCancelled() before any
      // late dispatch.
      await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, timeout))]);
    }
  }
};

const createBridge = (nodeRequire, ctx) => {
  const http = nodeRequire("http");
  const fs = nodeRequire("fs");
  const os = nodeRequire("os");
  const path = nodeRequire("path");
  const crypto = nodeRequire("crypto");
  const { Buffer } = nodeRequire("buffer");

  const token = crypto.randomBytes(32).toString("hex");
  const discoveryPath = path.join(os.tmpdir(), DISCOVERY_FILENAME);
  let server = null;
  let stopped = false;
  // Commands run strictly one at a time: concurrent evalScript chains against
  // the single ExtendScript engine would interleave selections and pastes.
  let queue = Promise.resolve();

  const respond = (res, statusCode, payload) => {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  };

  const handler = (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      return respond(res, 200, { ok: true, service: "typer-mcp-bridge", version: appVersion });
    }
    if (req.method !== "POST" || req.url !== "/rpc") {
      return respond(res, 404, { ok: false, error: "not_found" });
    }
    if (req.headers["x-typer-token"] !== token) {
      return respond(res, 403, { ok: false, error: "forbidden" });
    }
    // Accumulate raw Buffers and decode once on "end": per-chunk toString()
    // corrupts multi-byte UTF-8 sequences split across TCP packets.
    const chunks = [];
    let received = 0;
    let overflow = false;
    req.on("data", (chunk) => {
      if (overflow) return;
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        overflow = true;
        chunks.length = 0;
        // Answer before dropping the socket so the client sees 413 instead of
        // a bare connection reset; keep draining until the response flushes.
        respond(res, 413, { ok: false, error: "payload_too_large" });
        res.once("finish", () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (overflow) return;
      let parsed = null;
      try {
        parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch (error) {
        return respond(res, 400, { ok: false, error: "bad_json" });
      }
      queue = queue.then(async () => {
        try {
          const result = await runCommand(ctx, parsed.command, parsed.params);
          respond(res, 200, { ok: true, result });
        } catch (error) {
          const message = error instanceof BridgeError
            ? error.message
            : `internal: ${(error && error.message) || String(error)}`;
          if (!(error instanceof BridgeError)) console.error("TypeR MCP bridge:", error);
          respond(res, 200, { ok: false, error: message });
        }
      });
    });
    req.on("error", () => {});
  };

  const writeDiscovery = (port) => {
    try {
      fs.writeFileSync(discoveryPath, JSON.stringify({
        port,
        token,
        pid: (window.cep_node && window.cep_node.process && window.cep_node.process.pid) || null,
        version: appVersion,
        startedAt: Date.now(),
      }));
    } catch (error) {
      console.error("TypeR MCP bridge: discovery write failed", error);
    }
  };

  const listen = (portIndex) => {
    if (stopped || portIndex >= BRIDGE_PORTS.length) {
      if (portIndex >= BRIDGE_PORTS.length) console.error("TypeR MCP bridge: all ports busy");
      return;
    }
    server = http.createServer(handler);
    server.on("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        server = null;
        listen(portIndex + 1);
      } else {
        console.error("TypeR MCP bridge:", error);
      }
    });
    server.listen(BRIDGE_PORTS[portIndex], "127.0.0.1", () => {
      if (stopped) return;
      writeDiscovery(BRIDGE_PORTS[portIndex]);
      console.log(`TypeR MCP bridge listening on 127.0.0.1:${BRIDGE_PORTS[portIndex]}`);
    });
  };

  listen(0);

  return {
    stop: () => {
      stopped = true;
      if (server) {
        try { server.close(); } catch (error) { /* panel is unloading */ }
        server = null;
      }
      try {
        const current = JSON.parse(fs.readFileSync(discoveryPath, "utf8"));
        if (current && current.token === token) fs.unlinkSync(discoveryPath);
      } catch (error) { /* already gone or unreadable: nothing to clean */ }
    },
  };
};

const McpBridge = React.memo(function McpBridge() {
  const context = useContext(() => ({}));

  React.useEffect(() => {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) {
      console.warn("TypeR MCP bridge: Node is unavailable, bridge disabled");
      return undefined;
    }
    if (readStorage("mcpBridgeDisabled")) return undefined;
    const bridge = createBridge(nodeRequire, {
      getState: context.getState,
      dispatch: context.dispatch,
    });
    window.addEventListener("beforeunload", bridge.stop);
    return () => {
      window.removeEventListener("beforeunload", bridge.stop);
      bridge.stop();
    };
  }, []);

  return <React.Fragment />;
});

export default McpBridge;
