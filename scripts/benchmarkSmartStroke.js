const { strokeBackground } = require('./helpers/loadAppModule')()('app_src/oneClick/smartStroke.js');
const report = [];
for (const vertices of [4, 256]) {
  const polygon = Array.from({ length: vertices }, (_, i) => [120+119*Math.cos(i*2*Math.PI/vertices), 120+119*Math.sin(i*2*Math.PI/vertices)]);
  const plan = { selection: { left: 0, top: 0, width: 240, height: 240 }, cleanPolygon: polygon };
  const input = { sample: ([x]) => ({ red: x<120?32:230, green: x<120?32:230, blue: x<120?32:230 }) };
  for (let i=0; i<100; i++) strokeBackground(input, plan);
  const times = [];
  for (let i=0; i<1000; i++) {
    const start = performance.now();
    strokeBackground(input, plan);
    times.push(performance.now()-start);
  }
  times.sort((a,b)=>a-b);
  report.push({ vertices, iterations: times.length, meanMs: times.reduce((a,b)=>a+b,0)/times.length, p95Ms: times[950] });
}
console.log(JSON.stringify(report));
