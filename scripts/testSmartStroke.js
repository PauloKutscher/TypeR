const assert = require('assert');
const load = require('./helpers/loadAppModule')();
const { strokeBackground, applySmartStroke } = load('app_src/oneClick/smartStroke.js');
const { serializeStyle, validateImportData } = load('app_src/librarySerialization.js');
const plan = { selection: { left: 0, top: 0, width: 240, height: 240 }, cleanPolygon: [[0,0],[240,0],[240,240],[0,240]], textColor: null };
const rgb = n => ({ red: n, green: n, blue: n });
const style = { id: 's', name: 'preset', stroke: { enabled: true, size: 3, color: { r: 255, g: 255, b: 255 } } };
const pixels = fn => ({ sample: ([x,y]) => rgb(fn(x,y)) });
for (const [input, expected] of [
  [pixels(() => 255), 'light'], [pixels(() => 218), 'light'], [pixels(() => 37), 'dark'],
  [pixels((x,y) => (Math.floor(x+y)%17) ? 228 : 30), 'light'],
  [pixels((x,y) => (Math.floor(x+y)%17) ? 30 : 228), 'dark'],
  [pixels(x => x < 120 ? 30 : 228), 'mixed'], [pixels(() => 130), 'mixed'],
  [{ sample: () => { throw new Error('unavailable'); } }, 'unknown'], [{}, 'unknown'],
]) assert.strictEqual(strokeBackground(input, plan), expected);
for (const [value, tone] of [[230,'light'], [35,'dark'], [128,'mixed']]) {
  const hist = Array(256).fill(0); hist[value] = 100;
  assert.strictEqual(strokeBackground({ histograms: [hist] }, plan), tone);
  assert.strictEqual(strokeBackground({ histograms: [hist,hist,hist] }, plan), tone);
}
const saved = JSON.stringify(style);
assert.strictEqual(applySmartStroke(style, pixels(() => 230), plan).style.stroke, null, 'Light backgrounds suppress the stroke by default, including existing presets');
for (const color of [{ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 }]) {
  const preset = { ...style, stroke: { ...style.stroke, color, preserveOnLight: true } };
  assert.strictEqual(applySmartStroke(preset, pixels(() => 230), plan).style, preset, 'White and black preset strokes must both survive on a light background');
  assert.deepStrictEqual(applySmartStroke(preset, pixels(() => 40), plan).style.stroke, { ...preset.stroke, color: { r: 0, g: 0, b: 0 } }, 'Dark backgrounds use the configured stroke in black by default');
  assert.strictEqual(applySmartStroke(preset, pixels(x => x < 120 ? 20 : 230), plan).style, preset, 'Mixed backgrounds still preserve the configured stroke');
  const importedPreset = validateImportData({ styles: [serializeStyle(preset)] }).styles[0];
  assert.strictEqual(importedPreset.stroke.preserveOnLight, true, 'The preference survives preset export/import');
}
for (const preserveOnLight of [false, undefined, null, 'true', 1]) {
  assert.strictEqual(applySmartStroke({ ...style, stroke: { ...style.stroke, preserveOnLight } }, pixels(() => 230), plan).style.stroke, null, 'Only explicit true enables light-background preservation');
}
assert.deepStrictEqual(applySmartStroke(style, pixels(() => 40), plan).plan.textColor, rgb(255));
const inverted = applySmartStroke(style, pixels(() => 40), plan);
assert.deepStrictEqual(inverted.style.stroke, { ...style.stroke, color: { r: 0, g: 0, b: 0 } });
assert.strictEqual(inverted.plan.preserveRecoloredStroke, true);
const noInversion = { ...style, stroke: { ...style.stroke, invertOnDark: false } };
assert.strictEqual(applySmartStroke(noInversion, pixels(() => 40), plan).style.stroke, null, 'Explicit opt-out restores white text without a stroke');
assert.deepStrictEqual(applySmartStroke(noInversion, pixels(() => 40), plan).plan.textColor, rgb(255));
assert.strictEqual(validateImportData({ styles: [serializeStyle(noInversion)] }).styles[0].stroke.invertOnDark, false, 'The opt-out survives export/import');
for (const stroke of [undefined, null, { ...style.stroke, enabled: false }, { ...style.stroke, size: 0 }]) {
  const result = applySmartStroke({ ...style, stroke }, pixels(() => 40), plan);
  assert.strictEqual(result.style.stroke, null, 'Inversion never creates an unconfigured, disabled or zero-sized stroke');
  assert.deepStrictEqual(result.plan.textColor, rgb(255));
}
assert.strictEqual(applySmartStroke({ ...style, stroke: { ...style.stroke, smart: false, invertOnDark: true } }, pixels(() => 40), plan).plan, plan, 'Disabling Smart stroke bypasses inversion');
assert.strictEqual(applySmartStroke(style, pixels(x => x < 120 ? 20 : 230), plan).style.stroke, style.stroke);
assert.strictEqual(applySmartStroke(style, {}, plan).style, style);
assert.doesNotThrow(() => applySmartStroke({}, pixels(() => 230), plan));
const disabled = { stroke: { ...style.stroke, smart: false } };
assert.strictEqual(applySmartStroke(disabled, pixels(() => 230), plan).style, disabled);
const disabledPreserving = { stroke: { ...style.stroke, smart: false, preserveOnLight: true } };
assert.strictEqual(applySmartStroke(disabledPreserving, pixels(() => 230), plan).style, disabledPreserving);
const zeroStroke = { stroke: { ...style.stroke, enabled: false, size: 0, preserveOnLight: true } };
assert.strictEqual(applySmartStroke(zeroStroke, pixels(() => 230), plan).style, zeroStroke, 'The preference never invents a stroke');
assert.strictEqual(JSON.stringify(style), saved);
assert.strictEqual(strokeBackground(pixels(() => 30), { ...plan, autoClean: true, fillRGB: rgb(255) }), 'light');
const imported = validateImportData({ styles: [serializeStyle({ ...style, stroke: { ...style.stroke, smart: false } })] });
assert.strictEqual(imported.styles[0].stroke.smart, false);
console.log('Smart stroke: tolerant tones, noise, mixed backgrounds, missing stroke, opt-out and preset persistence passed');
