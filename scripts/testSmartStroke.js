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
assert.strictEqual(applySmartStroke(style, pixels(() => 230), plan).style.stroke, null);
assert.deepStrictEqual(applySmartStroke(style, pixels(() => 40), plan).plan.textColor, rgb(255));
assert.strictEqual(applySmartStroke(style, pixels(x => x < 120 ? 20 : 230), plan).style.stroke, style.stroke);
assert.strictEqual(applySmartStroke(style, {}, plan).style, style);
assert.doesNotThrow(() => applySmartStroke({}, pixels(() => 230), plan));
const disabled = { stroke: { ...style.stroke, smart: false } };
assert.strictEqual(applySmartStroke(disabled, pixels(() => 230), plan).style, disabled);
assert.strictEqual(JSON.stringify(style), saved);
assert.strictEqual(strokeBackground(pixels(() => 30), { ...plan, autoClean: true, fillRGB: rgb(255) }), 'light');
const imported = validateImportData({ styles: [serializeStyle({ ...style, stroke: { ...style.stroke, smart: false } })] });
assert.strictEqual(imported.styles[0].stroke.smart, false);
console.log('Smart stroke: tolerant tones, noise, mixed backgrounds, missing stroke, opt-out and preset persistence passed');
