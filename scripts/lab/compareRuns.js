/*
 * compareRuns.js — regression gate between two measured runs.
 *
 * Categories and tolerances come from the baseline dataset (cases.json), so a
 * change in the engine cannot change the yardstick. A run fails the gate when
 * any category gets worse on the 95th percentile of the error, or when a case
 * that used to be positioned correctly stops being positioned at all.
 *
 * Usage: node scripts/lab/compareRuns.js [baselineRun] [candidateRun]
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const BASE_RUN = process.argv[2] || "000-baseline";
const CAND_RUN = process.argv[3] || "002-fix";

function loadRun(run) {
  const dir = path.join(ROOT, ".centering-lab", "runs", run, "out");
  const byKey = {};
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const report = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const page = path.basename(file, ".json");
    for (const layer of report.layers) byKey[page + "#" + layer.index] = layer;
  }
  return byKey;
}

function classify(c) {
  const m = c.region.metrics;
  if (c.region.textLayersInside > 1) return "leak";
  if (m.area / (c.canvas.width * c.canvas.height) > 0.15) return "leak";
  const t = m.touchesCanvas;
  const flat = Math.max(m.straightRuns.flatLeft || 0, m.straightRuns.flatRight || 0);
  if (flat >= 0.35 || t.left || t.right || t.top || t.bottom) return "cut";
  if (m.solidity < 0.85) return "scream";
  return "normal";
}

function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function main() {
  const dataset = JSON.parse(fs.readFileSync(path.join(ROOT, ".centering-lab", "runs", BASE_RUN, "cases.json"), "utf8"));
  const cases = dataset.cases.filter((c) => !c.skipped);
  const base = loadRun(BASE_RUN);
  const cand = loadRun(CAND_RUN);

  const groups = {};
  for (const c of cases) {
    const key = c.page + "#" + c.index;
    if (!base[key] || !cand[key]) continue;
    const category = classify(c);
    const tol = Math.max(1, 0.01 * Math.min(c.region.nodeBbox.width, c.region.nodeBbox.height));
    (groups[category] = groups[category] || []).push({
      key,
      tol,
      baseX: Math.abs(base[key].delta.inkX),
      baseY: Math.abs(base[key].delta.inkY),
      candX: Math.abs(cand[key].delta.inkX),
      candY: Math.abs(cand[key].delta.inkY),
      baseResult: base[key].align.result,
      candResult: cand[key].align.result,
    });
  }

  const fails = [];
  const lines = [];
  lines.push("categoria | n  | PASS base -> novo | |dX| med/p95 base -> novo | |dY| med/p95 base -> novo | recusas");
  for (const category of ["normal", "cut", "scream", "leak"]) {
    const list = groups[category];
    if (!list || !list.length) continue;
    const moved = list.filter((e) => !e.candResult);
    const refused = list.filter((e) => e.candResult === "noSelection");
    const passBase = list.filter((e) => !e.baseResult && e.baseX <= e.tol && e.baseY <= e.tol).length;
    const passCand = list.filter((e) => !e.candResult && e.candX <= e.tol && e.candY <= e.tol).length;
    const stat = (arr, key) => `${quantile(arr.map((e) => e[key]), 0.5).toFixed(1)}/${quantile(arr.map((e) => e[key]), 0.95).toFixed(0)}`;
    lines.push(
      category.padEnd(9) + " | " + String(list.length).padStart(2) + " |  " +
      String(passBase).padStart(2) + "/" + list.length + " -> " + String(passCand).padStart(2) + "/" + list.length + "   | " +
      stat(list, "baseX").padStart(9) + " -> " + (moved.length ? stat(moved, "candX") : "-").padStart(9) + " | " +
      stat(list, "baseY").padStart(9) + " -> " + (moved.length ? stat(moved, "candY") : "-").padStart(9) + " |   " +
      refused.length
    );

    // Gate: the tail must not grow, and a case that was already positioned
    // correctly must not stop being positioned.
    const p95BaseX = quantile(list.map((e) => e.baseX), 0.95);
    const p95BaseY = quantile(list.map((e) => e.baseY), 0.95);
    const p95CandX = moved.length ? quantile(moved.map((e) => e.candX), 0.95) : 0;
    const p95CandY = moved.length ? quantile(moved.map((e) => e.candY), 0.95) : 0;
    if (p95CandX > p95BaseX + 1) fails.push(`${category}: p95 de |dX| piorou (${p95BaseX.toFixed(1)} -> ${p95CandX.toFixed(1)})`);
    if (p95CandY > p95BaseY + 1) fails.push(`${category}: p95 de |dY| piorou (${p95BaseY.toFixed(1)} -> ${p95CandY.toFixed(1)})`);
    for (const e of list) {
      const wasGood = !e.baseResult && e.baseX <= e.tol && e.baseY <= e.tol;
      if (wasGood && e.candResult) fails.push(`${e.key}: estava correto e o novo motor recusou (${e.candResult})`);
    }
  }

  console.log("\nbase = " + BASE_RUN + "   novo = " + CAND_RUN + "\n");
  console.log(lines.join("\n"));
  console.log("\nrecusa = o motor devolveu noSelection em vez de mover o texto para um lugar errado.");

  if (fails.length) {
    console.log("\nGATE REPROVADO:");
    for (const f of fails) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("\nGATE APROVADO: nenhuma categoria regrediu na cauda e nenhum caso correto foi perdido.");
  }
}

main();
