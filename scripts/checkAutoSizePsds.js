const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const assert = require('assert');
const { recommendFontSize, normalizeAutoSizeScale } = require('./helpers/loadAppModule')()('app_src/oneClick/autoFontSize.js');
const root = path.resolve(__dirname, '..');
const data = JSON.parse(cp.execFileSync('python', [path.join(__dirname, 'autoSizePsdSamples.py')], { encoding: 'utf8', windowsHide: true, maxBuffer: 20*1024*1024 }));
assert(data.samples.length > 0, 'No closed text/bubble fixtures found');
const pages = new Map();
const autoSizeScale = normalizeAutoSizeScale();
const rows = data.samples.map(sample => {
  const started = performance.now();
  const result = recommendFontSize({ ...sample, stylePx: sample.size, minScale: 0.75, referenceRatio: pages.get(sample.file), autoSizeScale });
  const elapsedMs = performance.now()-started;
  assert(result.max >= sample.size*0.75-1e-6 && result.max <= sample.size*1.5+1e-6);
  if (!pages.has(sample.file)) pages.set(sample.file, Math.max(0.9, Math.min(1.35, result.max/(sample.size*autoSizeScale))));
  return { file: sample.file, text: sample.text, originalPx: sample.size, recommendedPx: result.max, ratio: result.max/sample.size, elapsedMs };
});
const times = rows.map(row=>row.elapsedMs).sort((a,b)=>a-b);
const report = { filesRead: data.files, filesWithClosedBubbles: pages.size, samples: rows.length,
  measuredFontSamples: data.samples.filter(sample=>sample.metricsSource==='installed font advance').length,
  meanEstimateMs: times.reduce((a,b)=>a+b,0)/times.length, p95EstimateMs: times[Math.floor(times.length*.95)],
  note: 'Read-only PSD typography and balloon estimates; final native font fitting and visual quality require Photoshop.', rows };
fs.mkdirSync(path.join(root,'.native-build'), { recursive: true });
fs.writeFileSync(path.join(root,'.native-build/auto-size-psd-results.json'), JSON.stringify(report,null,2));
console.log(JSON.stringify({ ...report, rows: undefined }));
