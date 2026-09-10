/*
 * Diff two diagMeasureBox.jsx runs.
 *
 * The measuring box may only shrink if the text lands broken exactly where it
 * landed before and the layer ends up the same size in the same place. Anything
 * else is a regression and the change does not ship.
 *
 *   node scripts/lab/compareMeasureBox.js <baseline.json> <fixed.json>
 */
const fs = require("fs");

const [, , baselinePath, fixedPath] = process.argv;
if (!baselinePath || !fixedPath) {
  console.error("uso: node scripts/lab/compareMeasureBox.js <baseline.json> <fixed.json>");
  process.exit(2);
}

const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const baseline = read(baselinePath);
const fixed = read(fixedPath);

const keyOf = (record) => `${record.page}/${record.layerId}/${record.label}`;
const index = (run) => {
  const map = new Map();
  run.cases.forEach((record) => map.set(keyOf(record), record));
  return map;
};

const before = index(baseline);
const after = index(fixed);

// Ink bounds are measured in pixels off the rendered layer, so the last pixel
// can wobble on a re-render without the text having moved. Line breaks are the
// thing that must be identical.
const INK_TOLERANCE_PX = 1;

const differences = [];
const sameText = [];
let missing = 0;

before.forEach((baseRecord, key) => {
  const fixedRecord = after.get(key);
  if (!fixedRecord) {
    missing++;
    differences.push({ key, what: "ausente na segunda passada" });
    return;
  }
  if (baseRecord.rendered !== fixedRecord.rendered) {
    differences.push({
      key,
      what: "quebra de linha mudou",
      before: JSON.stringify(baseRecord.rendered),
      after: JSON.stringify(fixedRecord.rendered),
    });
  } else {
    sameText.push(key);
  }
  if (baseRecord.textType !== fixedRecord.textType) {
    differences.push({ key, what: `tipo mudou ${baseRecord.textType} -> ${fixedRecord.textType}` });
  }
  const baseInk = baseRecord.ink || [];
  const fixedInk = fixedRecord.ink || [];
  for (let i = 0; i < Math.max(baseInk.length, fixedInk.length); i++) {
    if (Math.abs((baseInk[i] || 0) - (fixedInk[i] || 0)) > INK_TOLERANCE_PX) {
      differences.push({
        key,
        what: `bounds da tinta mudou (${["left", "top", "width", "height"][i]})`,
        before: JSON.stringify(baseInk),
        after: JSON.stringify(fixedInk),
      });
      break;
    }
  }
  if (baseRecord.result !== fixedRecord.result) {
    differences.push({ key, what: `result mudou ${baseRecord.result} -> ${fixedRecord.result}` });
  }
});

const total = (run) => run.cases.reduce((sum, record) => sum + record.ms, 0);
const worst = (run) => run.cases.reduce((max, record) => Math.max(max, record.ms), 0);

console.log(`casos: ${before.size} antes, ${after.size} depois, ${missing} ausentes`);
console.log(`erros do host: ${baseline.errors.length} antes, ${fixed.errors.length} depois`);
console.log(`tempo total: ${Math.round(total(baseline) / 1000)} s antes, ${Math.round(total(fixed) / 1000)} s depois`);
console.log(`pior caso: ${worst(baseline)} ms antes, ${worst(fixed)} ms depois`);
console.log(`media por apply: ${Math.round(total(baseline) / baseline.cases.length)} ms antes, ${Math.round(total(fixed) / fixed.cases.length)} ms depois`);
console.log(`quebras identicas: ${sameText.length} de ${before.size}`);

if (differences.length) {
  console.log(`\nREGRESSAO: ${differences.length} diferencas`);
  differences.slice(0, 20).forEach((difference) => {
    console.log(`  ${difference.key}: ${difference.what}`);
    if (difference.before) console.log(`    antes: ${difference.before.slice(0, 200)}`);
    if (difference.after) console.log(`    depois: ${difference.after.slice(0, 200)}`);
  });
  process.exit(1);
}
console.log("\nsem diferenca: quebra, tipo, bounds e result identicos em todos os casos");
