const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { strokeBackground } = require('./helpers/loadAppModule')()('app_src/oneClick/smartStroke.js');
const root = path.resolve(__dirname, '..');
const samples = JSON.parse(cp.execFileSync('python', [path.join(__dirname, 'smartStrokePsdSamples.py')], { encoding: 'utf8', windowsHide: true, maxBuffer: 30 * 1024 * 1024 }));
assert(samples.length > 0, 'No PSD fixtures found');
const counts = {};
const results = samples.map(sample => {
  const rgb = Buffer.from(sample.rgb, 'base64');
  const plan = { selection: { left: 0, top: 0, width: 128, height: 128 }, cleanPolygon: [[0,0],[128,0],[128,128],[0,128]] };
  const tone = strokeBackground({ sample: ([x,y]) => {
    const at = (Math.floor(y)*128+Math.floor(x))*3;
    return { red: rgb[at], green: rgb[at+1], blue: rgb[at+2] };
  } }, plan);
  counts[tone] = (counts[tone] || 0) + 1;
  const { rgb: omitted, ...details } = sample;
  return { ...details, tone };
});
const report = { files: new Set(samples.map(sample => sample.file)).size, regions: samples.length, counts, checked: results.filter(r => r.expected) };
fs.mkdirSync(path.join(root, '.native-build'), { recursive: true });
fs.writeFileSync(path.join(root, '.native-build/smart-stroke-psd-results.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
for (const result of results.filter(r => r.expected)) assert.strictEqual(result.tone, result.expected, result.file+' '+result.expected+' '+result.variant);
