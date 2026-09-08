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
 * Before any of that, the two runs are audited against each other. A gate that
 * prints APROVADO over a population it never checked is worse than no gate: a
 * case the candidate failed to produce at all used to drop out of the candidate
 * percentile and make the tail look better, and a case missing from one of the
 * runs was skipped in silence. Both now fail the comparison instead.
 *
 * Usage: node scripts/lab/compareRuns.js [baselineRun] [candidateRun]
 *        node scripts/lab/compareRuns.js --selfcheck
 */

const fs = require("fs");
const path = require("path");
const { classify, topology, tolerance, CATEGORIES, TOPOLOGIES } = require("./caseClass");

const ROOT = path.resolve(__dirname, "..", "..");

/*
 * The options that decide what was measured. Two runs that disagree on any of
 * them are not an A/B of the engine, they are an A/B of the bench, and the
 * difference would be read as a result. `traceGeometry` is deliberately not in
 * here: it only adds telemetry.
 */
const COMPARED_OPTIONS = ["resize", "padding", "wandTolerance", "liveSelection", "phantomRatio", "scatter"];

/* PowerShell writes run.json with a BOM; JSON.parse refuses one. */
function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

function loadRun(run) {
  const dir = path.join(ROOT, ".centering-lab", "runs", run, "out");
  const byKey = {};
  const duplicates = [];
  const scriptErrors = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const report = readJson(path.join(dir, file));
    const page = path.basename(file, ".json");
    for (const err of report.errors || []) scriptErrors.push(page + ": " + err);
    for (const layer of report.layers) {
      const key = page + "#" + layer.index;
      if (byKey[key]) duplicates.push(key);
      byKey[key] = layer;
    }
  }
  let meta = null;
  const metaFile = path.join(ROOT, ".centering-lab", "runs", run, "run.json");
  if (fs.existsSync(metaFile)) meta = readJson(metaFile);
  return { byKey, duplicates, scriptErrors, meta };
}

/*
 * The lower-order quantile: the value at index floor(p * n), so p95 of a group
 * of twelve is its largest member. Small groups have no interior 95th
 * percentile, which is why `n` is printed next to every row — a p95 over twelve
 * cases is a maximum wearing a percentile's name.
 */
function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function finite(value) {
  return typeof value === "number" && isFinite(value);
}

/* What the engine decided on this case, for the per-case record. */
function decision(layer) {
  const g = (layer && layer.region && layer.region.geometry) || null;
  const final = (g && g.final) || null;
  const part = (final && final.partition) || null;
  return {
    source: (g && g.source) || "",
    cuts: part ? part.cuts : "",
    used: part ? (part.used ? "sim" : "nao") : "",
    skip: part ? part.skip : "",
    fallback: final ? final.fallback : "",
    centroidSkip: final ? final.centroidSkip : "",
    exceptions: g && g.exceptions && g.exceptions.length ? g.exceptions.join(" | ") : "",
  };
}

/* The measured outcome of one case, or why there is no measurement to compare. */
function outcome(layer) {
  if (!layer) return { ok: false, why: "ausente da corrida" };
  if (layer.skipped) return { ok: false, why: "pulada (" + layer.skipped + ")" };
  const result = (layer.align && layer.align.result) || "";
  if (result) return { ok: false, why: "o motor devolveu " + result };
  const delta = layer.delta || {};
  if (!finite(delta.inkX) || !finite(delta.inkY)) return { ok: false, why: "sem delta finito" };
  return {
    ok: true,
    x: Math.abs(delta.inkX),
    y: Math.abs(delta.inkY),
    e: Math.hypot(delta.inkX, delta.inkY),
    signedX: delta.inkX,
    signedY: delta.inkY,
    repeat: finite(delta.repeatX) && finite(delta.repeatY)
      ? { x: Math.abs(delta.repeatX), y: Math.abs(delta.repeatY) }
      : null,
  };
}

/*
 * Everything that has to be true before any number below means anything: the
 * two runs measured the same options, the same population, once each, and every
 * case that has no measurement is named instead of dropped.
 */
function audit(cases, base, cand, baseName, candName) {
  const fails = [];
  const lines = [];

  if (base.meta && cand.meta) {
    for (const key of COMPARED_OPTIONS) {
      const a = base.meta.options ? base.meta.options[key] : undefined;
      const b = cand.meta.options ? cand.meta.options[key] : undefined;
      if (String(a) !== String(b)) fails.push(`opção ${key} difere entre as corridas (${a} contra ${b})`);
    }
    // The bench itself has to be the same one, or the difference being read as a
    // result is partly the difference between two harnesses.
    if (base.meta.harnessSha1 && cand.meta.harnessSha1 && base.meta.harnessSha1 !== cand.meta.harnessSha1) {
      fails.push(`o harness mudou entre as corridas (${base.meta.harnessSha1} contra ${cand.meta.harnessSha1})`);
    }
    lines.push(`bundle: base ${base.meta.hostSha1 || "?"} · novo ${cand.meta.hostSha1 || "?"}` +
      (base.meta.hostSha1 && base.meta.hostSha1 === cand.meta.hostSha1 ? "  (o mesmo motor dos dois lados)" : ""));
    lines.push(`custo: base ${base.meta.seconds}s · novo ${cand.meta.seconds}s` +
      (base.meta.seconds > 0 ? `  (${(100 * (cand.meta.seconds - base.meta.seconds) / base.meta.seconds).toFixed(1)}%)` : ""));
  } else {
    lines.push("aviso: sem run.json em " + (base.meta ? candName : baseName) + ", as opções não puderam ser conferidas");
  }

  for (const key of base.duplicates) fails.push(`${key}: chave duplicada em ${baseName}`);
  for (const key of cand.duplicates) fails.push(`${key}: chave duplicada em ${candName}`);
  for (const err of base.scriptErrors) fails.push(`${baseName} registrou erro de script — ${err}`);
  for (const err of cand.scriptErrors) fails.push(`${candName} registrou erro de script — ${err}`);

  const comparable = [];
  const broken = [];
  for (const c of cases) {
    const key = c.page + "#" + c.index;
    const b = outcome(base.byKey[key]);
    const n = outcome(cand.byKey[key]);
    if (!b.ok || !n.ok) {
      broken.push({ key, base: b, cand: n });
      continue;
    }
    comparable.push({ c, key, base: b, cand: n });
  }

  for (const item of broken) {
    if (!item.base.ok && !item.cand.ok) {
      // Failing in both runs is not a regression, but it is not a measurement
      // either: it must never be counted as UNCHANGED.
      lines.push(`  ${item.key}: sem medição nos dois lados (base: ${item.base.why}; novo: ${item.cand.why})`);
      if (item.base.why.indexOf("ausente") === 0 || item.cand.why.indexOf("ausente") === 0) {
        fails.push(`${item.key}: ${item.base.why === item.cand.why ? item.base.why : item.base.why + " / " + item.cand.why}`);
      }
    } else if (!item.cand.ok) {
      fails.push(`${item.key}: o novo motor não produziu medição (${item.cand.why}) e a base produziu`);
    } else {
      fails.push(`${item.key}: a base não produziu medição (${item.base.why}), então o caso não é comparável`);
    }
  }

  // The second press is part of the contract, not an optional extra: a case the
  // baseline measured twice and the candidate measured once has no idempotence
  // evidence at all, and silence there used to read as "did not move".
  for (const item of comparable) {
    if (item.base.repeat && !item.cand.repeat) fails.push(`${item.key}: falta a medição de segunda passada no novo motor`);
    if (!item.base.repeat && item.cand.repeat) lines.push(`  ${item.key}: segunda passada só existe no novo motor`);
  }

  lines.unshift(`população: ${cases.length} casos elegíveis, ${comparable.length} comparáveis, ${broken.length} sem medição`);
  return { fails, lines, comparable };
}

function stats(entries, side, key) {
  const values = entries.map((e) => e[side][key]);
  return {
    p50: quantile(values, 0.5),
    p75: quantile(values, 0.75),
    p95: quantile(values, 0.95),
    max: values.length ? Math.max.apply(null, values) : NaN,
    over10: values.filter((v) => v > 10).length,
    over25: values.filter((v) => v > 25).length,
    over50: values.filter((v) => v > 50).length,
  };
}

function runGate(cases, base, cand, baseName, candName) {
  const checked = audit(cases, base, cand, baseName, candName);
  const fails = checked.fails.slice();
  const lines = checked.lines.slice();
  lines.push("");

  const groups = {};
  const topoGroups = {};
  for (const item of checked.comparable) {
    const entry = {
      key: item.key,
      tol: tolerance(item.c),
      base: item.base,
      cand: item.cand,
    };
    const cat = classify(item.c);
    const topo = topology(item.c);
    (groups[cat] = groups[cat] || []).push(entry);
    (topoGroups[topo] = topoGroups[topo] || []).push(entry);
  }

  function gateOver(header, byName, names) {
    lines.push(header + " | n  | PASS base -> novo | |dX| med/p95 | |dY| med/p95 | E p95/max | >25 | >50");
    for (const name of names) {
      const list = byName[name];
      if (!list || !list.length) continue;
      const passBase = list.filter((e) => e.base.x <= e.tol && e.base.y <= e.tol).length;
      const passCand = list.filter((e) => e.cand.x <= e.tol && e.cand.y <= e.tol).length;
      const bx = stats(list, "base", "x"), by = stats(list, "base", "y"), be = stats(list, "base", "e");
      const nx = stats(list, "cand", "x"), ny = stats(list, "cand", "y"), ne = stats(list, "cand", "e");
      const pair = (a, b) => `${a.p50.toFixed(1)}/${a.p95.toFixed(0)} -> ${b.p50.toFixed(1)}/${b.p95.toFixed(0)}`;
      lines.push(
        name.padEnd(header.length) + " | " + String(list.length).padStart(2) + " |  " +
        String(passBase).padStart(2) + "/" + list.length + " -> " + String(passCand).padStart(2) + "/" + list.length + "   | " +
        pair(bx, nx).padStart(21) + " | " + pair(by, ny).padStart(21) + " | " +
        `${be.p95.toFixed(0)}/${be.max.toFixed(0)} -> ${ne.p95.toFixed(0)}/${ne.max.toFixed(0)}`.padStart(19) + " | " +
        `${be.over25}->${ne.over25}`.padStart(7) + " | " + `${be.over50}->${ne.over50}`.padStart(7)
      );

      // Gate: the tail must not grow, and a case that was already positioned
      // correctly must not stop being positioned. Both percentiles are taken
      // over the same list, so a candidate cannot improve one by failing.
      if (nx.p95 > bx.p95 + 1) fails.push(`${name}: p95 de |dX| piorou (${bx.p95.toFixed(1)} -> ${nx.p95.toFixed(1)})`);
      if (ny.p95 > by.p95 + 1) fails.push(`${name}: p95 de |dY| piorou (${by.p95.toFixed(1)} -> ${ny.p95.toFixed(1)})`);
      for (const e of list) {
        const wasGood = e.base.x <= e.tol && e.base.y <= e.tol;
        const nowGood = e.cand.x <= e.tol && e.cand.y <= e.tol;
        const message = `${e.key}: estava correto e o novo motor errou (${e.cand.x.toFixed(0)}/${e.cand.y.toFixed(0)} px contra tolerância ${e.tol.toFixed(0)})`;
        if (wasGood && !nowGood && fails.indexOf(message) < 0) fails.push(message);
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
  const repeats = checked.comparable.filter((e) => e.cand.repeat && e.base.repeat);
  if (repeats.length) {
    const restless = repeats.filter((e) => e.cand.repeat.x >= 1 || e.cand.repeat.y >= 1);
    // A case where the region itself changes after the first move was already
    // restless before: what the gate must catch is a case the baseline held
    // still and the candidate does not.
    const newlyRestless = restless.filter((e) => e.base.repeat.x < 1 && e.base.repeat.y < 1);
    lines.push(`idempotência: ${restless.length} de ${repeats.length} camadas se movem 1 px ou mais na segunda passada` +
      (restless.length ? ` (${newlyRestless.length} que o motor de base mantinha parada)` : ""));
    if (restless.length) {
      lines.push("  " + restless.slice(0, 8).map((e) => `${e.key} ${e.cand.repeat.x.toFixed(0)}/${e.cand.repeat.y.toFixed(0)}`).join(" · "));
    }
    if (newlyRestless.length) {
      fails.push(`idempotência: ${newlyRestless.length} camadas que ficavam paradas passaram a se mover quando o Align é apertado de novo`);
    }
    lines.push("");
  }

  // Per case, so a tolerated small regression is on the record instead of being
  // absorbed by a percentile.
  const verdict = { improved: [], unchanged: [], worsened: [] };
  for (const e of checked.comparable) {
    const delta = e.cand.e - e.base.e;
    if (delta < -1) verdict.improved.push(e);
    else if (delta > 1) verdict.worsened.push(e);
    else verdict.unchanged.push(e);
  }
  lines.push(`por caso: ${verdict.improved.length} IMPROVED · ${verdict.unchanged.length} UNCHANGED (±1 px) · ${verdict.worsened.length} WORSENED`);
  const worst = verdict.worsened.slice().sort((a, b) => (b.cand.e - b.base.e) - (a.cand.e - a.base.e));
  for (const e of worst.slice(0, 12)) {
    lines.push(`  WORSENED ${e.key}: E ${e.base.e.toFixed(1)} -> ${e.cand.e.toFixed(1)} px`);
  }
  const best = verdict.improved.slice().sort((a, b) => (a.cand.e - a.base.e) - (b.cand.e - b.base.e));
  for (const e of best.slice(0, 12)) {
    lines.push(`  IMPROVED ${e.key}: E ${e.base.e.toFixed(1)} -> ${e.cand.e.toFixed(1)} px`);
  }
  lines.push("");

  return { lines, fails, verdict, comparable: checked.comparable };
}

/*
 * One row per case, so a percentile can always be taken apart: signed error on
 * each axis, the euclidean error, the error relative to the frozen region size,
 * what the engine decided and what the second press did.
 */
function writeCsv(file, gate, base, cand) {
  const head = [
    "caso", "categoria", "topologia", "tolerancia", "escala",
    "base_dx", "base_dy", "base_E", "base_rel", "base_rep_x", "base_rep_y",
    "novo_dx", "novo_dy", "novo_E", "novo_rel", "novo_rep_x", "novo_rep_y",
    "veredito", "novo_status", "novo_fonte", "novo_cortes", "novo_usou", "novo_skip", "novo_fallback", "novo_centroidSkip", "novo_excecoes",
  ];
  const rows = [head.join(";")];
  for (const e of gate.comparable) {
    const scale = Math.min(e.c.region.nodeBbox.width, e.c.region.nodeBbox.height);
    const d = decision(cand.byKey[e.key]);
    const delta = e.cand.e - e.base.e;
    rows.push([
      e.key, classify(e.c), topology(e.c), tolerance(e.c).toFixed(2), scale,
      e.base.signedX.toFixed(2), e.base.signedY.toFixed(2), e.base.e.toFixed(2), (e.base.e / scale).toFixed(4),
      e.base.repeat ? e.base.repeat.x.toFixed(2) : "", e.base.repeat ? e.base.repeat.y.toFixed(2) : "",
      e.cand.signedX.toFixed(2), e.cand.signedY.toFixed(2), e.cand.e.toFixed(2), (e.cand.e / scale).toFixed(4),
      e.cand.repeat ? e.cand.repeat.x.toFixed(2) : "", e.cand.repeat ? e.cand.repeat.y.toFixed(2) : "",
      delta < -1 ? "IMPROVED" : (delta > 1 ? "WORSENED" : "UNCHANGED"),
      (cand.byKey[e.key].align && cand.byKey[e.key].align.result) || "",
      d.source, d.cuts, d.used, d.skip, d.fallback, d.centroidSkip, d.exceptions,
    ].join(";"));
  }
  fs.writeFileSync(file, rows.join("\n"), "utf8");
  console.log("\npor caso: " + file);
}

function report(baseName, candName, gate) {
  console.log("\nbase = " + baseName + "   novo = " + candName + "\n");
  console.log(gate.lines.join("\n"));
  if (gate.fails.length) {
    console.log("\nGATE REPROVADO:");
    for (const f of gate.fails) console.log("  - " + f);
    return 1;
  }
  console.log("\nGATE APROVADO: população completa, nenhuma categoria nem topologia regrediu na cauda e nenhum caso correto foi perdido.");
  return 0;
}

/*
 * The audit has to be shown to catch the two failures it exists for, or
 * "GATE APROVADO" is just a string. Both are injected into a synthetic pair of
 * runs whose real answer is "identical".
 */
function selfCheck() {
  const cases = [];
  const base = { byKey: {}, duplicates: [], scriptErrors: [], meta: { options: { scatter: "none", resize: false, padding: 0, wandTolerance: 20, liveSelection: true, phantomRatio: 0.15 } } };
  const cand = { byKey: {}, duplicates: [], scriptErrors: [], meta: { options: { scatter: "none", resize: false, padding: 0, wandTolerance: 20, liveSelection: true, phantomRatio: 0.15 } } };
  for (let i = 1; i <= 20; i++) {
    const c = {
      page: "p",
      index: i,
      canvas: { width: 2700, height: 3840 },
      region: {
        nodeBbox: { width: 400, height: 300 },
        textLayersInside: 1,
        metrics: {
          area: 100000,
          solidity: 0.95,
          touchesCanvas: { left: false, right: false, top: false, bottom: false },
          straightRuns: { flatLeft: 0, flatRight: 0 },
        },
      },
    };
    cases.push(c);
    const layer = { index: i, align: { result: "" }, delta: { inkX: 3, inkY: 4, repeatX: 0, repeatY: 0 } };
    base.byKey["p#" + i] = layer;
    cand.byKey["p#" + i] = JSON.parse(JSON.stringify(layer));
  }

  const clean = runGate(cases, base, cand, "synthetic-base", "synthetic-cand");
  assertEqual(clean.fails.length, 0, "corridas idênticas têm de passar: " + clean.fails.join("; "));

  const missing = JSON.parse(JSON.stringify(cand));
  delete missing.byKey["p#7"];
  const missingGate = runGate(cases, base, missing, "synthetic-base", "synthetic-missing");
  assertOk(
    missingGate.fails.some((f) => f.indexOf("p#7") === 0),
    "um caso ausente da candidata tem de reprovar, e não sumir da distribuição"
  );

  const failed = JSON.parse(JSON.stringify(cand));
  failed.byKey["p#7"].align.result = "noSelection";
  failed.byKey["p#7"].delta = {};
  const failedGate = runGate(cases, base, failed, "synthetic-base", "synthetic-failed");
  assertOk(
    failedGate.fails.some((f) => f.indexOf("p#7") === 0),
    "uma falha do motor tem de reprovar, e não valer erro zero"
  );

  // And the reason both matter: without the audit the injected failure would
  // have left a smaller population whose percentiles look the same or better.
  const hurt = JSON.parse(JSON.stringify(cand));
  for (const key of Object.keys(hurt.byKey)) hurt.byKey[key].delta.inkY = 40;
  const hurtGate = runGate(cases, base, hurt, "synthetic-base", "synthetic-hurt");
  assertOk(hurtGate.fails.some((f) => f.indexOf("p95 de |dY|") >= 0), "uma cauda pior tem de reprovar");

  const drifted = JSON.parse(JSON.stringify(cand));
  drifted.meta.options.scatter = "full";
  const driftedGate = runGate(cases, base, drifted, "synthetic-base", "synthetic-drifted");
  assertOk(driftedGate.fails.some((f) => f.indexOf("opção scatter") >= 0), "opções diferentes tornam o A/B inválido");

  const noRepeat = JSON.parse(JSON.stringify(cand));
  delete noRepeat.byKey["p#3"].delta.repeatX;
  const noRepeatGate = runGate(cases, base, noRepeat, "synthetic-base", "synthetic-norepeat");
  assertOk(
    noRepeatGate.fails.some((f) => f.indexOf("segunda passada") >= 0),
    "repetição ausente onde a base tem uma não pode ficar sem comparação"
  );

  const duped = JSON.parse(JSON.stringify(cand));
  duped.duplicates = ["p#4"];
  assertOk(
    runGate(cases, base, duped, "synthetic-base", "synthetic-dupe").fails.some((f) => f.indexOf("duplicada") >= 0),
    "chave duplicada tem de reprovar"
  );

  const nonFinite = JSON.parse(JSON.stringify(cand));
  nonFinite.byKey["p#5"].delta.inkX = null;
  assertOk(
    runGate(cases, base, nonFinite, "synthetic-base", "synthetic-nonfinite").fails.some((f) => f.indexOf("p#5") === 0),
    "delta não finito tem de reprovar"
  );

  console.log("compareRuns self-check passou: caso ausente, falha do motor, cauda pior, opção divergente, repetição ausente, chave duplicada e valor não finito são todos detectados.");
}

function assertOk(condition, message) {
  if (!condition) { console.error("SELF-CHECK FALHOU: " + message); process.exit(1); }
}
function assertEqual(actual, expected, message) {
  assertOk(actual === expected, message + " (obtido " + actual + ", esperado " + expected + ")");
}

function main() {
  if (process.argv.indexOf("--selfcheck") >= 0) return selfCheck();
  const baseName = process.argv[2] || "000-baseline";
  const candName = process.argv[3] || "002-fix";
  const datasetRun = process.argv[4] || baseName;
  const dataset = readJson(path.join(ROOT, ".centering-lab", "runs", datasetRun, "cases.json"));
  const cases = dataset.cases.filter((c) => !c.skipped);
  const base = loadRun(baseName);
  const cand = loadRun(candName);
  const gate = runGate(cases, base, cand, baseName, candName);
  process.exitCode = report(baseName, candName, gate);
  const csvIndex = process.argv.indexOf("--csv");
  if (csvIndex >= 0 && csvIndex + 1 < process.argv.length) {
    writeCsv(process.argv[csvIndex + 1], gate, base, cand);
  }
}

main();
