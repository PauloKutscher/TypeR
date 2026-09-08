/*
 * The +/- size buttons must move the size and nothing else.
 *
 * The old path set the layer's TextStyle to a descriptor holding only the size,
 * and Photoshop replaces the whole character style with what it is given: the
 * bold a typesetter had on two words came back regular, and so did tracking,
 * faux styles, scale and baseline. Paragraph settings survived, which is why the
 * loss looked partial.
 *
 * The run walk that replaced it has one subtlety of its own. A scaled text layer
 * stores its size in the layer's space and the size the page shows in
 * `impliedFontSize` — 17 and 34 on a layer scaled 2x — and the write interprets
 * what it is given as the shown size. Writing a raw 18 there halved the layer.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "app_src", "host.js"), "utf8");

function lift(signature, args) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = hostSource.match(new RegExp("function " + escaped + " \\{([\\s\\S]*?)\\r?\\n\\}"));
  assert.ok(match, signature + " must exist in host.js");
  return new Function(...args, `return function ${signature} {${match[1]}\n};`);
}

const style = (over) => Object.assign({
  size: 10,
  fontPostScriptName: "CCWildWords",
  syntheticBold: false,
  tracking: 40,
  horizontalScale: 90,
  autoLeading: true,
  color: { red: 0, green: 0, blue: 0 },
}, over || {});

function runStep(delta, layerText) {
  let written = null;
  const changeTextSizePerRange = lift("_changeTextSizePerRange(delta)", [
    "jamText", "_normalizeTextKey", "_getCurrentTextLayerBounds", "_textLayerIsPointText",
    "_applyMiddleEast", "_moveLayer",
  ])(
    {
      getLayerText: () => JSON.parse(JSON.stringify({ typeUnit: "pointsUnit", layerText })),
      setLayerText: (params) => { written = params; },
    },
    (text) => text,
    () => ({ xMid: 100, yMid: 200 }),
    () => true,
    () => {},
    () => {}
  );
  const applied = changeTextSizePerRange(delta);
  return { applied, written };
}

// --- every run keeps everything but its size
const twoRuns = {
  textKey: "PLAIN AND BOLD",
  textStyleRange: [
    { from: 0, to: 9, textStyle: style() },
    { from: 9, to: 14, textStyle: style({ syntheticBold: true }) },
  ],
  paragraphStyleRange: [{ from: 0, to: 14, paragraphStyle: { align: "center" } }],
};

const stepped = runStep(1, twoRuns);
assert.strictEqual(stepped.applied, true, "a layer with runs must be resized run by run");
const ranges = stepped.written.layerText.textStyleRange;
assert.strictEqual(ranges.length, 2, "both runs must survive the resize");
assert.deepStrictEqual(ranges.map((range) => range.textStyle.size), [11, 11], "every run moves by the step");
assert.strictEqual(ranges[1].textStyle.syntheticBold, true, "the bold run stays bold");
assert.deepStrictEqual(
  ranges.map((range) => [range.textStyle.tracking, range.textStyle.horizontalScale]),
  [[40, 90], [40, 90]],
  "tracking and scale set in the Character panel survive"
);
assert.deepStrictEqual(
  ranges.map((range) => [range.from, range.to]),
  [[0, 9], [9, 14]],
  "and each run still covers the same characters"
);
assert.ok(stepped.written.layerText.paragraphStyleRange, "paragraph settings are carried over untouched");

// --- a layer scaled 2x: the write takes the shown size
const scaled = runStep(1, {
  textKey: "SCALED",
  textStyleRange: [{ from: 0, to: 6, textStyle: style({ size: 17, impliedFontSize: 34 }) }],
  transform: { xx: 2, yy: 2 },
});
const scaledStyle = scaled.written.layerText.textStyleRange[0].textStyle;
assert.strictEqual(scaledStyle.size, 36, "17 + 1 in the layer's space is 36 in the page's");
assert.strictEqual(scaledStyle.impliedFontSize, 36, "and the shown size is written with it");

// --- a fixed leading follows the size, an automatic one stays automatic
const fixedLeading = runStep(2, {
  textKey: "LEADING",
  textStyleRange: [{ from: 0, to: 7, textStyle: style({ size: 20, autoLeading: false, leading: 24 }) }],
});
const leadingStyle = fixedLeading.written.layerText.textStyleRange[0].textStyle;
assert.strictEqual(leadingStyle.leading, 26, "a fixed leading moves by the same step");
assert.strictEqual(leadingStyle.autoLeading, false, "and stays fixed");

const autoLeading = runStep(-1, {
  textKey: "AUTO",
  textStyleRange: [{ from: 0, to: 4, textStyle: style({ size: 20 }) }],
});
const autoStyle = autoLeading.written.layerText.textStyleRange[0].textStyle;
assert.strictEqual(autoStyle.size, 19, "the step also goes down");
assert.strictEqual(autoStyle.autoLeading, true, "automatic leading stays automatic");
assert.ok(!("leading" in autoStyle), "and carries no leading of its own");

// --- the caller must reach for this path before the one that flattens
const stepBody = hostSource.match(/function _changeActiveLayerTextSize\(\) \{([\s\S]*?)\r?\n\}/)[1];
const fastPathAt = stepBody.indexOf("charID.TextStyle");
const runWalkAt = stepBody.indexOf("_changeTextSizePerRange(state.value)");
assert.ok(runWalkAt >= 0, "the size step must go through the run walk");
assert.ok(
  runWalkAt < fastPathAt,
  "and it must be tried before the action that replaces the whole character style"
);

console.log("text size step tests passed");
