const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");
const { loadAppModule } = require("./loadAppModule");

const rootDir = path.resolve(__dirname, "..");
const { getStoredSelectionLineIndex, isDuplicateSelection } = loadAppModule(
  path.join(rootDir, "app_src", "multiBubbleHistory.js")
);

const bubble = (left, top, width, height) => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
  xMid: left + width / 2,
  yMid: top + height / 2,
});

const storedBubbles = [bubble(328, 714, 132, 210), bubble(58, 714, 153, 240)];

assert.strictEqual(isDuplicateSelection(storedBubbles, bubble(328, 714, 132, 210)), true, "Same bubble again is a duplicate");
assert.strictEqual(isDuplicateSelection(storedBubbles, bubble(331, 716, 132, 210)), true, "A few pixels off is still the same bubble");
assert.strictEqual(isDuplicateSelection(storedBubbles, bubble(58, 1125, 86, 145)), false, "A different bubble must be stored");
assert.strictEqual(isDuplicateSelection(storedBubbles, bubble(328, 714, 180, 260)), false, "Growing past the tolerance is a new selection");
assert.strictEqual(isDuplicateSelection([], bubble(0, 0, 10, 10)), false, "Nothing stored yet, nothing to match");
assert.strictEqual(isDuplicateSelection(storedBubbles, null), false, "No selection, no duplicate");

// The host must catch a union by geometry: the Shift key it reports is not
// reliable across Photoshop versions, and the "Add to selection" tool mode
// never presses a key at all
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");
const unionGuard = hostSource.match(/\n( *)if \(!isSame && monitor\.lastBounds[\s\S]*?multipleSelections: true/);
assert.ok(unionGuard, "The union guard must not depend on the reported Shift key");

const lines = [
  { rawIndex: 0, rawText: "Page 1", ignore: true },
  { rawIndex: 1, rawText: "First page, first line", ignore: false },
  { rawIndex: 2, rawText: "First page, second line", ignore: false },
  { rawIndex: 3, rawText: "Page 2", ignore: true },
  { rawIndex: 4, rawText: "// Translator note", ignore: true },
  { rawIndex: 5, rawText: "Second page, first line", ignore: false },
  { rawIndex: 6, rawText: "Second page, second line", ignore: false },
];

assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 7 }, 12),
  7,
  "A removed selection must restore the text line it captured"
);
assert.strictEqual(
  getStoredSelectionLineIndex(null, 12),
  12,
  "Missing legacy selection history must keep the current text line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({}, 12),
  12,
  "Selections without a line index must keep the current text line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 2 }, 5, lines),
  5,
  "Removing a selection from the previous page must stay on the first line of the current page"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 5 }, 6, lines),
  5,
  "Removing a selection from the current page must still restore its captured line"
);
assert.strictEqual(
  getStoredSelectionLineIndex({ lineIndex: 1 }, 2, lines),
  1,
  "Removing a selection must still move backwards within the current page"
);

const contextSource = fs.readFileSync(
  path.join(rootDir, "app_src", "context.jsx"),
  "utf8"
);
assert(
  /case "clearSelections"[\s\S]*state\.storedSelections\[0\],[\s\S]*state\.currentLineIndex,[\s\S]*state\.lines/.test(contextSource),
  "Clearing selections must restore the line without leaving the current page"
);
assert(
  /case "removeSelection"[\s\S]*state\.storedSelections\[action\.index\],[\s\S]*state\.currentLineIndex,[\s\S]*state\.lines/.test(contextSource),
  "Removing a selection must restore its line without leaving the current page"
);

console.log("multi-bubble history tests passed");
