/*
 * compareRuns.js — regression gate between two measured runs.
 *
 * Categories and tolerances come from the baseline dataset (cases.json), so a
 * change in the engine cannot change the yardstick. A run fails the gate when
 * any class gets worse on the 95th percentile of the error, or when a case that
 * used to be positioned correctly stops being positioned at all.
 *
 * Two classifications are gated, both from caseClass.js: the shape of the region
 * (normal/cut/scream/leak) and how many text layers share it (texts:1/2/3+).
 * Every case is in both tables.
 *
 * Usage: node scripts/lab/compareRuns.js [baselineRun] [candidateRun]
 */

const fs = require("fs");
const path = require("path");
const { classify, topology, tolerance, CATEGORIES, TOPOLOGIES } = require("./caseClass");

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
  const topoGroups = {};
  for (const c of cases) {
    const key = c.page + "#" + c.index;
    if (!base[key] || !cand[key]) continue;
    const entry = {
      key,
      tol: tolerance(c),
      baseX: Math.abs(base[key].delta.inkX),
      baseY: Math.abs(base[key].delta.inkY),
      candX: Math.abs(cand[key].delta.inkX),
      candY: Math.abs(cand[key].delta.inkY),
      baseResult: base[key].align.result,
      candResult: cand[key].align.result,
    };
    (groups[classify(c)] = groups[classify(c)] || []).push(entry);
    (topoGroups[topology(c)] = topoGroups[topology(c)] || []).push(entry);
  }

  const fails = [];
  const lines = [];

  // The same gate runs on both axes of classification: the shape of the region
  // and the number of texts sharing it. A rule that fixes double balloons while
  // quietly wrecking single ones fails on the first table; a rule that leaves
  // the shape classes untouched while doing nothing for doubles shows up on the
  // second.
  function gateOver(header, byName, names) {
    lines.push(header + " | n  | PASS base -> novo | |dX| med/p95 base -> novo | |dY| med/p95 base -> novo | recusas");
    for (const name of names) {
      const list = byName[name];
      if (!list || !list.length) continue;
      const moved = list.filter((e) => !e.candResult);
      const refused = list.filter((e) => e.candResult === "noSelection");
      const passBase = list.filter((e) => !e.baseResult && e.baseX <= e.tol && e.baseY <= e.tol).length;
      const passCand = list.filter((e) => !e.candResult && e.candX <= e.tol && e.candY <= e.tol).length;
      const stat = (arr, key) => `${quantile(arr.map((e) => e[key]), 0.5).toFixed(1)}/${quantile(arr.map((e) => e[key]), 0.95).toFixed(0)}`;
      lines.push(
        name.padEnd(header.length) + " | " + String(list.length).padStart(2) + " |  " +
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
      if (p95CandX > p95BaseX + 1) fails.push(`${name}: p95 de |dX| piorou (${p95BaseX.toFixed(1)} -> ${p95CandX.toFixed(1)})`);
      if (p95CandY > p95BaseY + 1) fails.push(`${name}: p95 de |dY| piorou (${p95BaseY.toFixed(1)} -> ${p95CandY.toFixed(1)})`);
      for (const e of list) {
        const wasGood = !e.baseResult && e.baseX <= e.tol && e.baseY <= e.tol;
        // Every case appears in both tables, so the same refusal would be
        // reported twice without this guard.
        const message = `${e.key}: estava correto e o novo motor recusou (${e.candResult})`;
        if (wasGood && e.candResult && fails.indexOf(message) < 0) fails.push(message);
      }
    }
    lines.push("");
  }

  gateOver("categoria", groups, CATEGORIES);
  gateOver("topologia", topoGroups, TOPOLOGIES);

  /*
   * Pressing Align a second time must land on the same pixel. A rule that reads
   * where the other text layers are cannot hold still: they move as they are
   * aligned, so the answer moves with them and the typesetter watches the text
   * jump on every press.
   */
  const repeats = [];
  for (const c of cases) {
    const key = c.page + "#" + c.index;
    if (!cand[key] || cand[key].delta.repeatX === undefined) continue;
    const still = (layer) => layer && layer.delta.repeatX !== undefined &&
      Math.abs(layer.delta.repeatX) < 1 && Math.abs(layer.delta.repeatY) < 1;
    repeats.push({
      key,
      x: Math.abs(cand[key].delta.repeatX),
      y: Math.abs(cand[key].delta.repeatY),
      baseStill: still(base[key]),
    });
  }
  if (repeats.length) {
    const restless = repeats.filter((e) => e.x >= 1 || e.y >= 1);
    // A case where the region itself changes after the first move was already
    // restless before: what the gate must catch is a case the baseline held
    // still and the candidate does not.
    const newlyRestless = restless.filter((e) => e.baseStill);
    lines.push(`idempotência: ${restless.length} de ${repeats.length} camadas se movem 1 px ou mais na segunda passada` +
      (restless.length ? ` (${newlyRestless.length} que o motor de base mantinha parada)` : ""));
    if (restless.length) {
      lines.push("  " + restless.slice(0, 8).map((e) => `${e.key} ${e.x.toFixed(0)}/${e.y.toFixed(0)}`).join(" · "));
    }
    if (newlyRestless.length) {
      fails.push(`idempotência: ${newlyRestless.length} camadas que ficavam paradas passaram a se mover quando o Align é apertado de novo`);
    }
    lines.push("");
  }

  console.log("\nbase = " + BASE_RUN + "   novo = " + CAND_RUN + "\n");
  console.log(lines.join("\n"));
  console.log("\nrecusa = o motor devolveu noSelection em vez de mover o texto para um lugar errado.");

  if (fails.length) {
    console.log("\nGATE REPROVADO:");
    for (const f of fails) console.log("  - " + f);
    process.exitCode = 1;
  } else {
    console.log("\nGATE APROVADO: nenhuma categoria nem topologia regrediu na cauda e nenhum caso correto foi perdido.");
  }
}

main();
