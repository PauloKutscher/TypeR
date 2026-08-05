// Auto speech-bubble detection.
//
// Works on the flattened, downscaled snapshot of the document exported by the
// host (exportDocumentSnapshot). Bubbles are found as connected regions of
// near-white pixels that do not touch the page border: the white page margins
// and panel gutters always reach an edge, while a bubble is sealed off by its
// dark outline, so border-touching alone already separates "page white" from
// "bubble white". Everything here is pure and DOM-free so it runs both in the
// panel and in the node test harness.

const DEFAULT_DETECT_OPTIONS = {
  // A pixel is "white" when every channel reaches this value
  whiteThreshold: 225,
  // Area limits as a fraction of the snapshot, so page size does not matter
  minAreaRatio: 0.0005,
  maxAreaRatio: 0.12,
  // Bubbles are compact: area / bounding-box area. Thin frames and stray
  // gutter slivers fall well below this.
  minFillRatio: 0.35,
  // Bounding box minimum in snapshot pixels
  minSizePx: 12,
  // Width/height ratio cap, either orientation
  maxAspect: 8,
};

// The UI exposes one "sensitivity" knob instead of raw thresholds: higher
// values accept dirtier whites (scans, JPEG pages) and smaller bubbles.
const getDetectionOptions = (sensitivity) => {
  let s = parseInt(sensitivity, 10);
  if (!Number.isFinite(s)) s = 5;
  s = Math.min(9, Math.max(1, s));
  return {
    ...DEFAULT_DETECT_OPTIONS,
    whiteThreshold: 250 - s * 5,
    minAreaRatio: 0.0025 / s,
  };
};

const buildWhiteMask = (imageData, whiteThreshold) => {
  const { data, width, height } = imageData;
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (data[p] >= whiteThreshold && data[p + 1] >= whiteThreshold && data[p + 2] >= whiteThreshold) {
      mask[i] = 1;
    }
  }
  return mask;
};

// Connected components (4-connectivity, iterative flood fill) over the white
// mask, then geometric filtering. Coordinates are snapshot pixels; `right` and
// `bottom` are exclusive so width = right - left.
const detectBubbles = (imageData, options) => {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...(options || {}) };
  const { width, height } = imageData;
  const totalArea = width * height;
  if (!totalArea) return [];
  const mask = buildWhiteMask(imageData, opts.whiteThreshold);
  const visited = new Uint8Array(totalArea);
  const minArea = Math.max(20, Math.floor(totalArea * opts.minAreaRatio));
  const maxArea = Math.ceil(totalArea * opts.maxAreaRatio);
  const stack = [];
  const bubbles = [];

  for (let start = 0; start < totalArea; start++) {
    if (!mask[start] || visited[start]) continue;
    let area = 0;
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let touchesBorder = false;
    visited[start] = 1;
    stack.push(start);
    while (stack.length) {
      const idx = stack.pop();
      const x = idx % width;
      const y = (idx / width) | 0;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;
      if (x > 0 && mask[idx - 1] && !visited[idx - 1]) {
        visited[idx - 1] = 1;
        stack.push(idx - 1);
      }
      if (x < width - 1 && mask[idx + 1] && !visited[idx + 1]) {
        visited[idx + 1] = 1;
        stack.push(idx + 1);
      }
      if (y > 0 && mask[idx - width] && !visited[idx - width]) {
        visited[idx - width] = 1;
        stack.push(idx - width);
      }
      if (y < height - 1 && mask[idx + width] && !visited[idx + width]) {
        visited[idx + width] = 1;
        stack.push(idx + width);
      }
    }

    if (touchesBorder) continue;
    if (area < minArea || area > maxArea) continue;
    const boxWidth = maxX - minX + 1;
    const boxHeight = maxY - minY + 1;
    if (boxWidth < opts.minSizePx || boxHeight < opts.minSizePx) continue;
    const aspect = boxWidth > boxHeight ? boxWidth / boxHeight : boxHeight / boxWidth;
    if (aspect > opts.maxAspect) continue;
    const fillRatio = area / (boxWidth * boxHeight);
    if (fillRatio < opts.minFillRatio) continue;
    bubbles.push({
      left: minX,
      top: minY,
      right: maxX + 1,
      bottom: maxY + 1,
      width: boxWidth,
      height: boxHeight,
      area,
      fillRatio,
      xMid: (minX + maxX + 1) / 2,
      yMid: (minY + maxY + 1) / 2,
    });
  }
  return bubbles;
};

// Reading order: bubbles are grouped into visual rows (a bubble joins a row
// when it vertically overlaps at least half of the smaller height), rows go
// top to bottom, and inside a row manga pages read right to left.
const orderBubbles = (bubbles, rtl) => {
  if (!bubbles || !bubbles.length) return [];
  const sorted = bubbles.slice().sort((a, b) => a.top - b.top);
  const rows = [];
  for (const bubble of sorted) {
    let target = null;
    for (const row of rows) {
      const overlap = Math.min(row.bottom, bubble.bottom) - Math.max(row.top, bubble.top);
      const minHeight = Math.min(row.bottom - row.top, bubble.height);
      if (overlap > minHeight * 0.5) {
        target = row;
        break;
      }
    }
    if (!target) {
      target = { top: bubble.top, bottom: bubble.bottom, items: [] };
      rows.push(target);
    } else {
      target.top = Math.min(target.top, bubble.top);
      target.bottom = Math.max(target.bottom, bubble.bottom);
    }
    target.items.push(bubble);
  }
  rows.sort((a, b) => a.top - b.top);
  const ordered = [];
  for (const row of rows) {
    row.items.sort((a, b) => (rtl ? b.xMid - a.xMid : a.xMid - b.xMid));
    ordered.push(...row.items);
  }
  return ordered;
};

// Converts a detected bubble (snapshot pixels) into the exact selection shape
// the multi-bubble pipeline stores and pastes into (document pixels).
const bubbleToSelection = (bubble, scaleX, scaleY) => {
  const left = Math.round(bubble.left * scaleX);
  const right = Math.round(bubble.right * scaleX);
  const top = Math.round(bubble.top * scaleY);
  const bottom = Math.round(bubble.bottom * scaleY);
  return {
    top,
    left,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
};

const getNextUsableLineIndex = (lines, startIndex) => {
  for (let index = Math.max(0, startIndex || 0); index < (lines || []).length; index++) {
    if (lines[index] && !lines[index].ignore) return index;
  }
  return null;
};

// Sequentially maps ordered bubbles to usable script lines starting at
// startRawIndex. A bubble with a valid manualLineIndex takes that line and the
// following bubbles continue from it — editing one number renumbers the rest.
const assignLinesToBubbles = (bubbles, lines, startRawIndex) => {
  const assignments = {};
  let cursor = Math.max(0, startRawIndex || 0);
  for (const bubble of bubbles || []) {
    let lineIndex = null;
    if (
      typeof bubble.manualLineIndex === "number" &&
      lines[bubble.manualLineIndex] &&
      !lines[bubble.manualLineIndex].ignore
    ) {
      lineIndex = bubble.manualLineIndex;
    } else {
      lineIndex = getNextUsableLineIndex(lines, cursor);
    }
    assignments[bubble.id] = lineIndex;
    if (lineIndex !== null) cursor = lineIndex + 1;
  }
  return assignments;
};

const PAGE_MARKER_PATTERN = /Page [0-9]+/i;

// Resolves a typed display number back to a raw line index. Display numbers
// restart on every page marker, so the match is searched from the start of
// the page around nearRawIndex first and only then in the whole script.
const findLineByDisplayNumber = (lines, displayNumber, nearRawIndex) => {
  if (!lines || !lines.length || !Number.isFinite(displayNumber)) return null;
  let pageStart = 0;
  const from = Math.min(Math.max(0, nearRawIndex || 0), lines.length - 1);
  for (let i = from; i >= 0; i--) {
    if (lines[i] && PAGE_MARKER_PATTERN.test(lines[i].rawText || "")) {
      pageStart = i;
      break;
    }
  }
  for (let i = pageStart; i < lines.length; i++) {
    if (lines[i] && !lines[i].ignore && lines[i].index === displayNumber) return i;
  }
  for (let i = 0; i < pageStart; i++) {
    if (lines[i] && !lines[i].ignore && lines[i].index === displayNumber) return i;
  }
  return null;
};

export {
  DEFAULT_DETECT_OPTIONS,
  getDetectionOptions,
  detectBubbles,
  orderBubbles,
  bubbleToSelection,
  getNextUsableLineIndex,
  assignLinesToBubbles,
  findLineByDisplayNumber,
};
