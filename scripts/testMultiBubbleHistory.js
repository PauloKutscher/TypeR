const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const historySource = fs.readFileSync(
  path.join(rootDir, "app_src", "multiBubbleHistory.js"),
  "utf8"
);
const transformedHistory = babel.transformSync(historySource, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const historyModule = { exports: {} };
new Function("require", "module", "exports", transformedHistory)(
  require,
  historyModule,
  historyModule.exports
);

const { getStoredSelectionLineIndex } = historyModule.exports;

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

const contextSource = fs.readFileSync(
  path.join(rootDir, "app_src", "context.jsx"),
  "utf8"
);
assert(
  /case "clearSelections"[\s\S]*state\.storedSelections\[0\]/.test(contextSource),
  "Clearing selections must restore the line from the first selection"
);
assert(
  /case "removeSelection"[\s\S]*state\.storedSelections\[action\.index\]/.test(contextSource),
  "Removing a selection must restore that selection's line"
);

console.log("multi-bubble history tests passed");
