const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const moduleCache = {};

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(rootDir, relativePath);
  if (moduleCache[filePath]) return moduleCache[filePath].exports;

  const source = fs.readFileSync(filePath, "utf8");
  const { code } = babel.transformSync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    plugins: [
      "@babel/plugin-transform-modules-commonjs",
      "@babel/plugin-proposal-optional-chaining",
      "@babel/plugin-proposal-class-properties",
    ],
  });

  const mod = new Module(filePath, module);
  moduleCache[filePath] = mod;
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  const nativeRequire = mod.require.bind(mod);
  mod.require = (request) => {
    if (request.startsWith(".")) {
      const target = path.resolve(path.dirname(filePath), request);
      return loadAppModule(path.relative(rootDir, `${target}.js`));
    }
    return nativeRequire(request);
  };
  mod._compile(code, filePath);
  return mod.exports;
};

const {
  getScaledStyle,
  resolveStylePointText,
  buildSelectedLayerPayload,
  buildStoredSelectionPayload,
} = loadAppModule("app_src/textLayerPayload.js");

const makeStyle = (id, size = 20, leading = 24, textType = "inherit") => ({
  id,
  textType,
  textProps: {
    layerText: {
      textStyleRange: [{ textStyle: { size, leading } }],
    },
  },
});

const baseStyle = { ...makeStyle("base"), sizePresets: [20, 30, 40] };
assert.strictEqual(getScaledStyle(null, 50), null);
assert.strictEqual(getScaledStyle(baseStyle, null), baseStyle);

const scaled = getScaledStyle(baseStyle, 50);
assert.notStrictEqual(scaled, baseStyle);
assert.strictEqual(scaled.textProps.layerText.textStyleRange[0].textStyle.size, 10);
assert.strictEqual(scaled.textProps.layerText.textStyleRange[0].textStyle.leading, 12);
assert.deepStrictEqual(scaled.sizePresets, [10, 15, 20]);
assert.deepStrictEqual(baseStyle.sizePresets, [20, 30, 40]);
assert.strictEqual(baseStyle.textProps.layerText.textStyleRange[0].textStyle.size, 20);
assert.strictEqual(resolveStylePointText(makeStyle("point", 20, 24, "point"), false), true);
assert.strictEqual(resolveStylePointText(makeStyle("paragraph", 20, 24, "paragraph"), true), false);
assert.strictEqual(resolveStylePointText(baseStyle, true), true);
assert.strictEqual(resolveStylePointText(null, false), false);

const partialStyle = {
  id: "partial",
  textProps: {
    layerText: {
      textStyleRange: [{ textStyle: { size: 12, leading: "auto" } }],
    },
  },
};
const partialScaled = getScaledStyle(partialStyle, 150);
assert.strictEqual(partialScaled.textProps.layerText.textStyleRange[0].textStyle.size, 18);
assert.strictEqual(partialScaled.textProps.layerText.textStyleRange[0].textStyle.leading, "auto");

const currentStyle = makeStyle("current", 30, 36);
const taggedStyle = makeStyle("tagged", 18, 22);
const storedStyle = makeStyle("stored", 16, 20);
const lines = [
  { text: "ignored", ignore: true },
  { text: "first", ignore: false, style: taggedStyle },
  { text: "second", ignore: false },
  { text: "third", ignore: false },
];
const payload = buildStoredSelectionPayload({
  storedSelections: [
    { lineIndex: 1 },
    { styleId: "stored" },
    {},
  ],
  lines,
  currentLineIndex: 2,
  styles: [storedStyle],
  currentStyle,
  textScale: 200,
});

assert.deepStrictEqual(payload.texts, ["first", "second", "third"]);
assert.strictEqual(payload.styles[0].id, "tagged");
assert.strictEqual(payload.styles[1].id, "stored");
assert.strictEqual(payload.styles[2].id, "current");
assert.strictEqual(payload.styles[0].textProps.layerText.textStyleRange[0].textStyle.size, 36);
assert.strictEqual(storedStyle.textProps.layerText.textStyleRange[0].textStyle.size, 16);

const manualStyle = makeStyle("manual", 14, 18);
const prefixedStyle = makeStyle("prefixed", 22, 26);
const manualPayload = buildStoredSelectionPayload({
  storedSelections: [{ lineIndex: 0, styleId: "manual" }],
  lines: [{ text: "prefixed line", ignore: false, style: prefixedStyle }],
  styles: [manualStyle],
  currentStyle,
});
assert.strictEqual(manualPayload.styles[0].id, "manual");

const sparsePayload = buildStoredSelectionPayload({
  storedSelections: [
    { lineIndex: 0 },
    { lineIndex: 99 },
    { lineIndex: 3 },
    {},
  ],
  lines,
  currentLineIndex: 0,
  styles: [],
  currentStyle,
});

assert.deepStrictEqual(sparsePayload.texts, ["first", "second", "third"]);
assert.strictEqual(sparsePayload.styles[0].id, "tagged");
assert.strictEqual(sparsePayload.styles[1].id, "current");
assert.strictEqual(sparsePayload.styles[2].id, "current");

const exhaustedPayload = buildStoredSelectionPayload({
  storedSelections: [{}, {}, {}],
  lines: [{ text: "comment", ignore: true }],
  currentLineIndex: 0,
  currentStyle,
});
assert.deepStrictEqual(exhaustedPayload.texts, []);
assert.deepStrictEqual(exhaustedPayload.styles, []);

const selectedLayerPayload = buildSelectedLayerPayload({
  layerIds: [101, 102, 103],
  lines,
  currentLineIndex: 0,
  currentStyle,
  textScale: 50,
});
assert.deepStrictEqual(
  selectedLayerPayload.items.map((item) => [item.layerId, item.text, item.style.id]),
  [
    [101, "first", "tagged"],
    [102, "second", "tagged"],
    [103, "third", "tagged"],
  ]
);
assert.deepStrictEqual(selectedLayerPayload.lineEntries, [
  { lineIndex: 1, styleId: "tagged" },
  { lineIndex: 2, styleId: "tagged" },
  { lineIndex: 3, styleId: "tagged" },
]);
assert.strictEqual(selectedLayerPayload.nextLineIndex, 3);
assert.strictEqual(
  selectedLayerPayload.items[0].style.textProps.layerText.textStyleRange[0].textStyle.size,
  9
);

const partialSelectedLayerPayload = buildSelectedLayerPayload({
  layerIds: [201, 202, 203],
  lines: [
    { text: "one", rawText: "one", ignore: false, style: taggedStyle },
    { text: "note", rawText: "note", ignore: true },
    { text: "two", rawText: "two", ignore: false },
  ],
  currentLineIndex: 1,
  currentStyle,
});
assert.deepStrictEqual(partialSelectedLayerPayload.items.map((item) => item.layerId), [201]);
assert.deepStrictEqual(partialSelectedLayerPayload.lineEntries, [{ lineIndex: 2, styleId: "current" }]);
assert.strictEqual(partialSelectedLayerPayload.nextLineIndex, 2);

console.log("textLayerPayload tests passed");
