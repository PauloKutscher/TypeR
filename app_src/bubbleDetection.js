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
  minFillRatio: 0.45,
  // Bounding box minimum in snapshot pixels
  minSizePx: 12,
  // Width/height ratio cap, either orientation
  maxAspect: 8,
  // A bubble is convex-ish: each row/column crosses it in one solid run.
  // White backdrops with art poking through split into many runs per line.
  maxRunsPerLine: 1.8,
  // A bubble is sealed by a dark outline: marching a few pixels outward from
  // the region edge must hit a dark pixel almost everywhere. White areas that
  // fade into light screentones or paper gray fail this.
  outlineDarkThreshold: 170,
  outlineProbeDepth: 3,
  minOutlineDarkRatio: 0.55,
  // Candidate extraction deliberately stays more permissive than the final
  // decision. User feedback can only recover a missed bubble if it exists in
  // this wider candidate pool.
  candidateMinAreaRatio: 0.00012,
  candidateMinFillRatio: 0.2,
  candidateMinSizePx: 8,
  candidateMaxAspect: 12,
};

const BUBBLE_LEARNING_VERSION = 1;
const BUBBLE_FEATURE_COUNT = 6;
const MAX_LEARNING_EXAMPLES = 240;
// These defaults reproduce the hand-written detector reasonably closely.
// Training is regularized towards them so a handful of clicks cannot make the
// model forget what a plausible bubble looks like.
const DEFAULT_LEARNING_WEIGHTS = [0.8, 2, 2.5, 0.2, 0.25, 0.15];
const DEFAULT_LEARNING_BIAS = -1.8;
const BUBBLE_SPLIT_FEATURE_COUNT = 4;
const MAX_SPLIT_EXAMPLES = 160;
const DEFAULT_SPLIT_WEIGHTS = [2.2, 1.2, 1, 0.6];
const DEFAULT_SPLIT_BIAS = -0.4;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const sigmoid = (value) => 1 / (1 + Math.exp(-clamp(value, -20, 20)));

const getBubbleFeatureVector = (bubble, imageData) => {
  const totalArea = Math.max(1, imageData.width * imageData.height);
  const minPageSide = Math.max(1, Math.min(imageData.width, imageData.height));
  const areaRatio = Math.max(1 / totalArea, bubble.area / totalArea);
  const aspect = Math.max(bubble.width / Math.max(1, bubble.height), bubble.height / Math.max(1, bubble.width));
  return [
    clamp((bubble.fillRatio - 0.45) / 0.35, -1, 1),
    clamp((1.8 - bubble.runsPerLine) / 0.8, -1, 1),
    clamp((bubble.outlineDarkRatio - 0.55) / 0.35, -1, 1),
    clamp(Math.log(areaRatio / 0.0005) / Math.log(12), -1, 1),
    clamp((Math.min(bubble.width, bubble.height) / minPageSide - 0.012) / 0.035, -1, 1),
    clamp((3 - aspect) / 2, -1, 1),
  ];
};

const normalizeBubbleLearning = (value) => {
  const input = value && value.version === BUBBLE_LEARNING_VERSION ? value : {};
  const examples = Array.isArray(input.examples)
    ? input.examples
      .filter((example) => example && Array.isArray(example.features) && example.features.length === BUBBLE_FEATURE_COUNT)
      .slice(-MAX_LEARNING_EXAMPLES)
      .map((example) => ({
        features: example.features.map((feature) => clamp(Number(feature) || 0, -1, 1)),
        label: example.label ? 1 : 0,
      }))
    : [];
  const weights = Array.isArray(input.weights) && input.weights.length === BUBBLE_FEATURE_COUNT
    ? input.weights.map((weight, index) => Number.isFinite(Number(weight)) ? Number(weight) : DEFAULT_LEARNING_WEIGHTS[index])
    : DEFAULT_LEARNING_WEIGHTS.slice();
  const splitExamples = Array.isArray(input.splitExamples)
    ? input.splitExamples
      .filter((example) => example && Array.isArray(example.features) && example.features.length === BUBBLE_SPLIT_FEATURE_COUNT)
      .slice(-MAX_SPLIT_EXAMPLES)
      .map((example) => ({
        features: example.features.map((feature) => clamp(Number(feature) || 0, -1, 1)),
        label: example.label ? 1 : 0,
      }))
    : [];
  return {
    version: BUBBLE_LEARNING_VERSION,
    weights,
    bias: Number.isFinite(Number(input.bias)) ? Number(input.bias) : DEFAULT_LEARNING_BIAS,
    examples,
    positiveSamples: examples.filter((example) => example.label === 1).length,
    negativeSamples: examples.filter((example) => example.label === 0).length,
    splitWeights: Array.isArray(input.splitWeights) && input.splitWeights.length === BUBBLE_SPLIT_FEATURE_COUNT
      ? input.splitWeights.map((weight, index) => Number.isFinite(Number(weight)) ? Number(weight) : DEFAULT_SPLIT_WEIGHTS[index])
      : DEFAULT_SPLIT_WEIGHTS.slice(),
    splitBias: Number.isFinite(Number(input.splitBias)) ? Number(input.splitBias) : DEFAULT_SPLIT_BIAS,
    splitExamples,
    splitPositiveSamples: splitExamples.filter((example) => example.label === 1).length,
    splitNegativeSamples: splitExamples.filter((example) => example.label === 0).length,
  };
};

const trainBubbleLearning = (value, featureVectors, label) => {
  const current = normalizeBubbleLearning(value);
  const examples = current.examples.slice();
  for (const vector of featureVectors || []) {
    if (!Array.isArray(vector) || vector.length !== BUBBLE_FEATURE_COUNT) continue;
    const features = vector.map((feature) => clamp(Number(feature) || 0, -1, 1));
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    for (let index = 0; index < examples.length; index++) {
      let distance = 0;
      for (let featureIndex = 0; featureIndex < BUBBLE_FEATURE_COUNT; featureIndex++) {
        const delta = examples[index].features[featureIndex] - features[featureIndex];
        distance += delta * delta;
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    // Re-label an almost identical example instead of accumulating opposing
    // clicks when the user immediately corrects an accidental exclusion.
    if (nearestIndex >= 0 && nearestDistance < 0.0025) {
      examples[nearestIndex] = { features, label: label ? 1 : 0 };
    } else {
      examples.push({ features, label: label ? 1 : 0 });
    }
  }
  if (examples.length > MAX_LEARNING_EXAMPLES) examples.splice(0, examples.length - MAX_LEARNING_EXAMPLES);

  const weights = DEFAULT_LEARNING_WEIGHTS.slice();
  let bias = DEFAULT_LEARNING_BIAS;
  const rawPositiveCount = examples.filter((example) => example.label === 1).length;
  const positiveCount = Math.max(1, rawPositiveCount);
  const negativeCount = Math.max(1, examples.length - rawPositiveCount);
  for (let epoch = 0; epoch < 70 && examples.length; epoch++) {
    const learningRate = 0.08 / (1 + epoch * 0.035);
    for (const example of examples) {
      let linear = bias;
      for (let index = 0; index < BUBBLE_FEATURE_COUNT; index++) linear += weights[index] * example.features[index];
      const classWeight = example.label ? examples.length / (2 * positiveCount) : examples.length / (2 * negativeCount);
      const error = (example.label - sigmoid(linear)) * classWeight;
      bias += learningRate * error;
      for (let index = 0; index < BUBBLE_FEATURE_COUNT; index++) {
        const regularization = (weights[index] - DEFAULT_LEARNING_WEIGHTS[index]) * 0.004;
        weights[index] += learningRate * (error * example.features[index] - regularization);
      }
    }
  }
  return normalizeBubbleLearning({ ...current, weights, bias, examples });
};

const getBubbleSplitFeatureVector = (suggestion) => suggestion ? [
  clamp((0.8 - suggestion.saddleRatio) / 0.5, -1, 1),
  clamp((suggestion.peakRatio - 0.42) / 0.5, -1, 1),
  clamp((suggestion.areaBalance - 0.2) / 0.65, -1, 1),
  clamp((suggestion.separationRatio - 0.8) / 1.4, -1, 1),
] : null;

const getBubbleSplitConfidence = (suggestion, learning) => {
  if (!suggestion) return 0;
  const model = normalizeBubbleLearning(learning);
  const features = suggestion.features || getBubbleSplitFeatureVector(suggestion);
  let linear = model.splitBias;
  for (let index = 0; index < BUBBLE_SPLIT_FEATURE_COUNT; index++) linear += model.splitWeights[index] * features[index];
  return sigmoid(linear);
};

const trainBubbleSplitLearning = (value, suggestions, label) => {
  const current = normalizeBubbleLearning(value);
  const splitExamples = current.splitExamples.slice();
  for (const suggestion of suggestions || []) {
    const vector = Array.isArray(suggestion) ? suggestion : getBubbleSplitFeatureVector(suggestion);
    if (!vector || vector.length !== BUBBLE_SPLIT_FEATURE_COUNT) continue;
    const features = vector.map((feature) => clamp(Number(feature) || 0, -1, 1));
    let nearestIndex = -1;
    let nearestDistance = Infinity;
    for (let index = 0; index < splitExamples.length; index++) {
      let distance = 0;
      for (let featureIndex = 0; featureIndex < BUBBLE_SPLIT_FEATURE_COUNT; featureIndex++) {
        const delta = splitExamples[index].features[featureIndex] - features[featureIndex];
        distance += delta * delta;
      }
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    if (nearestIndex >= 0 && nearestDistance < 0.0025) {
      splitExamples[nearestIndex] = { features, label: label ? 1 : 0 };
    } else {
      splitExamples.push({ features, label: label ? 1 : 0 });
    }
  }
  if (splitExamples.length > MAX_SPLIT_EXAMPLES) splitExamples.splice(0, splitExamples.length - MAX_SPLIT_EXAMPLES);
  const splitWeights = DEFAULT_SPLIT_WEIGHTS.slice();
  let splitBias = DEFAULT_SPLIT_BIAS;
  const rawPositiveCount = splitExamples.filter((example) => example.label === 1).length;
  const positiveCount = Math.max(1, rawPositiveCount);
  const negativeCount = Math.max(1, splitExamples.length - rawPositiveCount);
  for (let epoch = 0; epoch < 70 && splitExamples.length; epoch++) {
    const learningRate = 0.08 / (1 + epoch * 0.035);
    for (const example of splitExamples) {
      let linear = splitBias;
      for (let index = 0; index < BUBBLE_SPLIT_FEATURE_COUNT; index++) linear += splitWeights[index] * example.features[index];
      const classWeight = example.label ? splitExamples.length / (2 * positiveCount) : splitExamples.length / (2 * negativeCount);
      const error = (example.label - sigmoid(linear)) * classWeight;
      splitBias += learningRate * error;
      for (let index = 0; index < BUBBLE_SPLIT_FEATURE_COUNT; index++) {
        const regularization = (splitWeights[index] - DEFAULT_SPLIT_WEIGHTS[index]) * 0.004;
        splitWeights[index] += learningRate * (error * example.features[index] - regularization);
      }
    }
  }
  return normalizeBubbleLearning({ ...current, splitWeights, splitBias, splitExamples });
};

const getBubbleConfidence = (bubble, imageData, learning) => {
  const model = normalizeBubbleLearning(learning);
  const features = bubble.features || getBubbleFeatureVector(bubble, imageData);
  let linear = model.bias;
  for (let index = 0; index < BUBBLE_FEATURE_COUNT; index++) linear += model.weights[index] * features[index];
  return sigmoid(linear);
};

const getBubbleConfidenceThreshold = (sensitivity) => {
  let value = parseInt(sensitivity, 10);
  if (!Number.isFinite(value)) value = 5;
  return 0.78 - (clamp(value, 1, 9) - 1) * 0.055;
};

// The UI exposes one "sensitivity" knob instead of raw thresholds: higher
// values accept dirtier whites (scans, JPEG pages) and smaller bubbles.
const getDetectionOptions = (sensitivity) => {
  let s = parseInt(sensitivity, 10);
  if (!Number.isFinite(s)) s = 5;
  s = Math.min(9, Math.max(1, s));
  return {
    ...DEFAULT_DETECT_OPTIONS,
    sensitivity: s,
    whiteThreshold: 250 - s * 5,
    minAreaRatio: 0.0025 / s,
  };
};

const fillLocalHoles = (local, width, height) => {
  const exterior = new Uint8Array(local.length);
  const stack = [];
  const pushExterior = (index) => {
    if (index < 0 || index >= local.length || local[index] || exterior[index]) return;
    exterior[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < width; x++) {
    pushExterior(x);
    pushExterior((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    pushExterior(y * width);
    pushExterior(y * width + width - 1);
  }
  while (stack.length) {
    const index = stack.pop();
    const x = index % width;
    const y = (index / width) | 0;
    if (x > 0) pushExterior(index - 1);
    if (x < width - 1) pushExterior(index + 1);
    if (y > 0) pushExterior(index - width);
    if (y < height - 1) pushExterior(index + width);
  }
  const silhouette = new Uint8Array(local.length);
  for (let index = 0; index < local.length; index++) silhouette[index] = local[index] || !exterior[index] ? 1 : 0;
  return silhouette;
};

// Finds two substantial lobes separated by a narrow saddle in the component's
// distance map. Filling internal holes first prevents rasterized dialogue from
// creating fake lobes. The split plane can be horizontal, vertical or diagonal.
const findNeckSplit = (local, width, height) => {
  if (width < 18 || height < 18) return null;
  const silhouette = fillLocalHoles(local, width, height);
  const distance = new Uint16Array(local.length);
  const maxDistance = 30000;
  for (let index = 0; index < silhouette.length; index++) {
    if (!silhouette[index]) continue;
    const x = index % width;
    const y = (index / width) | 0;
    distance[index] = x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 3 : maxDistance;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (!distance[index]) continue;
      let value = distance[index];
      if (x > 0) value = Math.min(value, distance[index - 1] + 3);
      if (y > 0) value = Math.min(value, distance[index - width] + 3);
      if (x > 0 && y > 0) value = Math.min(value, distance[index - width - 1] + 4);
      if (x < width - 1 && y > 0) value = Math.min(value, distance[index - width + 1] + 4);
      distance[index] = value;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = y * width + x;
      if (!distance[index]) continue;
      let value = distance[index];
      if (x < width - 1) value = Math.min(value, distance[index + 1] + 3);
      if (y < height - 1) value = Math.min(value, distance[index + width] + 3);
      if (x < width - 1 && y < height - 1) value = Math.min(value, distance[index + width + 1] + 4);
      if (x > 0 && y < height - 1) value = Math.min(value, distance[index + width - 1] + 4);
      distance[index] = value;
    }
  }

  const minimumPeakDistance = Math.max(12, Math.min(width, height) * 0.09 * 3);
  const peakCandidates = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const index = y * width + x;
      const value = distance[index];
      if (value < minimumPeakDistance) continue;
      let isMaximum = true;
      let hasLowerNeighbor = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const neighbor = distance[(y + dy) * width + x + dx];
          if (neighbor > value) isMaximum = false;
          if (neighbor < value) hasLowerNeighbor = true;
        }
      }
      if (isMaximum && hasLowerNeighbor) peakCandidates.push({ x, y, radius: value / 3 });
    }
  }
  peakCandidates.sort((first, second) => second.radius - first.radius);
  const peaks = [];
  for (const candidate of peakCandidates) {
    if (peaks.length >= 8) break;
    const separated = peaks.every((peak) => {
      const dx = peak.x - candidate.x;
      const dy = peak.y - candidate.y;
      return Math.sqrt(dx * dx + dy * dy) >= Math.max(peak.radius, candidate.radius) * 0.72;
    });
    if (separated) peaks.push(candidate);
  }
  if (peaks.length < 2) return null;

  let best = null;
  for (let firstIndex = 0; firstIndex < peaks.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < peaks.length; secondIndex++) {
      const first = peaks[firstIndex];
      const second = peaks[secondIndex];
      const dx = second.x - first.x;
      const dy = second.y - first.y;
      const centerDistance = Math.sqrt(dx * dx + dy * dy);
      const peakRatio = Math.min(first.radius, second.radius) / Math.max(first.radius, second.radius);
      if (peakRatio < 0.42 || centerDistance < Math.max(first.radius, second.radius) * 0.9) continue;
      let saddleDistance = Infinity;
      let saddleStep = 20;
      for (let step = 7; step <= 33; step++) {
        const x = Math.round(first.x + dx * step / 40);
        const y = Math.round(first.y + dy * step / 40);
        const value = distance[y * width + x] / 3;
        if (value < saddleDistance) {
          saddleDistance = value;
          saddleStep = step;
        }
      }
      const smallerRadius = Math.min(first.radius, second.radius);
      const saddleRatio = saddleDistance / Math.max(1, smallerRadius);
      if (saddleRatio >= 0.86) continue;
      const splitX = first.x + dx * saddleStep / 40;
      const splitY = first.y + dy * saddleStep / 40;
      const splitProjection = splitX * dx + splitY * dy;
      const children = [
        { minX: width, minY: height, maxX: -1, maxY: -1, area: 0 },
        { minX: width, minY: height, maxX: -1, maxY: -1, area: 0 },
      ];
      let totalArea = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (!silhouette[y * width + x]) continue;
          const child = children[x * dx + y * dy <= splitProjection ? 0 : 1];
          child.area++;
          totalArea++;
          if (x < child.minX) child.minX = x;
          if (x > child.maxX) child.maxX = x;
          if (y < child.minY) child.minY = y;
          if (y > child.maxY) child.maxY = y;
        }
      }
      if (!children[0].area || !children[1].area) continue;
      const areaBalance = Math.min(children[0].area, children[1].area) / Math.max(children[0].area, children[1].area);
      if (areaBalance < 0.2 || Math.min(children[0].area, children[1].area) < totalArea * 0.16) continue;
      const separationRatio = centerDistance / Math.max(1, Math.max(first.radius, second.radius));
      const score = (1 - saddleRatio) * 1.8 + peakRatio + areaBalance * 0.8 + Math.min(2, separationRatio) * 0.2;
      if (!best || score > best.score) {
        best = { first, second, splitX, splitY, saddleRatio, peakRatio, areaBalance, separationRatio, children, score };
      }
    }
  }
  return best;
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

// Shape and outline analysis of one surviving candidate. Runs a second,
// bbox-local flood fill from the component's seed (cheap: candidates are
// already area-capped) to measure:
// - runsPerLine: average count of solid segments per occupied row/column.
//   Bubbles are convex-ish (≈1); enclosed backdrops with art poking through
//   are jagged (>>1).
// - outlineDarkRatio: fraction of edge probes that hit a dark pixel within
//   outlineProbeDepth when marching outward. Bubbles are sealed by their
//   outline (≈1); whites that fade into light tones are not.
const analyzeCandidate = (mask, imageData, bounds, seedIdx, opts) => {
  const { data, width, height } = imageData;
  const { minX, maxX, minY, maxY } = bounds;
  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;
  const local = new Uint8Array(boxWidth * boxHeight);
  const stack = [seedIdx];
  local[(((seedIdx / width) | 0) - minY) * boxWidth + ((seedIdx % width) - minX)] = 1;
  while (stack.length) {
    const idx = stack.pop();
    const x = idx % width;
    const y = (idx / width) | 0;
    const neighbors = [
      x > minX ? idx - 1 : -1,
      x < maxX ? idx + 1 : -1,
      y > minY ? idx - width : -1,
      y < maxY ? idx + width : -1,
    ];
    for (let n = 0; n < 4; n++) {
      const nIdx = neighbors[n];
      if (nIdx < 0 || !mask[nIdx]) continue;
      const localIdx = (((nIdx / width) | 0) - minY) * boxWidth + ((nIdx % width) - minX);
      if (local[localIdx]) continue;
      local[localIdx] = 1;
      stack.push(nIdx);
    }
  }

  let rowRuns = 0;
  let occupiedRows = 0;
  for (let y = 0; y < boxHeight; y++) {
    let runs = 0;
    let inRun = false;
    for (let x = 0; x < boxWidth; x++) {
      const filled = local[y * boxWidth + x];
      if (filled && !inRun) runs++;
      inRun = !!filled;
    }
    if (runs) {
      rowRuns += runs;
      occupiedRows++;
    }
  }
  let colRuns = 0;
  let occupiedCols = 0;
  for (let x = 0; x < boxWidth; x++) {
    let runs = 0;
    let inRun = false;
    for (let y = 0; y < boxHeight; y++) {
      const filled = local[y * boxWidth + x];
      if (filled && !inRun) runs++;
      inRun = !!filled;
    }
    if (runs) {
      colRuns += runs;
      occupiedCols++;
    }
  }
  const runsPerLine = Math.max(
    occupiedRows ? rowRuns / occupiedRows : 0,
    occupiedCols ? colRuns / occupiedCols : 0
  );

  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  let samples = 0;
  let sealed = 0;
  for (let y = 0; y < boxHeight; y++) {
    for (let x = 0; x < boxWidth; x++) {
      if (!local[y * boxWidth + x]) continue;
      const globalX = x + minX;
      const globalY = y + minY;
      for (let d = 0; d < 4; d++) {
        const dx = directions[d][0];
        const dy = directions[d][1];
        const nx = globalX + dx;
        const ny = globalY + dy;
        const inBox = nx >= minX && nx <= maxX && ny >= minY && ny <= maxY;
        if (inBox && local[(ny - minY) * boxWidth + (nx - minX)]) continue;
        samples++;
        for (let depth = 1; depth <= opts.outlineProbeDepth; depth++) {
          const px = globalX + dx * depth;
          const py = globalY + dy * depth;
          if (px < 0 || py < 0 || px >= width || py >= height) break;
          const p = (py * width + px) * 4;
          const luma = data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
          if (luma < opts.outlineDarkThreshold) {
            sealed++;
            break;
          }
        }
      }
    }
  }
  const outlineDarkRatio = samples ? sealed / samples : 0;

  return {
    runsPerLine,
    outlineDarkRatio,
    splitSuggestion: opts.detectSplits ? findNeckSplit(local, boxWidth, boxHeight) : null,
  };
};

// Connected components (4-connectivity, iterative flood fill) over the white
// mask, then geometric filtering. Coordinates are snapshot pixels; `right` and
// `bottom` are exclusive so width = right - left.
const detectBubbleCandidates = (imageData, options) => {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...(options || {}) };
  const { width, height } = imageData;
  const totalArea = width * height;
  if (!totalArea) return [];
  const mask = buildWhiteMask(imageData, opts.whiteThreshold);
  const visited = new Uint8Array(totalArea);
  const minArea = Math.max(20, Math.floor(totalArea * opts.candidateMinAreaRatio));
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
    if (boxWidth < opts.candidateMinSizePx || boxHeight < opts.candidateMinSizePx) continue;
    const aspect = boxWidth > boxHeight ? boxWidth / boxHeight : boxHeight / boxWidth;
    if (aspect > opts.candidateMaxAspect) continue;
    const fillRatio = area / (boxWidth * boxHeight);
    if (fillRatio < opts.candidateMinFillRatio) continue;
    const shape = analyzeCandidate(mask, imageData, { minX, maxX, minY, maxY }, start, opts);
    const bubble = {
      left: minX,
      top: minY,
      right: maxX + 1,
      bottom: maxY + 1,
      width: boxWidth,
      height: boxHeight,
      area,
      fillRatio,
      runsPerLine: shape.runsPerLine,
      outlineDarkRatio: shape.outlineDarkRatio,
      splitSuggestion: shape.splitSuggestion,
      xMid: (minX + maxX + 1) / 2,
      yMid: (minY + maxY + 1) / 2,
    };
    bubble.features = getBubbleFeatureVector(bubble, imageData);
    bubbles.push(bubble);
  }
  return bubbles;
};

const detectBubbles = (imageData, options) => {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...(options || {}) };
  const minArea = Math.max(20, Math.floor(imageData.width * imageData.height * opts.minAreaRatio));
  return detectBubbleCandidates(imageData, opts).filter((bubble) => {
    const aspect = Math.max(bubble.width / bubble.height, bubble.height / bubble.width);
    return bubble.area >= minArea &&
      bubble.width >= opts.minSizePx &&
      bubble.height >= opts.minSizePx &&
      aspect <= opts.maxAspect &&
      bubble.fillRatio >= opts.minFillRatio &&
      bubble.runsPerLine <= opts.maxRunsPerLine &&
      bubble.outlineDarkRatio >= opts.minOutlineDarkRatio;
  });
};

const getBoundsIoU = (first, second) => {
  const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
  const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
  const intersection = overlapWidth * overlapHeight;
  const firstArea = Math.max(0, first.right - first.left) * Math.max(0, first.bottom - first.top);
  const secondArea = Math.max(0, second.right - second.left) * Math.max(0, second.bottom - second.top);
  const union = firstArea + secondArea - intersection;
  return union ? intersection / union : 0;
};

const findCandidateForBounds = (candidates, bounds) => {
  let best = null;
  let bestIoU = 0;
  for (const candidate of candidates || []) {
    const iou = getBoundsIoU(candidate, bounds);
    if (iou > bestIoU) {
      best = candidate;
      bestIoU = iou;
    }
  }
  return bestIoU >= 0.18 ? best : null;
};

const findManualSplitSuggestion = (bounds, imageData) => {
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (width < 18 || height < 18) return null;
  const mask = buildWhiteMask(imageData, 210);
  const local = new Uint8Array(width * height);
  const centerX = Math.floor((bounds.left + bounds.right) / 2);
  const centerY = Math.floor((bounds.top + bounds.bottom) / 2);
  let seed = -1;
  let bestDistance = Infinity;
  for (let y = bounds.top; y < bounds.bottom; y++) {
    for (let x = bounds.left; x < bounds.right; x++) {
      const index = y * imageData.width + x;
      if (!mask[index]) continue;
      const distance = (x - centerX) * (x - centerX) + (y - centerY) * (y - centerY);
      if (distance < bestDistance) {
        bestDistance = distance;
        seed = index;
      }
    }
  }
  if (seed < 0) return null;
  const stack = [seed];
  const seedLocal = (((seed / imageData.width) | 0) - bounds.top) * width + (seed % imageData.width - bounds.left);
  local[seedLocal] = 1;
  while (stack.length) {
    const index = stack.pop();
    const x = index % imageData.width;
    const y = (index / imageData.width) | 0;
    const neighbors = [
      x > bounds.left ? index - 1 : -1,
      x < bounds.right - 1 ? index + 1 : -1,
      y > bounds.top ? index - imageData.width : -1,
      y < bounds.bottom - 1 ? index + imageData.width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || !mask[neighbor]) continue;
      const localIndex = (((neighbor / imageData.width) | 0) - bounds.top) * width + (neighbor % imageData.width - bounds.left);
      if (local[localIndex]) continue;
      local[localIndex] = 1;
      stack.push(neighbor);
    }
  }
  return findNeckSplit(local, width, height);
};

const createManualBubble = (bounds, imageData, matchedCandidate) => {
  const left = clamp(Math.floor(bounds.left), 0, imageData.width - 1);
  const top = clamp(Math.floor(bounds.top), 0, imageData.height - 1);
  const right = clamp(Math.ceil(bounds.right), left + 1, imageData.width);
  const bottom = clamp(Math.ceil(bounds.bottom), top + 1, imageData.height);
  const width = right - left;
  const height = bottom - top;
  const source = matchedCandidate || {};
  const bubble = {
    left,
    top,
    right,
    bottom,
    width,
    height,
    area: source.area || width * height,
    fillRatio: Number.isFinite(source.fillRatio) ? source.fillRatio : 0.75,
    runsPerLine: Number.isFinite(source.runsPerLine) ? source.runsPerLine : 1.25,
    outlineDarkRatio: Number.isFinite(source.outlineDarkRatio) ? source.outlineDarkRatio : 0.7,
    splitSuggestion: source.splitSuggestion || findManualSplitSuggestion({ left, top, right, bottom }, imageData),
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
    manual: true,
  };
  bubble.features = source.features || getBubbleFeatureVector(bubble, imageData);
  bubble.confidence = 1;
  return bubble;
};

const createSplitBubbles = (bubble, imageData) => {
  const suggestion = bubble && bubble.splitSuggestion;
  if (!suggestion || !Array.isArray(suggestion.children) || suggestion.children.length !== 2) return [];
  const padding = Math.max(1, Math.round(Math.min(bubble.width, bubble.height) * 0.015));
  return suggestion.children.map((child) => {
    const left = clamp(bubble.left + child.minX - padding, bubble.left, bubble.right - 1);
    const top = clamp(bubble.top + child.minY - padding, bubble.top, bubble.bottom - 1);
    const right = clamp(bubble.left + child.maxX + 1 + padding, left + 1, bubble.right);
    const bottom = clamp(bubble.top + child.maxY + 1 + padding, top + 1, bubble.bottom);
    const width = right - left;
    const height = bottom - top;
    const splitBubble = {
      left,
      top,
      right,
      bottom,
      width,
      height,
      area: child.area,
      fillRatio: clamp(child.area / Math.max(1, width * height), 0, 1),
      runsPerLine: bubble.runsPerLine,
      outlineDarkRatio: bubble.outlineDarkRatio,
      xMid: (left + right) / 2,
      yMid: (top + bottom) / 2,
      splitChild: true,
    };
    splitBubble.features = getBubbleFeatureVector(splitBubble, imageData);
    splitBubble.confidence = bubble.confidence;
    return splitBubble;
  });
};

// Experimental learned pipeline promoted by the user after training a first
// local model. It ranks the permissive candidate pool, then expands confident
// neck splits into independent bubbles. The legacy detectBubbles function is
// kept intact as a stable fallback and for regression comparisons.
const detectLearnedBubbles = (imageData, options, learning) => {
  const opts = { ...DEFAULT_DETECT_OPTIONS, ...(options || {}), detectSplits: true };
  const confidenceThreshold = getBubbleConfidenceThreshold(opts.sensitivity || 5);
  const splitThreshold = Number.isFinite(opts.splitConfidenceThreshold) ? opts.splitConfidenceThreshold : 0.62;
  const result = [];
  detectBubbleCandidates(imageData, opts).forEach((bubble) => {
    const confidence = getBubbleConfidence(bubble, imageData, learning);
    if (confidence < confidenceThreshold) return;
    const learnedBubble = { ...bubble, confidence };
    if (learnedBubble.splitSuggestion && getBubbleSplitConfidence(learnedBubble.splitSuggestion, learning) >= splitThreshold) {
      const children = createSplitBubbles(learnedBubble, imageData);
      if (children.length === 2) {
        result.push(...children.map((child) => ({ ...child, splitParentBounds: {
          left: learnedBubble.left,
          top: learnedBubble.top,
          right: learnedBubble.right,
          bottom: learnedBubble.bottom,
        } })));
        return;
      }
    }
    result.push(learnedBubble);
  });
  return result;
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
  BUBBLE_LEARNING_VERSION,
  getDetectionOptions,
  getBubbleFeatureVector,
  normalizeBubbleLearning,
  trainBubbleLearning,
  getBubbleConfidence,
  getBubbleConfidenceThreshold,
  getBubbleSplitFeatureVector,
  getBubbleSplitConfidence,
  trainBubbleSplitLearning,
  detectBubbleCandidates,
  detectBubbles,
  findCandidateForBounds,
  createManualBubble,
  createSplitBubbles,
  detectLearnedBubbles,
  orderBubbles,
  bubbleToSelection,
  getNextUsableLineIndex,
  assignLinesToBubbles,
  findLineByDisplayNumber,
};
