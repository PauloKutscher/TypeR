// Detection of merged speech bubbles from a selection mask.
//
// The Photoshop side exports the current selection as a small grayscale
// image; everything else happens here on real pixels: fill the text holes,
// compute a distance transform, erode until the mask falls apart into
// several solid cores (the neck between joined bubbles is thin, so it
// vanishes first), then grow each core back over the mask (watershed) to
// recover the individual bubbles.

// Masks are Uint8Array of 0/1, row-major, width * height.

// Zero areas not reachable from the border are holes (text glyphs inside
// the bubble): fill them so they don't break the distance transform
const fillMaskHoles = (mask, width, height) => {
  const outside = new Uint8Array(width * height);
  const stack = [];
  const push = (i) => {
    if (!mask[i] && !outside[i]) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  const filled = new Uint8Array(mask);
  for (let i = 0; i < filled.length; i++) {
    if (!filled[i] && !outside[i]) filled[i] = 1;
  }
  return filled;
};

// Two-pass chamfer 3-4 distance transform: distance from each mask pixel to
// the nearest background pixel, in thirds of a pixel
const distanceTransform = (mask, width, height) => {
  const INF = 1 << 29;
  const dist = new Int32Array(width * height);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? INF : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x > 0 && dist[i - 1] + 3 < d) d = dist[i - 1] + 3;
      if (y > 0) {
        if (dist[i - width] + 3 < d) d = dist[i - width] + 3;
        if (x > 0 && dist[i - width - 1] + 4 < d) d = dist[i - width - 1] + 4;
        if (x < width - 1 && dist[i - width + 1] + 4 < d) d = dist[i - width + 1] + 4;
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!dist[i]) continue;
      let d = dist[i];
      if (x < width - 1 && dist[i + 1] + 3 < d) d = dist[i + 1] + 3;
      if (y < height - 1) {
        if (dist[i + width] + 3 < d) d = dist[i + width] + 3;
        if (x < width - 1 && dist[i + width + 1] + 4 < d) d = dist[i + width + 1] + 4;
        if (x > 0 && dist[i + width - 1] + 4 < d) d = dist[i + width - 1] + 4;
      }
      dist[i] = d;
    }
  }
  return dist;
};

// Connected components (4-neighborhood) of pixels where dist > threshold.
// Returns per-component {area, maxDist, seed pixels are labeled in labels}
const labelCores = (dist, width, height, threshold, labels) => {
  labels.fill(0);
  const comps = [];
  const queue = new Int32Array(width * height);
  for (let start = 0; start < dist.length; start++) {
    if (dist[start] <= threshold || labels[start]) continue;
    const id = comps.length + 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = id;
    let area = 0;
    let maxDist = 0;
    while (head < tail) {
      const i = queue[head++];
      area++;
      if (dist[i] > maxDist) maxDist = dist[i];
      const x = i % width;
      const y = (i - x) / width;
      if (x > 0 && dist[i - 1] > threshold && !labels[i - 1]) { labels[i - 1] = id; queue[tail++] = i - 1; }
      if (x < width - 1 && dist[i + 1] > threshold && !labels[i + 1]) { labels[i + 1] = id; queue[tail++] = i + 1; }
      if (y > 0 && dist[i - width] > threshold && !labels[i - width]) { labels[i - width] = id; queue[tail++] = i - width; }
      if (y < height - 1 && dist[i + width] > threshold && !labels[i + width]) { labels[i + width] = id; queue[tail++] = i + width; }
    }
    comps.push({ id, area, maxDist });
  }
  return comps;
};

// Grow the labeled cores back over the whole mask, breadth-first: each mask
// pixel joins the nearest core, which partitions the neck fairly
const growCoresOverMask = (mask, width, height, labels) => {
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]) queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const id = labels[i];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0 && mask[i - 1] && !labels[i - 1]) { labels[i - 1] = id; queue[tail++] = i - 1; }
    if (x < width - 1 && mask[i + 1] && !labels[i + 1]) { labels[i + 1] = id; queue[tail++] = i + 1; }
    if (y > 0 && mask[i - width] && !labels[i - width]) { labels[i - width] = id; queue[tail++] = i - width; }
    if (y < height - 1 && mask[i + width] && !labels[i + width]) { labels[i + width] = id; queue[tail++] = i + width; }
  }
};

// Main analysis: split a selection mask into 2..maxBubbles bubbles.
// Returns [{left, top, right, bottom, area, cx, cy}] in mask pixel
// coordinates, or null when the mask is a single bubble.
const splitMaskIntoBubbles = (mask, width, height, maxBubbles = 3) => {
  if (!mask || width < 8 || height < 8) return null;
  const filled = fillMaskHoles(mask, width, height);
  let maskArea = 0;
  for (let i = 0; i < filled.length; i++) maskArea += filled[i];
  if (maskArea < 200) return null;

  const dist = distanceTransform(filled, width, height);
  let maxDist = 0;
  for (let i = 0; i < dist.length; i++) {
    if (dist[i] > maxDist) maxDist = dist[i];
  }
  const rMax = maxDist / 3;
  if (rMax < 4) return null;

  // Erode with a growing radius; a real bubble core must be both large and
  // thick (lobes of spiky/cloud bubbles are thin and get filtered out)
  const minCoreArea = Math.max(16, maskArea * 0.008);
  const minCoreDist = maxDist * 0.45;
  const labels = new Int32Array(width * height);
  let best = null;
  const steps = 32;
  for (let s = 2; s < steps; s++) {
    const r = (rMax * s) / steps;
    const comps = labelCores(dist, width, height, r * 3, labels);
    const solid = comps.filter((comp) => comp.area >= minCoreArea && comp.maxDist >= minCoreDist);
    if (!solid.length) break;
    if (solid.length >= 2 && (!best || solid.length > best.count)) {
      best = { r, count: Math.min(solid.length, maxBubbles) };
      if (best.count >= maxBubbles) break;
    }
  }
  if (!best) return null;

  // Re-run the winning erosion, keep the biggest cores, grow them back
  const comps = labelCores(dist, width, height, best.r * 3, labels);
  const solid = comps
    .filter((comp) => comp.area >= minCoreArea && comp.maxDist >= minCoreDist)
    .sort((a, b) => b.area - a.area)
    .slice(0, maxBubbles);
  if (solid.length < 2) return null;
  const keep = new Set(solid.map((comp) => comp.id));
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && !keep.has(labels[i])) labels[i] = 0;
  }
  growCoresOverMask(filled, width, height, labels);

  const byId = new Map();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const id = labels[i];
      if (!id) continue;
      let bubble = byId.get(id);
      if (!bubble) {
        bubble = { left: x, top: y, right: x, bottom: y, area: 0, sumX: 0, sumY: 0, peak: -1, px: x, py: y };
        byId.set(id, bubble);
      }
      if (x < bubble.left) bubble.left = x;
      if (x > bubble.right) bubble.right = x;
      if (y < bubble.top) bubble.top = y;
      if (y > bubble.bottom) bubble.bottom = y;
      bubble.area++;
      bubble.sumX += x;
      bubble.sumY += y;
      // Deepest point of the bubble = center of its inscribed circle: the
      // best spot to center text on, robust against the shared neck area
      if (dist[i] > bubble.peak) {
        bubble.peak = dist[i];
        bubble.px = x;
        bubble.py = y;
      }
    }
  }
  const bubbles = [];
  byId.forEach((bubble) => {
    bubbles.push({
      left: bubble.left,
      top: bubble.top,
      right: bubble.right + 1,
      bottom: bubble.bottom + 1,
      area: bubble.area,
      cx: (bubble.sumX / bubble.area + bubble.px) / 2,
      cy: (bubble.sumY / bubble.area + bubble.py) / 2,
    });
  });

  // A real multi-bubble splits into comparable parts: a sliver means the
  // erosion cut off an artifact, not a bubble — better to not split at all
  for (let i = 0; i < bubbles.length; i++) {
    if (bubbles[i].area < maskArea * 0.08) return null;
  }
  return bubbles.length >= 2 ? bubbles : null;
};

// Reading order: the topmost bubble first; when two bubbles share most of
// their vertical range, the rightmost one first
const sortBubblesReadingOrder = (bubbles) => {
  return [...bubbles].sort((a, b) => {
    const overlap = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const minHeight = Math.min(a.bottom - a.top, b.bottom - b.top);
    if (minHeight > 0 && overlap > minHeight * 0.5) {
      return (b.left + b.right) - (a.left + a.right);
    }
    return a.top - b.top;
  });
};

export { fillMaskHoles, distanceTransform, splitMaskIntoBubbles, sortBubblesReadingOrder };
