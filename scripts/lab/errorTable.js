/*
 * errorTable.js — the before/after distribution of the centring error, per
 * scenario and per frozen group.
 *
 * The gate answers "did anything regress". This answers "where does the error
 * live now", which is the question the next round starts from, and it is the
 * table that gets pasted into plano.md so the plan always carries the current
 * numbers instead of the ones from three tasks ago.
 *
 * Error is the euclidean distance between where the layer ended up and where the
 * typesetter had left it: E = hypot(delta.inkX, delta.inkY), the same quantity
 * the gate uses. Cases the engine refused are excluded and counted, because a
 * failure has no geometric error and must never be scored as zero.
 *
 * Usage:
 *   node scripts/lab/errorTable.js                       # the default pairs below
 *   node scripts/lab/errorTable.js none:170-none:180-none mid:170-mid:180-mid
 */

const fs = require("fs");
const path = require("path");
const { topology, classify } = require("./caseClass");

const ROOT = path.resolve(__dirname, "..", "..");

const DEFAULT_PAIRS = [
  ["none", "170-none", "180-none"],
  ["mid", "170-mid", "180-mid"],
  ["full", "170-full", "180-full"],
  ["overlap", "170-overlap", "180-overlap"],
  ["resize+pad12", "170-resize-pad12", "180-resize-pad12"],
  ["overlapmid", "170-overlapmid", "180-overlapmid"],
];

const GROUPS = ["TOTAL", "texts:1", "texts:2", "texts:3+", "normal", "cut", "scream", "leak"];

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

function load(run) {
  const dir = path.join(ROOT, ".centering-lab", "runs", run, "out");
  const byKey = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const report = readJson(path.join(dir, file));
    const page = path.basename(file, ".json");
    for (const layer of report.layers) {
      if (layer.skipped) continue;
      byKey[page + "#" + layer.index] = layer;
    }
  }
  return byKey;
}

/* Lower-order quantile, the same convention the gate uses. */
function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function pair(a, b, p) {
  return quantile(a, p).toFixed(1) + " → " + quantile(b, p).toFixed(1);
}

function counts(a, b, over) {
  return a.filter((v) => v > over).length + " → " + b.filter((v) => v > over).length;
}

function line(label, a, b) {
  const max = (v) => (v.length ? Math.max.apply(null, v).toFixed(0) : "-");
  return label.padEnd(16) + String(a.length).padStart(4) +
    ("  " + pair(a, b, 0.5)).padEnd(16) +
    ("  " + pair(a, b, 0.75)).padEnd(17) +
    ("  " + pair(a, b, 0.95)).padEnd(19) +
    ("  " + max(a) + " → " + max(b)).padEnd(15) +
    ("  " + counts(a, b, 10)).padEnd(11) +
    ("  " + counts(a, b, 25)).padEnd(11) +
    ("  " + counts(a, b, 50));
}

const HEADER = "grupo".padEnd(16) + "   n" + "  p50".padEnd(16) + "  p75".padEnd(17) +
  "  p95".padEnd(19) + "  máx".padEnd(15) + "  >10".padEnd(11) + "  >25".padEnd(11) + "  >50";

function main() {
  const args = process.argv.slice(2);
  const pairs = args.length ? args.map((a) => a.split(":")) : DEFAULT_PAIRS;
  const allA = [], allB = [];
  let refused = 0;

  for (const [name, baseRun, candRun] of pairs) {
    const base = load(baseRun);
    const cand = load(candRun);
    const cases = readJson(path.join(ROOT, ".centering-lab", "runs", baseRun, "cases.json"))
      .cases.filter((c) => !c.skipped);
    const groups = {};
    for (const c of cases) {
      const key = c.page + "#" + c.index;
      const a = base[key], b = cand[key];
      if (!a || !b) continue;
      if ((a.align && a.align.result) || (b.align && b.align.result)) { refused++; continue; }
      const ea = Math.hypot(a.delta.inkX, a.delta.inkY);
      const eb = Math.hypot(b.delta.inkX, b.delta.inkY);
      for (const g of ["TOTAL", topology(c), classify(c)]) {
        groups[g] = groups[g] || { a: [], b: [] };
        groups[g].a.push(ea);
        groups[g].b.push(eb);
      }
      allA.push(ea);
      allB.push(eb);
    }
    console.log("\n=== " + name + "   (" + baseRun + " → " + candRun + ") ===");
    console.log(HEADER);
    for (const g of GROUPS) if (groups[g]) console.log(line(g, groups[g].a, groups[g].b));
  }

  console.log("\n=== todos os cenários somados ===");
  console.log(HEADER);
  console.log(line("TOTAL", allA, allB));
  if (refused) console.log("\n" + refused + " medição(ões) excluída(s): o motor recusou de um dos lados.");
}

main();
