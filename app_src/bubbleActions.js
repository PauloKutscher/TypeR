// Panel-side pipeline for merged-bubble detection: ask the host to export
// the selection mask as a small PNG, analyze it in JS (bubbleSplit.js), then
// paste one line per bubble or align a layer to its own bubble.

import { csInterface, deselectDocument, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, alignTextLayerToBounds } from "./utils";
import { getScaledStyle, getUpcomingLines } from "./textLayerPayload";
import { splitMaskIntoBubbles, sortBubblesReadingOrder } from "./bubbleSplit";

const readMaskImage = (filePath, callback) => {
  try {
    const result = window.cep.fs.readFile(filePath, window.cep.encoding.Base64);
    if (result.err) {
      callback(null);
      return;
    }
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0);
        callback(ctx.getImageData(0, 0, img.width, img.height));
      } catch (error) {
        callback(null);
      }
    };
    img.onerror = () => callback(null);
    img.src = "data:image/png;base64," + result.data;
  } catch (error) {
    callback(null);
  }
};

// Detect the individual bubbles of the current selection (or of the bubble
// wand-detected around the active text layer when options.useWand is set).
// callback receives { bubbles: [...]|null, layerBounds, hadSelection } or
// null when there is nothing to analyze.
const detectBubblesInSelection = (options, callback) => {
  const payload = JSON.stringify({
    useWand: !!options.useWand,
    maxSide: 220,
    tolerance: 20,
  });
  csInterface.evalScript(`getSelectionMaskForSplit(${payload})`, (result) => {
    let data = null;
    try {
      data = JSON.parse(result || "{}");
    } catch (error) {
      data = null;
    }
    if (!data || data.error || !data.file || !data.bounds) {
      callback(null);
      return;
    }
    readMaskImage(data.file, (imageData) => {
      try {
        window.cep.fs.deleteFile(data.file);
      } catch (error) {}
      if (!imageData) {
        callback(null);
        return;
      }
      const { width, height, data: pixels } = imageData;
      const mask = new Uint8Array(width * height);
      for (let i = 0; i < mask.length; i++) {
        mask[i] = pixels[i * 4] > 127 ? 1 : 0;
      }
      const parts = splitMaskIntoBubbles(mask, width, height, options.maxBubbles || 3);
      if (!parts) {
        callback({ bubbles: null, layerBounds: data.layerBounds, hadSelection: data.hadSelection });
        return;
      }
      const scaleX = data.bounds.width / width;
      const scaleY = data.bounds.height / height;
      const bubbles = sortBubblesReadingOrder(parts).map((part) => {
        const left = Math.round(data.bounds.left + part.left * scaleX);
        const top = Math.round(data.bounds.top + part.top * scaleY);
        const right = Math.round(data.bounds.left + part.right * scaleX);
        const bottom = Math.round(data.bounds.top + part.bottom * scaleY);
        return {
          left,
          top,
          right,
          bottom,
          width: right - left,
          height: bottom - top,
          xMid: data.bounds.left + part.cx * scaleX,
          yMid: data.bounds.top + part.cy * scaleY,
        };
      });
      callback({ bubbles, layerBounds: data.layerBounds, hadSelection: data.hadSelection });
    });
  });
};

// Paste the current line into the selection; when the selection covers a
// merged double/triple bubble, paste the following lines into the other
// bubbles too, each centered in its own bubble. dispatch advances one line
// per pasted text.
const pasteWithBubbleSplit = ({ state, dispatch }) => {
  const line = state.currentLine || { text: "" };
  const lineStyle = getScaledStyle(state.currentStyle, state.textScale);
  const pointText = state.pastePointText;
  const padding = state.internalPadding || 0;
  const direction = state.direction;
  const fallback = () => {
    createTextLayerInSelection(line.text, lineStyle, pointText, padding, direction, (ok) => {
      if (ok) dispatch({ type: "nextLine", add: true });
    });
  };
  if (state.splitMergedBubbles === false || !line.text) {
    fallback();
    return;
  }
  const upcoming = getUpcomingLines({
    lines: state.lines,
    currentLineIndex: state.currentLineIndex,
    currentStyle: state.currentStyle,
    textScale: state.textScale,
    count: 2,
  });
  if (!upcoming.length) {
    fallback();
    return;
  }
  detectBubblesInSelection({ maxBubbles: upcoming.length + 1 }, (result) => {
    const bubbles = result && result.bubbles;
    if (!bubbles || bubbles.length < 2) {
      fallback();
      return;
    }
    const texts = [line.text];
    const styles = [lineStyle];
    for (let i = 0; i < bubbles.length - 1 && i < upcoming.length; i++) {
      texts.push(upcoming[i].text);
      styles.push(upcoming[i].style || lineStyle);
    }
    const used = Math.min(texts.length, bubbles.length);
    createTextLayersInStoredSelections(texts.slice(0, used), styles.slice(0, used), bubbles.slice(0, used), pointText, padding, direction, (ok) => {
      if (!ok) return;
      // The marquee of the merged selection is spent: drop it
      deselectDocument();
      for (let i = 0; i < used; i++) {
        dispatch({ type: "nextLine", add: true });
      }
    });
  });
};

// Align the active text layer to its bubble; inside a merged multi-bubble
// selection (manual or wand-detected) it aligns to the bubble the layer
// actually sits in instead of the center of the whole merged shape.
const alignWithBubbleSplit = ({ state, callback = () => {} }) => {
  const padding = state.internalPadding || 0;
  const fallback = () => alignTextLayerToSelection(state.resizeTextBoxOnCenter, padding, callback);
  if (state.splitMergedBubbles === false) {
    fallback();
    return;
  }
  detectBubblesInSelection({ useWand: true, maxBubbles: 3 }, (result) => {
    const bubbles = result && result.bubbles;
    const layerBounds = result && result.layerBounds;
    if (!bubbles || bubbles.length < 2 || !layerBounds) {
      fallback();
      return;
    }
    // The bubble the layer belongs to: the one containing its center, or
    // failing that the closest one
    const cx = typeof layerBounds.xMid === "number" ? layerBounds.xMid : (layerBounds.left + layerBounds.right) / 2;
    const cy = typeof layerBounds.yMid === "number" ? layerBounds.yMid : (layerBounds.top + layerBounds.bottom) / 2;
    let chosen = null;
    let bestDist = Infinity;
    for (const bubble of bubbles) {
      if (cx >= bubble.left && cx <= bubble.right && cy >= bubble.top && cy <= bubble.bottom) {
        chosen = bubble;
        break;
      }
      const dx = bubble.xMid - cx;
      const dy = bubble.yMid - cy;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        chosen = bubble;
      }
    }
    if (!chosen) {
      fallback();
      return;
    }
    alignTextLayerToBounds(chosen, state.resizeTextBoxOnCenter, padding, callback);
  });
};

export { detectBubblesInSelection, pasteWithBubbleSplit, alignWithBubbleSplit };
