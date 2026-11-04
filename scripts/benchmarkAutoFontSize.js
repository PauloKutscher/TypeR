const assert = require('assert');
const load = require('./helpers/loadAppModule')();
const { prepareSmartPaste } = load('app_src/oneClick/smartPaste.js');
const { clearAutoSizeReferences, rememberAutoSizeReference } = load('app_src/oneClick/autoFontSize.js');
const { clearMetricCache } = load('app_src/oneClick/measureSpec.js');
const style = { id: 'dialogue', textProps: { typeUnit: 'pointsUnit', layerText: {
  textStyleRange: [{ textStyle: { fontPostScriptName: 'Benchmark', size: 24, autoLeading: true } }],
  paragraphStyleRange: [{ paragraphStyle: { alignment: 'center', autoLeadingPercentage: 1.2 } }],
} }, stroke: { enabled: false, size: 0, smart: false } };
const cases = [
  ['short', 500, 350, 'Bonjour, comment vas-tu ?'],
  ['medium', 360, 250, 'Je ne pensais vraiment pas te revoir ici, après tout ce temps.'],
  ['small', 190, 140, 'Attends-moi devant la porte du magasin.'],
];
async function run(autoSize, reference, dims) {
  const [name,width,height,text] = dims;
  let captures=0, calls=0, measured=0;
  clearAutoSizeReferences();
  clearMetricCache();
  if (reference) rememberAutoSizeReference({ autoSizeReference: { key: JSON.stringify([7,'bench']), ratio: 1.15 } });
  const begin = performance.now();
  const result = await prepareSmartPaste({ trigger: { source: 'rectangle' }, lines: [{ text, style }], roleStyles: {},
    settings: { autoSize, autoSizePage: 'bench', minScale: 0.7, hyphenation: 'off' } }, {
    capture: async () => { captures++; return { documentId: 7, width: 1200, height: 1700, resolution: 72, source: 'rectangle',
      selectionBounds: { left: 200, top: 200, right: 200+width, bottom: 200+height }, fill: { fill: 255, rgb: { red: 255, green: 255, blue: 255 } } }; },
    measure: async requests => {
      calls++; measured += requests.length;
      return requests.map(request => {
        const lt=request.params.layerText, size=lt.textStyleRange[0].textStyle.size;
        const row=lt.textKey.split('\r')[0], width=Array.from(row).reduce((sum,ch)=>sum+(ch===' '?0.3:0.55),0)*size;
        return { bounds: { left: 600-width/2, right: 600+width/2, top: 850-size*0.72, bottom: 850+size*0.06 } };
      });
    },
  });
  assert.strictEqual(captures,1);
  return { ms: performance.now()-begin, nativeBatches: calls, requestedLines: measured, size: result.sessions[0].text.size };
}
(async()=>{
  const report=[];
  for (const dims of cases) for(const mode of ['current','beta-first','beta-reference']) {
    for(let i=0;i<3;i++) await run(mode!=='current', mode==='beta-reference',dims);
    const values=[];
    for(let i=0;i<20;i++) values.push(await run(mode!=='current', mode==='beta-reference',dims));
    const times=values.map(v=>v.ms).sort((a,b)=>a-b);
    report.push({ case:dims[0], mode, meanMs:times.reduce((a,b)=>a+b,0)/times.length, p95Ms:times[19],
      nativeBatches:values[0].nativeBatches, requestedLines:values[0].requestedLines, size:values[0].size });
  }
  clearAutoSizeReferences();
  console.log(JSON.stringify({ note:'Synthetic native font replies; these are engine timings, not Photoshop end-to-end timings.', report }));
})().catch(error=>{console.error(error);process.exitCode=1;});
