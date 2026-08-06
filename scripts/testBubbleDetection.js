const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(
  path.join(rootDir, "app_src", "bubbleDetection.js"),
  "utf8"
);
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const moduleShim = { exports: {} };
new Function("require", "module", "exports", transformed)(
  require,
  moduleShim,
  moduleShim.exports
);

const {
  getDetectionOptions,
  getBubbleFeatureVector,
  getBubbleConfidence,
  normalizeBubbleLearning,
  trainBubbleLearning,
  getBubbleSplitConfidence,
  trainBubbleSplitLearning,
  detectBubbleCandidates,
  detectBubbles,
  detectLearnedBubbles,
  findCandidateForBounds,
  createManualBubble,
  createSplitBubbles,
  orderBubbles,
  bubbleToSelection,
  assignLinesToBubbles,
  findLineByDisplayNumber,
} = moduleShim.exports;

// ---- synthetic page helpers -------------------------------------------------

const makeImage = (width, height, gray) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = gray;
    data[i * 4 + 1] = gray;
    data[i * 4 + 2] = gray;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
};

const fillRect = (image, left, top, right, bottom, gray) => {
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const p = (y * image.width + x) * 4;
      image.data[p] = gray;
      image.data[p + 1] = gray;
      image.data[p + 2] = gray;
    }
  }
};

const fillEllipse = (image, centerX, centerY, radiusX, radiusY, gray) => {
  for (let y = Math.floor(centerY - radiusY); y <= Math.ceil(centerY + radiusY); y++) {
    for (let x = Math.floor(centerX - radiusX); x <= Math.ceil(centerX + radiusX); x++) {
      if (((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 > 1) continue;
      const p = (y * image.width + x) * 4;
      image.data[p] = gray;
      image.data[p + 1] = gray;
      image.data[p + 2] = gray;
    }
  }
};

// ---- detection --------------------------------------------------------------

// Dark page with two white bubbles, a thin white sliver, and a white margin
// strip touching the border.
const page = makeImage(200, 150, 90);
fillRect(page, 20, 20, 70, 60, 255); // bubble A (left)
fillRect(page, 120, 25, 180, 70, 255); // bubble B (right)
fillRect(page, 20, 100, 180, 104, 255); // thin sliver: too flat, rejected
fillRect(page, 0, 130, 200, 150, 255); // touches the border: rejected
// Text glyphs inside bubble A must not split it in two
fillRect(page, 30, 30, 40, 34, 0);
fillRect(page, 45, 40, 60, 44, 0);

const detected = detectBubbles(page, getDetectionOptions(5));
assert.strictEqual(detected.length, 2, "Exactly the two bubbles must be detected");
const [first, second] = detected.slice().sort((a, b) => a.left - b.left);
assert.strictEqual(first.left, 20, "Bubble A left edge");
assert.strictEqual(first.right, 70, "Bubble A right edge");
assert.strictEqual(second.top, 25, "Bubble B top edge");
assert(first.fillRatio > 0.9, "Text glyphs must not break the bubble fill ratio");

// A jagged white region (art poking through a backdrop) must be rejected by
// the runs-per-line filter even though its fill ratio is decent: three
// vertical teeth joined by a base, fill ratio 0.7 but 3 runs on most rows.
const jaggedPage = makeImage(200, 150, 90);
fillRect(jaggedPage, 20, 20, 30, 50, 255);
fillRect(jaggedPage, 40, 20, 50, 50, 255);
fillRect(jaggedPage, 60, 20, 70, 50, 255);
fillRect(jaggedPage, 20, 50, 70, 60, 255);
assert.strictEqual(
  detectBubbles(jaggedPage, getDetectionOptions(5)).length,
  0,
  "Jagged comb-shaped regions must be rejected by the runs-per-line filter"
);

// A white region sealed only by light gray (a backdrop fading into paper or
// light screentone, no dark outline) must be rejected by the outline probe.
const unsealedPage = makeImage(200, 150, 90);
fillRect(unsealedPage, 110, 80, 175, 130, 210); // light-gray surround
fillRect(unsealedPage, 120, 90, 165, 120, 255); // white core, no dark ring
assert.strictEqual(
  detectBubbles(unsealedPage, getDetectionOptions(5)).length,
  0,
  "White regions without a dark outline must be rejected"
);

// A near-white bubble (scanned page) appears only at higher sensitivity
const dirtyPage = makeImage(200, 150, 90);
fillRect(dirtyPage, 40, 40, 100, 90, 218);
assert.strictEqual(
  detectBubbles(dirtyPage, getDetectionOptions(3)).length,
  0,
  "Low sensitivity must reject off-white regions"
);
assert.strictEqual(
  detectBubbles(dirtyPage, getDetectionOptions(8)).length,
  1,
  "High sensitivity must accept off-white regions"
);

// ---- local learning ---------------------------------------------------------

const falsePositivePage = makeImage(200, 150, 90);
fillRect(falsePositivePage, 40, 35, 90, 80, 255);
const falsePositive = detectBubbleCandidates(falsePositivePage, getDetectionOptions(5))[0];
const initialConfidence = getBubbleConfidence(falsePositive, falsePositivePage, null);
const negativeLearning = trainBubbleLearning(null, [falsePositive.features], false);
assert(
  getBubbleConfidence(falsePositive, falsePositivePage, negativeLearning) < initialConfidence,
  "Excluding a false positive must lower the confidence of similar candidates"
);
assert.strictEqual(negativeLearning.negativeSamples, 1, "Negative feedback must be persisted as one example");
assert.strictEqual(
  detectBubbles(falsePositivePage, { ...getDetectionOptions(5), learning: negativeLearning }).length,
  1,
  "Experimental learning must not change the normal stable detector"
);
assert.strictEqual(
  detectLearnedBubbles(falsePositivePage, getDetectionOptions(5), negativeLearning).length,
  0,
  "The promoted learned detector must apply negative training feedback"
);

const weakBubble = {
  width: 20,
  height: 20,
  area: 400,
  fillRatio: 0.5,
  runsPerLine: 1.7,
  outlineDarkRatio: 0.5,
};
const weakFeatures = getBubbleFeatureVector(weakBubble, falsePositivePage);
const weakCandidate = { ...weakBubble, features: weakFeatures };
const positiveLearning = trainBubbleLearning(null, [weakFeatures], true);
assert(
  getBubbleConfidence(weakCandidate, falsePositivePage, positiveLearning) >
    getBubbleConfidence(weakCandidate, falsePositivePage, normalizeBubbleLearning(null)),
  "Adding a missed bubble must raise the confidence of similar candidates"
);
assert.strictEqual(positiveLearning.positiveSamples, 1, "Positive feedback must be persisted as one example");

const matched = findCandidateForBounds([falsePositive], { left: 38, top: 34, right: 92, bottom: 82 });
assert.strictEqual(matched, falsePositive, "A Photoshop selection must match an overlapping hidden candidate");
const manualBubble = createManualBubble(
  { left: 10, top: 15, right: 45, bottom: 55 },
  falsePositivePage,
  falsePositive
);
assert.strictEqual(manualBubble.manual, true, "A manually selected bubble must remain identifiable");
assert.strictEqual(manualBubble.width, 35, "Manual bubble bounds must use snapshot coordinates");

// A connected peanut shape has two distance-map peaks separated by a narrow
// saddle and must be offered as two bubble instances. A plain oval must not.
const doubleBubblePage = makeImage(500, 700, 50);
fillEllipse(doubleBubblePage, 250, 220, 70, 78, 255);
fillEllipse(doubleBubblePage, 250, 355, 62, 82, 255);
const doubleCandidate = detectBubbleCandidates(doubleBubblePage, { ...getDetectionOptions(5), detectSplits: true })[0];
assert(doubleCandidate.splitSuggestion, "A connected double bubble must expose a split suggestion");
const splitChildren = createSplitBubbles(doubleCandidate, doubleBubblePage);
assert.strictEqual(splitChildren.length, 2, "A split suggestion must create exactly two bubble instances");
assert(splitChildren[0].yMid < splitChildren[1].yMid, "Vertical double bubbles must split into top and bottom instances");
assert.strictEqual(
  detectLearnedBubbles(doubleBubblePage, getDetectionOptions(5), normalizeBubbleLearning(null)).length,
  2,
  "The promoted learned detector must return connected double bubbles as two instances"
);
const manualDouble = createManualBubble(
  { left: doubleCandidate.left, top: doubleCandidate.top, right: doubleCandidate.right, bottom: doubleCandidate.bottom },
  doubleBubblePage,
  null
);
assert(manualDouble.splitSuggestion, "A manually added double bubble must also offer a split");

const ovalPage = makeImage(500, 700, 50);
fillEllipse(ovalPage, 250, 290, 70, 140, 255);
const ovalCandidate = detectBubbleCandidates(ovalPage, { ...getDetectionOptions(5), detectSplits: true })[0];
assert.strictEqual(ovalCandidate.splitSuggestion, null, "A single elongated oval must not be split");

const splitConfidence = getBubbleSplitConfidence(doubleCandidate.splitSuggestion, null);
const rejectedSplitLearning = trainBubbleSplitLearning(null, [doubleCandidate.splitSuggestion], false);
assert(
  getBubbleSplitConfidence(doubleCandidate.splitSuggestion, rejectedSplitLearning) < splitConfidence,
  "Merging an automatic split must lower the confidence of similar splits"
);
const acceptedSplitLearning = trainBubbleSplitLearning(rejectedSplitLearning, [doubleCandidate.splitSuggestion], true);
assert.strictEqual(acceptedSplitLearning.splitPositiveSamples, 1, "Confirming a split must persist one positive split example");

// ---- reading order ----------------------------------------------------------

const bubbles = [
  { id: 0, top: 20, bottom: 60, height: 40, xMid: 45, yMid: 40 },
  { id: 1, top: 25, bottom: 70, height: 45, xMid: 150, yMid: 47 },
  { id: 2, top: 90, bottom: 130, height: 40, xMid: 100, yMid: 110 },
];
assert.deepStrictEqual(
  orderBubbles(bubbles, true).map((bubble) => bubble.id),
  [1, 0, 2],
  "RTL order must read the top row right to left before the next row"
);
assert.deepStrictEqual(
  orderBubbles(bubbles, false).map((bubble) => bubble.id),
  [0, 1, 2],
  "LTR order must read the top row left to right"
);

// ---- document scaling -------------------------------------------------------

const selection = bubbleToSelection({ left: 10, top: 20, right: 40, bottom: 60 }, 2, 2);
assert.deepStrictEqual(
  selection,
  { top: 40, left: 20, right: 80, bottom: 120, width: 60, height: 80, xMid: 50, yMid: 80 },
  "Snapshot bounds must scale to document pixels in the stored-selection shape"
);

// ---- line assignment --------------------------------------------------------

const lines = [
  { rawIndex: 0, rawText: "Page 1", ignore: true, index: 0 },
  { rawIndex: 1, rawText: "1: Hello", ignore: false, index: 1 },
  { rawIndex: 2, rawText: "## note", ignore: true, index: 0 },
  { rawIndex: 3, rawText: "2: World", ignore: false, index: 2 },
  { rawIndex: 4, rawText: "3: Again", ignore: false, index: 3 },
  { rawIndex: 5, rawText: "Page 2", ignore: true, index: 0 },
  { rawIndex: 6, rawText: "1: Next page", ignore: false, index: 1 },
];

assert.deepStrictEqual(
  assignLinesToBubbles([{ id: "a" }, { id: "b" }, { id: "c" }], lines, 0),
  { a: 1, b: 3, c: 4 },
  "Bubbles must map to consecutive usable lines, skipping ignored ones"
);
assert.deepStrictEqual(
  assignLinesToBubbles([{ id: "a" }, { id: "b", manualLineIndex: 4 }, { id: "c" }], lines, 0),
  { a: 1, b: 4, c: 6 },
  "A manual line override must cascade to the following bubbles"
);
assert.deepStrictEqual(
  assignLinesToBubbles([{ id: "a" }, { id: "b" }], lines, 6),
  { a: 6, b: null },
  "Running out of lines must assign null instead of wrapping"
);

assert.strictEqual(
  findLineByDisplayNumber(lines, 2, 1),
  3,
  "Display numbers must resolve within the current page first"
);
assert.strictEqual(
  findLineByDisplayNumber(lines, 1, 6),
  6,
  "A display number on a later page must resolve to that page's line"
);
assert.strictEqual(
  findLineByDisplayNumber(lines, 3, 6),
  4,
  "A number missing on the current page must fall back to earlier pages"
);
assert.strictEqual(
  findLineByDisplayNumber(lines, 99, 0),
  null,
  "Unknown display numbers must resolve to null"
);

console.log("bubble detection tests passed");
