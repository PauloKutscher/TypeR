// One-off health check for an exported TextShapeR tuning file: loads the
// tuning into the engine, then for every stored exemplar regenerates the
// suggestions in its recorded context and reports where the user's own
// validated shape ranks. Low ranks mean the training is working.
const path = require("path");
const fs = require("fs");
const Module = require("module");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");
const rootDir = path.resolve(__dirname, "..");
const load = (rel) => {
  const fp = path.resolve(rootDir, rel);
  const src = fs.readFileSync(fp, "utf8");
  const { code } = babel.transformSync(src, {
    filename: fp, babelrc: false, configFile: false,
    plugins: ["@babel/plugin-transform-modules-commonjs", "@babel/plugin-proposal-optional-chaining", "@babel/plugin-proposal-class-properties"],
  });
  const m = new Module(fp, module);
  m.filename = fp; m.paths = Module._nodeModulePaths(path.dirname(fp));
  m._compile(code, fp);
  return m.exports;
};
const { generateTextShapeRVariants, setTextShapeRTuning, sanitizeTextShapeRTuning } = load("app_src/textShapeR.js");

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, "utf8"));
const tuning = raw.typerTextShapeRTuning || raw.tuning || raw;
const sanitized = sanitizeTextShapeRTuning(tuning);
console.log("apres sanitization: samples=" + sanitized.samples,
  "exemplars=" + (sanitized.exemplars ? sanitized.exemplars.length : 0),
  "pairs=" + (sanitized.pairs ? sanitized.pairs.length : 0),
  "weights=" + (sanitized.weights ? Object.keys(sanitized.weights).length : 0),
  "pairAccuracy=" + sanitized.pairAccuracy);

setTextShapeRTuning(sanitized);

// Rebuild an approximate selection profile from the stored bubble signature
// (7 width samples over the bubble height, centered)
const rowsFromSignature = (bubble) => bubble.map((width, index) => ({
  y: (index + 0.5) / bubble.length,
  left: 0.5 - width / 2,
  right: 0.5 + width / 2,
  width,
}));

const ranks = [];
const misses = [];
(sanitized.exemplars || []).forEach((exemplar) => {
  if (exemplar.lineCount < 2) return;
  const text = exemplar.lines.join(" ");
  const chosen = exemplar.lines.join("\n");
  const width = 300;
  const height = exemplar.aspect ? Math.round(300 * exemplar.aspect) : undefined;
  const options = {
    limit: 12,
    profile: "balanced",
    allowHyphenation: true,
    shapeProfile: exemplar.bubble ? { rows: rowsFromSignature(exemplar.bubble) } : null,
    width: exemplar.aspect ? width : undefined,
    height,
  };
  const variants = generateTextShapeRVariants(text, options);
  const rank = variants.findIndex((variant) => variant.text === chosen);
  if (rank >= 0) ranks.push(rank + 1);
  else misses.push(exemplar.lines.length + "L: " + exemplar.lines[0].slice(0, 30));
});

ranks.sort((a, b) => a - b);
const top1 = ranks.filter((rank) => rank === 1).length;
const top3 = ranks.filter((rank) => rank <= 3).length;
console.log("exemplars multi-lignes testes:", ranks.length + misses.length);
console.log("  forme validee proposee #1:", top1, "(" + Math.round((top1 / (ranks.length + misses.length)) * 100) + "%)");
console.log("  dans le top 3:", top3, "(" + Math.round((top3 / (ranks.length + misses.length)) * 100) + "%)");
console.log("  rang median:", ranks.length ? ranks[Math.floor(ranks.length / 2)] : "n/a");
console.log("  absentes de la liste:", misses.length);
misses.slice(0, 5).forEach((miss) => console.log("    -", miss));
setTextShapeRTuning(null);
