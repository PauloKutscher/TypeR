const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "styleSizePresets.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const presetModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, presetModule, presetModule.exports);

const {
  MAX_STYLE_SIZE_PRESETS,
  cycleStyleSizePreset,
  normalizeStyleSizePresetWidthConfig,
  normalizeStyleSizePresets,
  resolveStyleSizePresetForPageWidth,
  setStyleSizePreset,
  updateActiveStyleSizePreset,
} = presetModule.exports;

const makeStyle = (size, sizePresets) => ({
  id: "title",
  sizePresets,
  textProps: {
    layerText: {
      textStyleRange: [{ textStyle: { size, impliedFontSize: size } }],
    },
  },
});

assert.strictEqual(MAX_STYLE_SIZE_PRESETS, 3);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(23)), [23]);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(35, [23, 23, 0, "bad"])), [35, 23]);
assert.deepStrictEqual(normalizeStyleSizePresets(makeStyle(23, [23, 35, 48, 60])), [23, 35, 48]);

const original = makeStyle(23, [23, 35, 48]);
const selected = setStyleSizePreset(original, 35);
assert.notStrictEqual(selected, original);
assert.strictEqual(original.textProps.layerText.textStyleRange[0].textStyle.size, 23);
assert.strictEqual(selected.textProps.layerText.textStyleRange[0].textStyle.size, 35);
assert.strictEqual(selected.textProps.layerText.textStyleRange[0].textStyle.impliedFontSize, 35);
assert.deepStrictEqual(selected.sizePresets, [23, 35, 48]);

const cycled = cycleStyleSizePreset(selected);
assert.strictEqual(cycled.textProps.layerText.textStyleRange[0].textStyle.size, 48);
const wrapped = cycleStyleSizePreset(cycled);
assert.strictEqual(wrapped.textProps.layerText.textStyleRange[0].textStyle.size, 23);
assert.strictEqual(setStyleSizePreset(original, 99), original);
const resizedActive = updateActiveStyleSizePreset(original, 26);
assert.deepStrictEqual(resizedActive.sizePresets, [26, 35, 48]);
assert.strictEqual(resizedActive.textProps.layerText.textStyleRange[0].textStyle.size, 26);
assert.strictEqual(resizedActive.textProps.layerText.textStyleRange[0].textStyle.impliedFontSize, 26);
assert.strictEqual(updateActiveStyleSizePreset(original, 35), original, "Quick editing must not create duplicate presets");

const automatic = {
  ...original,
  autoSizeByPageWidth: true,
  sizePresetDefaultIndex: 0,
  sizePresetMinWidths: [null, 1000, 1500],
};
assert.deepStrictEqual(normalizeStyleSizePresetWidthConfig(automatic), {
  autoSizeByPageWidth: true,
  sizePresetDefaultIndex: 0,
  sizePresetMinWidths: [null, 1000, 1500],
});
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 999), 23);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1000), 35);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1499), 35);
assert.strictEqual(resolveStyleSizePresetForPageWidth(automatic, 1500), 48);
assert.strictEqual(resolveStyleSizePresetForPageWidth({ ...automatic, autoSizeByPageWidth: false }, 2000), 23);

const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");
assert(hostSource.includes("function _resolveStyleSizeForDocument(style)"));
assert(hostSource.includes('activeDocument.width.as("px")'));

console.log("style size preset tests passed");
