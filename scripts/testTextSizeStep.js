// Exercise the real size command: preserve mixed styles while changing the displayed size.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../app_src/host.js"), "utf8");
const clone = value => JSON.parse(JSON.stringify(value));
const style = overrides => ({ size: 10, fontPostScriptName: "CCWildWords", syntheticBold: false,
  tracking: 40, horizontalScale: 90, autoLeading: true, color: { red: 0, green: 0, blue: 0 }, ...overrides });

function runStep(delta, layerText) {
  let written = null;
  const box = vm.createContext({ documents: [{}], app: { activeDocument: {} }, jamJSON: JSON });
  vm.runInContext(source, box);
  Object.assign(box, {
    jamText: { getLayerText: () => clone({ typeUnit: "pointsUnit", layerText }), setLayerText: p => { written = clone(p); } },
    _layerIsTextLayer: () => true, _getDocumentResolution: () => 72,
    _forEachSelectedLayer: fn => fn(), _currentLayerBox: () => ({ xMid: 100, yMid: 200 }),
    _readTextStyleSize: () => null, _applyMiddleEast: () => {}, _recentreOnBox: () => {},
    _resizeTextStyleFast: () => { throw Error("force the run-preserving write"); },
  });
  box._hostState.changeActiveLayerTextSize.value = delta;
  box._changeActiveLayerTextSize();
  assert.strictEqual(box._hostState.changeActiveLayerTextSize.result, "");
  return written;
}

const mixed = { textKey: "PLAIN AND BOLD", textStyleRange: [
  { from: 0, to: 9, textStyle: style() }, { from: 9, to: 14, textStyle: style({ syntheticBold: true }) },
], paragraphStyleRange: [{ from: 0, to: 14, paragraphStyle: { align: "center" } }] };
const stepped = runStep(1, mixed);
const ranges = stepped.layerText.textStyleRange;
assert.deepStrictEqual(ranges.map(r => r.textStyle.size), [11, 11]);
assert.strictEqual(ranges[1].textStyle.syntheticBold, true);
assert.deepStrictEqual(ranges.map(r => [r.textStyle.tracking, r.textStyle.horizontalScale]), [[40, 90], [40, 90]]);
assert.deepStrictEqual(ranges.map(r => [r.from, r.to]), [[0, 9], [9, 14]]);
assert.strictEqual(stepped.layerText.paragraphStyleRange[0].paragraphStyle.align, "center");
assert.strictEqual(mixed.textStyleRange[1].textStyle.size, 10, "the input snapshot stays intact");

const scaled = runStep(1, { textKey: "SCALED", transform: { xx: 2, yy: 2 },
  textStyleRange: [{ from: 0, to: 6, textStyle: style({ size: 17, impliedFontSize: 34 }) }] });
assert.strictEqual(scaled.layerText.textStyleRange[0].textStyle.size, 35, "the displayed size moves by one point");
assert.ok(!("impliedFontSize" in scaled.layerText.textStyleRange[0].textStyle), "Photoshop recalculates its derived value");

const fixed = runStep(1, { textKey: "LEADING", textStyleRange: [
  { from: 0, to: 7, textStyle: style({ size: 20, autoLeading: false, leading: 24 }) },
] });
assert.ok(Math.abs(fixed.layerText.textStyleRange[0].textStyle.leading - 25.2) < 1e-9, "fixed leading follows the displayed size ratio");
assert.strictEqual(fixed.layerText.textStyleRange[0].textStyle.autoLeading, false);
const auto = runStep(-1, { textKey: "AUTO", textStyleRange: [
  { from: 0, to: 4, textStyle: style({ size: 20 }) },
] });
assert.strictEqual(auto.layerText.textStyleRange[0].textStyle.size, 19);
assert.ok(!("leading" in auto.layerText.textStyleRange[0].textStyle));
const paragraphs = runStep(1, { ...mixed, textKey: "PLAIN\nAND BOLD", paragraphStyleRange: [
  { from: 0, to: 6, paragraphStyle: { align: "left", spaceAfter: 3 } },
  { from: 6, to: 14, paragraphStyle: { align: "center", spaceAfter: 7 } },
] });
assert.deepStrictEqual(paragraphs.layerText.paragraphStyleRange.map(p => [p.from, p.to, p.paragraphStyle.align, p.paragraphStyle.spaceAfter]),
  [[0, 6, "left", 3], [6, 14, "center", 7]], "every paragraph keeps its formatting");
console.log("text size step tests passed");
