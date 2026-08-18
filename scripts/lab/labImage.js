/*
 * labImage.js — pixel and geometry helpers for the centering bench.
 *
 * Reads the headerless 8-bit grayscale composites exported by
 * scripts/lab/measureCentering.jsx and reproduces Photoshop's contiguous
 * magic wand so region experiments can run offline, without Photoshop.
 *
 * No dependencies: Node built-ins only.
 */

const fs = require("fs");

function readRaw(filePath, width, height) {
  const data = fs.readFileSync(filePath);
  if (data.length !== width * height) {
    throw new Error(`raw size mismatch: ${data.length} != ${width * height} (${filePath})`);
  }
  return { data, width, height };
}

/*
 * Contiguous flood fill, 4-connected, |v - seed| <= tolerance.
 * Mirrors the plugin's magic wand call: contiguous, merged, tolerance 20.
 * Anti-aliasing is not reproduced: Photoshop feathers the edge, which can
 * shift a bbox edge by a pixel. Callers must validate against the measured
 * Photoshop bounds before trusting derived numbers.
 */
function floodFill(img, seedX, seedY, tolerance) {
  const { data, width, height } = img;
  const seed = data[seedY * width + seedX];
  const lo = seed - tolerance;
  const hi = seed + tolerance;
  const mask = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let sp = 0;
  stack[sp++] = seedY * width + seedX;
  mask[seedY * width + seedX] = 1;
  let minX = seedX, maxX = seedX, minY = seedY, maxY = seedY, count = 0;

  while (sp > 0) {
    const p = stack[--sp];
    const x = p % width;
    const y = (p - x) / width;
    count++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    if (x > 0) push(p - 1);
    if (x < width - 1) push(p + 1);
    if (y > 0) push(p - width);
    if (y < height - 1) push(p + width);
  }

  function push(q) {
    if (mask[q]) return;
    const v = data[q];
    if (v < lo || v > hi) return;
    mask[q] = 1;
    stack[sp++] = q;
  }

  return {
    mask,
    width,
    height,
    count,
    seedValue: seed,
    bbox: makeBox(minX, minY, maxX + 1, maxY + 1),
  };
}

function makeBox(left, top, right, bottom) {
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
}

/* Row spans of a mask inside its bbox: [{y, left, right, width}] in pixels. */
function maskRows(region) {
  const { mask, width, bbox } = region;
  const rows = [];
  for (let y = bbox.top; y < bbox.bottom; y++) {
    let left = -1;
    let right = -1;
    let filled = 0;
    for (let x = bbox.left; x < bbox.right; x++) {
      if (mask[y * width + x]) {
        if (left < 0) left = x;
        right = x;
        filled++;
      }
    }
    rows.push({ y, left, right, width: left < 0 ? 0 : right - left + 1, filled });
  }
  return rows;
}

/* Coarse ASCII view of a mask, for reading geometry in a terminal. */
function asciiMask(region, cols = 78, marks = []) {
  const { mask, width, bbox } = region;
  const stepX = Math.max(1, Math.ceil(bbox.width / cols));
  const stepY = stepX * 2;
  const lines = [];
  for (let y = bbox.top; y < bbox.bottom; y += stepY) {
    let line = "";
    for (let x = bbox.left; x < bbox.right; x += stepX) {
      let inside = 0;
      let total = 0;
      for (let yy = y; yy < Math.min(y + stepY, bbox.bottom); yy += 2) {
        for (let xx = x; xx < Math.min(x + stepX, bbox.right); xx += 2) {
          total++;
          if (mask[yy * width + xx]) inside++;
        }
      }
      let ch = inside === 0 ? " " : inside === total ? "#" : "+";
      for (const m of marks) {
        if (m.x >= x && m.x < x + stepX && m.y >= y && m.y < y + stepY) ch = m.ch || "o";
      }
      line += ch;
    }
    lines.push(String(y).padStart(5) + " |" + line);
  }
  return lines.join("\n");
}

/* Morphological erosion/dilation by a square structuring element (radius r). */
function erode(region, r) {
  const { mask, width, height } = region;
  if (r <= 0) return region;
  const out = boxFilterAtLeast(mask, width, height, r, (hits, area) => hits === area);
  return withMask(region, out);
}

function dilate(region, r) {
  const { mask, width, height } = region;
  if (r <= 0) return region;
  const out = boxFilterAtLeast(mask, width, height, r, (hits) => hits > 0);
  return withMask(region, out);
}

/* Opening = erosion then dilation: removes tails and spikes thinner than 2r. */
function open(region, r) {
  return dilate(erode(region, r), r);
}

function boxFilterAtLeast(mask, width, height, r, accept) {
  // Integral image keeps the square window O(1) per pixel.
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += mask[y * width + x] ? 1 : 0;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r);
      const hits =
        integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
        integral[y0 * (width + 1) + (x1 + 1)] -
        integral[(y1 + 1) * (width + 1) + x0] +
        integral[y0 * (width + 1) + x0];
      const area = (y1 - y0 + 1) * (x1 - x0 + 1);
      if (accept(hits, area)) out[y * width + x] = 1;
    }
  }
  return out;
}

function withMask(region, mask) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
  const { width, height } = region;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return {
    mask,
    width,
    height,
    count,
    seedValue: region.seedValue,
    bbox: count ? makeBox(minX, minY, maxX + 1, maxY + 1) : makeBox(0, 0, 0, 0),
  };
}

/*
 * Chamfer distance transform (3-4 kernel) of the inside of the mask, in pixels.
 * Values are approximate Euclidean; good enough to rank interior points and
 * far cheaper than an exact transform.
 */
function distanceTransform(region) {
  const { mask, width, height } = region;
  const INF = 1e9;
  const dist = new Float64Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? INF : 0;
  const d1 = 1, d2 = 1.41421356;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let best = dist[i];
      if (y > 0) {
        if (x > 0) best = Math.min(best, dist[i - width - 1] + d2);
        best = Math.min(best, dist[i - width] + d1);
        if (x < width - 1) best = Math.min(best, dist[i - width + 1] + d2);
      }
      if (x > 0) best = Math.min(best, dist[i - 1] + d1);
      dist[i] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!mask[i]) continue;
      let best = dist[i];
      if (y < height - 1) {
        if (x < width - 1) best = Math.min(best, dist[i + width + 1] + d2);
        best = Math.min(best, dist[i + width] + d1);
        if (x > 0) best = Math.min(best, dist[i + width - 1] + d2);
      }
      if (x < width - 1) best = Math.min(best, dist[i + 1] + d1);
      dist[i] = best;
    }
  }
  return dist;
}

/*
 * Connected component of an eroded mask that contains (or is nearest to) a
 * seed point. Used to pick the balloon the text actually sits in when the
 * flood fill fused several balloons through a white corridor.
 */
function componentAt(region, seedX, seedY) {
  const { mask, width, height, bbox } = region;
  const seedIndex = Math.round(seedY) * width + Math.round(seedX);
  let start = mask[seedIndex] ? seedIndex : -1;

  if (start < 0) {
    // The seed can fall outside after erosion: take the nearest set pixel.
    let best = Infinity;
    for (let y = bbox.top; y < bbox.bottom; y++) {
      for (let x = bbox.left; x < bbox.right; x++) {
        const i = y * width + x;
        if (!mask[i]) continue;
        const d = (x - seedX) * (x - seedX) + (y - seedY) * (y - seedY);
        if (d < best) { best = d; start = i; }
      }
    }
    if (start < 0) return null;
  }

  const out = new Uint8Array(width * height);
  const stack = new Int32Array(region.count + 8);
  let sp = 0;
  stack[sp++] = start;
  out[start] = 1;
  let count = 0;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  while (sp > 0) {
    const p = stack[--sp];
    const x = p % width;
    const y = (p - x) / width;
    count++;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (x > 0 && mask[p - 1] && !out[p - 1]) { out[p - 1] = 1; stack[sp++] = p - 1; }
    if (x < width - 1 && mask[p + 1] && !out[p + 1]) { out[p + 1] = 1; stack[sp++] = p + 1; }
    if (y > 0 && mask[p - width] && !out[p - width]) { out[p - width] = 1; stack[sp++] = p - width; }
    if (y < height - 1 && mask[p + width] && !out[p + width]) { out[p + width] = 1; stack[sp++] = p + width; }
  }
  return {
    mask: out,
    width,
    height,
    count,
    seedValue: region.seedValue,
    bbox: makeBox(minX, minY, maxX + 1, maxY + 1),
  };
}

/*
 * Isolate one balloon: erode by r to break thin corridors and tails, keep the
 * component holding the seed, then dilate it back by r and clip to the original
 * mask. Unlike a plain morphological reconstruction this does not flow back
 * through the corridor, so two balloons joined by a gap stay separated while
 * the balloon keeps its real outline.
 */
function isolate(region, seedX, seedY, r) {
  if (r <= 0) return region;
  const eroded = erode(region, r);
  if (!eroded.count) return region;
  const comp = componentAt(eroded, seedX, seedY);
  if (!comp || !comp.count) return region;
  const grown = dilate(comp, r);
  const out = new Uint8Array(region.width * region.height);
  for (let i = 0; i < out.length; i++) out[i] = grown.mask[i] && region.mask[i] ? 1 : 0;
  return withMask(region, out);
}

function integralOf(region) {
  const { mask, width, height } = region;
  const integral = new Int32Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += mask[y * width + x] ? 1 : 0;
      integral[(y + 1) * (width + 1) + (x + 1)] = integral[y * (width + 1) + (x + 1)] + rowSum;
    }
  }
  return integral;
}

function rectIsFull(integral, width, x0, y0, x1, y1) {
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const sum =
    integral[(y1 + 1) * (width + 1) + (x1 + 1)] -
    integral[y0 * (width + 1) + (x1 + 1)] -
    integral[(y1 + 1) * (width + 1) + x0] +
    integral[y0 * (width + 1) + x0];
  return sum === w * h;
}

/*
 * Largest axis-aligned rectangle of a given aspect ratio that fits inside the
 * mask, by binary search on the half-width at every interior pixel.
 * The centre of that rectangle is where a text block of the same shape has the
 * most room on every side.
 */
function largestInscribedRect(region, aspect) {
  const { width, height, bbox, mask } = region;
  const integral = integralOf(region);
  const maxHalfW = Math.floor(Math.min(bbox.width, bbox.height * aspect) / 2) + 1;
  let best = { half: -1, cx: bbox.xMid, cy: bbox.yMid };
  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      if (!mask[y * width + x]) continue;
      let lo = 0;
      let hi = maxHalfW;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        const halfH = Math.max(1, Math.round(mid / aspect));
        const x0 = x - mid, x1 = x + mid, y0 = y - halfH, y1 = y + halfH;
        const inside = x0 >= 0 && y0 >= 0 && x1 < width && y1 < height &&
          rectIsFull(integral, width, x0, y0, x1, y1);
        if (inside) lo = mid; else hi = mid - 1;
      }
      if (lo > best.half) best = { half: lo, cx: x, cy: y };
    }
  }
  return best;
}

/*
 * Row/column profile of a region, in pixels, used by the "body" rules.
 */
function profiles(region) {
  const { mask, width, bbox } = region;
  const rowWidth = new Int32Array(bbox.height);
  const colHeight = new Int32Array(bbox.width);
  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      if (!mask[y * width + x]) continue;
      rowWidth[y - bbox.top]++;
      colHeight[x - bbox.left]++;
    }
  }
  return { rowWidth, colHeight };
}

/*
 * Keep only the body of the balloon: rows at least `k` of the widest row and
 * columns at least `k` of the tallest column. This drops the tail, the spikes
 * and the tapering caps, which is what inflates a bounding box and drags its
 * centre away from where a typesetter puts the text.
 */
function trim(region, k) {
  const { mask, width, height, bbox } = region;
  const { rowWidth, colHeight } = profiles(region);
  const maxRow = Math.max.apply(null, Array.from(rowWidth));
  const maxCol = Math.max.apply(null, Array.from(colHeight));
  const out = new Uint8Array(width * height);
  for (let y = bbox.top; y < bbox.bottom; y++) {
    if (rowWidth[y - bbox.top] < k * maxRow) continue;
    for (let x = bbox.left; x < bbox.right; x++) {
      if (colHeight[x - bbox.left] < k * maxCol) continue;
      if (mask[y * width + x]) out[y * width + x] = 1;
    }
  }
  const trimmed = withMask(region, out);
  return trimmed.count ? trimmed : region;
}

/*
 * Two-lobe detector: a balloon made of two bubbles joined by a neck, or two
 * overlapping balloons the flood fill cannot separate. Looks for two peaks in
 * the row-width profile with a clear waist between them. Used to refuse the
 * centering instead of dropping the text into the wrong lobe.
 */
function detectTwoLobes(region) {
  const { rowWidth } = profiles(region);
  const n = rowWidth.length;
  if (n < 9) return null;
  const smooth = new Float64Array(n);
  const window = Math.max(1, Math.round(n * 0.05));
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(n - 1, i + window); j++) { sum += rowWidth[j]; count++; }
    smooth[i] = sum / count;
  }
  const maxWidth = Math.max.apply(null, Array.from(smooth));
  if (maxWidth <= 0) return null;

  let best = null;
  for (let a = 1; a < n - 2; a++) {
    if (smooth[a] < smooth[a - 1] || smooth[a] < smooth[a + 1]) continue;
    for (let b = a + 3; b < n - 1; b++) {
      if (smooth[b] < smooth[b - 1] || smooth[b] < smooth[b + 1]) continue;
      let neck = Infinity;
      let neckAt = -1;
      for (let m = a + 1; m < b; m++) {
        if (smooth[m] < neck) { neck = smooth[m]; neckAt = m; }
      }
      if (neckAt < 0) continue;
      const minPeak = Math.min(smooth[a], smooth[b]);
      if (minPeak < 0.35 * maxWidth) continue;
      const ratio = neck / minPeak;
      const depth = (minPeak - neck) / maxWidth;
      if (ratio <= 0.75 && depth >= 0.12) {
        if (!best || depth > best.depth) {
          best = { ratio, depth, neckY: region.bbox.top + neckAt, peakA: region.bbox.top + a, peakB: region.bbox.top + b };
        }
      }
    }
  }
  return best;
}

/*
 * Count the lobes of a region: erode until thin joins break, then count the
 * surviving components that are big enough to hold text. Two overlapping
 * balloons (a double bubble) survive as two lobes; a tail or a spike does not.
 *
 * The radius comes from the region's own largest inscribed circle, so the test
 * has no absolute pixel constant and scales with the balloon.
 */
function countLobes(region, share = 0.5, minAreaShare = 0.08) {
  const dt = distanceTransform(region);
  let maxDist = 0;
  const { bbox, width } = region;
  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      const v = dt[y * width + x];
      if (v > maxDist) maxDist = v;
    }
  }
  const r = Math.max(1, Math.round(share * maxDist));
  const eroded = erode(region, r);
  if (!eroded.count) return { lobes: 0, radius: r, maxDist, areas: [] };

  const seen = new Uint8Array(region.width * region.height);
  const areas = [];
  for (let y = eroded.bbox.top; y < eroded.bbox.bottom; y++) {
    for (let x = eroded.bbox.left; x < eroded.bbox.right; x++) {
      const i = y * width + x;
      if (!eroded.mask[i] || seen[i]) continue;
      const comp = componentAt(eroded, x, y);
      for (let j = 0; j < comp.mask.length; j++) if (comp.mask[j]) seen[j] = 1;
      areas.push({ area: comp.count, bbox: comp.bbox });
    }
  }
  areas.sort((a, b) => b.area - a.area);
  const biggest = areas.length ? areas[0].area : 0;
  const lobes = areas.filter((a) => a.area >= minAreaShare * biggest).length;
  return { lobes, radius: r, maxDist, areas };
}

module.exports = {
  readRaw,
  floodFill,
  makeBox,
  maskRows,
  asciiMask,
  erode,
  dilate,
  open,
  withMask,
  distanceTransform,
  componentAt,
  isolate,
  integralOf,
  rectIsFull,
  largestInscribedRect,
  profiles,
  trim,
  detectTwoLobes,
  countLobes,
};
