/*
 * replayPartition.js — run the shipped region split over the outlines the
 * engine really traced, without opening Photoshop.
 *
 * Where the inputs come from. A run measured with `-TraceGeometry` records, for
 * every aligned layer, the contour `_splitOutlineAtCusps` was handed, the
 * centroid of the opened region, the target the engine settled on and the
 * measured error of the move. Those four are enough to replay the split and
 * score a different one, because the move is a translation: the ink centre
 * lands on the target, so the error of any candidate is the distance from its
 * target to the position the typesetter had chosen.
 *
 * That identity is not assumed. `--validate` checks it against the measured
 * delta of every case, and checks that replaying the engine that produced the
 * run reproduces its own decisions, before any candidate number is printed.
 *
 * Nothing here reads the page name, the ground truth or the neighbours to make
 * a decision: the solver only ever sees a contour and the active layer's box.
 *
 * Usage:
 *   node scripts/lab/replayPartition.js --runs 110-none,113-overlap --validate
 *   node scripts/lab/replayPartition.js --runs 120-none --host HEAD --candidate .
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { liftFrom } = require("./liftHost");

const ROOT = path.resolve(__dirname, "..", "..");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

/*
 * The contour stored in a trace is already the engine's sample set, so the
 * replay must hand it straight through instead of resampling it again. Anything
 * else — a piece produced by a cut, a candidate that resamples on purpose — goes
 * through the host's own function.
 */
const passThrough = { contour: null };
function replayResample(real) {
  return function (poly, count) {
    if (poly === passThrough.contour) return poly;
    return real(poly, count);
  };
}

function hostSource(ref) {
  if (!ref || ref === "." || ref === "worktree") {
    return fs.readFileSync(path.join(ROOT, "app_src", "host.js"), "utf8");
  }
  if (fs.existsSync(ref)) return fs.readFileSync(ref, "utf8");
  return execFileSync("git", ["show", ref + ":app_src/host.js"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/* Every aligned layer of a run, flattened, with the geometry the solver saw. */
function loadCases(run) {
  const dir = path.join(ROOT, ".centering-lab", "runs", run, "out");
  const out = [];
  // With resize on, the box the solver was handed is the text box *after* it was
  // fitted to the balloon, and the trace does not store it — only the ground
  // truth box does, and that is a different rectangle. Reconstructing it from
  // the ground truth would be a guess, and a guess feeding the side test is how
  // a bench starts disagreeing with the engine it is supposed to reproduce (it
  // did: 9 of 15 cut decisions). Those runs are read for their measurements, not
  // replayed.
  const metaFile = path.join(ROOT, ".centering-lab", "runs", run, "run.json");
  const meta = fs.existsSync(metaFile) ? readJson(metaFile) : null;
  const replayable = !(meta && meta.options && meta.options.resize);
  if (!replayable) console.log("aviso: " + run + " usa resize, então a caixa ativa não é reconstruível — só as medições valem");
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const report = readJson(path.join(dir, file));
    const page = path.basename(file, ".json");
    for (const layer of report.layers) {
      if (layer.skipped) continue;
      const geometry = layer.region && layer.region.geometry;
      const before = layer.before || {};
      const truth = before.ink || before.metric || null;
      const scatter = layer.scatter || { dx: 0, dy: 0 };
      const box = before.metric;
      out.push({
        run,
        key: page + "#" + layer.index,
        page,
        index: layer.index,
        result: (layer.align && layer.align.result) || "",
        truth: truth ? { x: truth.xMid, y: truth.yMid } : null,
        // The box the solver was given: the ground-truth box translated by the
        // scatter that was applied just before Align.
        activeBox: (box && replayable) ? {
          left: box.left + scatter.dx,
          right: box.right + scatter.dx,
          top: box.top + scatter.dy,
          bottom: box.bottom + scatter.dy,
          width: box.width,
          height: box.height,
        } : null,
        delta: layer.delta || {},
        geometry: geometry || null,
      });
    }
  }
  return out;
}

/* What the traced run itself decided, so a replay can be checked against it. */
function recorded(c) {
  const g = c.geometry;
  if (!g) return null;
  const p = g.partition;
  const outlines = g.outlines || [];
  // The region whose outline the split actually ran on. A single Align can
  // trace more than one — dirty then clean, or again after a leaked region was
  // narrowed — and taking the last one silently scored several cases against a
  // region the engine had already discarded.
  const contour = p && p.contour && p.contour.length >= 3 ? p.contour : null;
  let used = outlines.length ? outlines[outlines.length - 1] : null;
  if (contour) {
    for (const o of outlines) {
      if (o.contour && o.contour.length === contour.length &&
          o.contour[0][0] === contour[0][0] && o.contour[0][1] === contour[0][1]) { used = o; break; }
    }
  }
  return {
    contour: contour,
    engineCentroid: p ? p.engineCentroid : null,
    target: (g.final && g.final.target) || (p && p.target) || null,
    used: !!(g.final && g.final.partition && g.final.partition.used),
    cleanTried: outlines.some((o) => o.source === "clean"),
    skip: (g.final && g.final.partition && g.final.partition.skip) || "",
    cuts: (g.final && g.final.partition && g.final.partition.cuts) || 0,
    source: g.source || "",
    fallback: (g.final && g.final.fallback) || "",
    regionCentroid: used && used.centroid ? used.centroid : null,
    regionBounds: used ? used.bounds : null,
    outlineCount: outlines.length,
    exceptions: g.exceptions || [],
  };
}

function solve(host, c, rec) {
  const report = {};
  if (!rec.contour || !c.activeBox) return { centre: null, report: { skip: "noTrace" } };
  const polygons = [rec.contour];
  passThrough.contour = rec.contour;
  let centre = null;
  try {
    centre = host.splitAtCusps(polygons, c.activeBox, report);
  } catch (e) {
    return { centre: null, report: { skip: "threw:" + e.message } };
  }
  if (centre && isFinite(centre.x) && isFinite(centre.y)) {
    if (!host.centreInsideOutline(polygons, centre)) {
      report.skip = "outsideOutline";
      centre = null;
    }
  } else {
    centre = null;
  }
  return { centre, report };
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function summarise(label, errors) {
  const e = errors.slice();
  return `${label.padEnd(22)} n=${String(e.length).padStart(3)}  p50=${quantile(e, 0.5).toFixed(1).padStart(6)}  ` +
    `p75=${quantile(e, 0.75).toFixed(1).padStart(6)}  p95=${quantile(e, 0.95).toFixed(1).padStart(6)}  ` +
    `max=${(e.length ? Math.max.apply(null, e) : NaN).toFixed(1).padStart(7)}  ` +
    `>10=${String(e.filter((v) => v > 10).length).padStart(3)}  ` +
    `>25=${String(e.filter((v) => v > 25).length).padStart(3)}  ` +
    `>50=${String(e.filter((v) => v > 50).length).padStart(3)}`;
}

/*
 * Three things have to hold before a replayed number means anything:
 * the recorded target explains the measured move, the recorded fallback is the
 * region centroid, and replaying the engine that produced the run reproduces
 * its own answer from the stored contour.
 */
function validate(cases, engineHost) {
  const move = [];
  const fallback = [];
  const replay = [];
  const mismatches = [];
  for (const c of cases) {
    const rec = recorded(c);
    if (!rec || !c.truth) continue;
    if (rec.target && isFinite(c.delta.inkX)) {
      move.push(Math.hypot(rec.target.x - (c.truth.x + c.delta.inkX), rec.target.y - (c.truth.y + c.delta.inkY)));
    }
    if (!rec.used && rec.target && rec.regionCentroid) {
      fallback.push(dist(rec.target, rec.regionCentroid));
    }
    if (!engineHost || !rec.contour || !c.activeBox) continue;
    const got = solve(engineHost, c, rec);
    const expected = rec.used ? rec.engineCentroid : null;
    if (!!got.centre !== !!expected) {
      mismatches.push(`${c.run} ${c.key}: replay ${got.centre ? "cortou" : "não cortou"} (${got.report.skip || got.report.cuts + " cortes"}), corrida ${expected ? "cortou" : "não cortou"} (${rec.skip})`);
    } else if (got.centre && expected) {
      replay.push(dist(got.centre, expected));
    }
  }
  console.log("VALIDAÇÃO");
  console.log("  " + summarise("alvo explica o movimento", move));
  console.log("  " + summarise("fallback = centroide", fallback));
  if (engineHost) {
    console.log("  " + summarise("replay = decisão gravada", replay));
    console.log(`  decisões divergentes: ${mismatches.length}`);
    for (const m of mismatches.slice(0, 15)) console.log("    " + m);
  }
  console.log("");
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (name, fallbackValue) => {
    const i = argv.indexOf("--" + name);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallbackValue;
  };
  const runs = arg("runs", "110-none,111-mid,112-full,113-overlap").split(",").filter(Boolean);
  const wantValidate = argv.indexOf("--validate") >= 0;
  const engineRef = arg("engine", "");
  const hosts = [];
  hosts.push({ name: arg("host", "worktree"), host: liftFrom(hostSource(arg("host", "worktree")), { resample: replayResample }) });
  const candidate = arg("candidate", "");
  if (candidate) hosts.push({ name: candidate, host: liftFrom(hostSource(candidate), { resample: replayResample }) });

  const cases = [];
  for (const run of runs) cases.push(...loadCases(run));

  if (wantValidate) validate(cases, engineRef ? liftFrom(hostSource(engineRef), { resample: replayResample }) : null);

  const rows = [];
  for (const c of cases) {
    const rec = recorded(c);
    if (!rec || !c.truth) continue;
    const row = { run: c.run, key: c.key, truth: c.truth, rec, engines: {} };
    const base = rec.regionCentroid;
    for (const h of hosts) {
      const got = solve(h.host, c, rec);
      const target = got.centre || base;
      row.engines[h.name] = {
        cut: !!got.centre,
        skip: got.report.skip || "",
        cuts: got.report.cuts || 0,
        share: got.report.share || 0,
        target,
        error: target ? dist(target, c.truth) : NaN,
      };
    }
    row.recordedError = rec.target ? dist(rec.target, c.truth) : NaN;
    rows.push(row);
  }

  console.log(`corpus: ${rows.length} casos em ${runs.join(", ")}\n`);
  console.log(summarise("gravado na corrida", rows.map((r) => r.recordedError).filter(isFinite)));
  for (const h of hosts) {
    const errs = rows.map((r) => r.engines[h.name].error).filter(isFinite);
    console.log(summarise("replay " + h.name, errs));
    const cuts = rows.filter((r) => r.engines[h.name].cut).length;
    console.log(`  ${" ".repeat(20)} cortes=${cuts}`);
  }

  if (hosts.length === 2) {
    const [a, b] = hosts;
    let improved = 0, worsened = 0, same = 0;
    const moved = [];
    for (const r of rows) {
      const d = r.engines[b.name].error - r.engines[a.name].error;
      if (d < -1) improved++;
      else if (d > 1) worsened++;
      else same++;
      if (Math.abs(d) > 1) moved.push({ key: r.run + " " + r.key, from: r.engines[a.name], to: r.engines[b.name], d });
    }
    console.log(`\n${a.name} -> ${b.name}: ${improved} IMPROVED · ${same} UNCHANGED · ${worsened} WORSENED`);
    moved.sort((x, y) => y.d - x.d);
    for (const m of moved.slice(0, 20)) {
      console.log(`  ${m.d > 0 ? "PIOR " : "MELH "} ${m.key.padEnd(52)} ${m.from.error.toFixed(1)} -> ${m.to.error.toFixed(1)} px  (${m.from.cuts}->${m.to.cuts} cortes, ${m.from.skip || "-"} -> ${m.to.skip || "-"})`);
    }
    if (moved.length > 20) {
      for (const m of moved.slice(-20)) {
        console.log(`  ${m.d > 0 ? "PIOR " : "MELH "} ${m.key.padEnd(52)} ${m.from.error.toFixed(1)} -> ${m.to.error.toFixed(1)} px  (${m.from.cuts}->${m.to.cuts} cortes, ${m.from.skip || "-"} -> ${m.to.skip || "-"})`);
      }
    }
  }

  const dump = arg("json", "");
  if (dump) {
    fs.writeFileSync(dump, JSON.stringify(rows, null, 1));
    console.log("\nescrito: " + dump);
  }
}

main();
