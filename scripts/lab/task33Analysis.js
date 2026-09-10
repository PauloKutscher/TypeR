/* Task 33: strict capture audit and a bounded raw/open correspondence experiment.
 * No case identity or typesetter position is an input to transfer(). */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { liftFrom } = require("./liftHost");
const { instrument, functionRange, sha1 } = require("./instrumentPartition");
const { classify, topology } = require("./caseClass");
const acorn = require("acorn");
const { execFileSync } = require("child_process");
const root = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");
const defaultHost = liftFrom(instrument(source));
const read = file => JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const tokens = s => [...acorn.tokenizer(s, { ecmaVersion: "latest" })].map(t => [t.type.label, t.value]);

function compare(a, b, label, tolerance = 1e-6) {
  let max = 0;
  function walk(x, y, p) {
    if (typeof x === "number" && typeof y === "number") {
      assert(Number.isFinite(x) && Number.isFinite(y), p + ": nonfinite");
      const d = Math.abs(x - y); max = Math.max(max, d);
      assert(d <= tolerance, p + ": numeric drift " + d);
    } else if (x && y && typeof x === "object" && typeof y === "object") {
      assert(JSON.stringify(Object.keys(x).sort()) === JSON.stringify(Object.keys(y).sort()), p + ": keys differ");
      for (const k of Object.keys(x)) walk(x[k], y[k], p + "." + k);
    } else assert(x === y, p + ": value differs");
  }
  walk(a, b, label);
  return max;
}

function loadRun(id, completedOnly = false) {
  assert(/^[\w.-]+$/.test(id) && id !== "." && id !== "..", "invalid run ID");
  const dir = path.join(root, ".centering-lab/runs", id);
  const meta = read(path.join(dir, "run.json"));
  assert(meta.failed === false || (completedOnly && meta.failed === true), id + ": failed run");
  assert(/^[a-f0-9]{40}$/i.test(meta.head), id + ": invalid recorded revision");
  const recordedSource = sha1(source) === meta.sourceSha1.toLowerCase() ? source
    : execFileSync("git", ["show", meta.head + ":app_src/host.js"], { cwd: root, encoding: "utf8", maxBuffer: 4000000 });
  const measuredSource = [recordedSource, recordedSource.replace(/\r\n/g, "\n"), recordedSource.replace(/\r?\n/g, "\r\n")]
    .find(s => sha1(s) === meta.sourceSha1.toLowerCase());
  assert(measuredSource, id + ": recorded source hash does not match revision; archived patch required");
  const bundle = fs.readFileSync(meta.hostJsx, "utf8");
  assert(sha1(bundle) === meta.hostSha1.toLowerCase(), id + ": archived bundle changed");
  const fn = functionRange(bundle, "_splitOutlineAtCusps");
  const expectedFunction = tokens(bundle.slice(fn.start, fn.end));
  compare(meta.groundTruthBefore, meta.groundTruthAfter, id + ": original manifest");
  assert(meta.pages.length > 0, id + ": no pages");
  const rows = new Map();
  const excluded = [];
  const omittedPages = [];
  const manifestPath = path.join(root, ".centering-lab/runs/170-none/cases.json");
  const frozen = fs.existsSync(manifestPath) ? read(manifestPath).cases : null;
  for (const page of meta.pages) {
    if (!/^OK layers=\d+ errors=0$/.test(page.result)) {
      assert(completedOnly, id + ": failed page " + page.file);
      omittedPages.push({ file: page.file, result: page.result });
      continue;
    }
    const json = read(path.join(dir, "out", page.file.replace(/\.psd$/i, ".json")));
    assert(json.errors.length === 0, id + ": page errors");
    assert(json.identity && json.identity.hostSha1 === meta.hostSha1 && json.identity.harnessSha1 === meta.harnessSha1 && json.identity.inputSha1 === page.inputSha1, id + ": identity mismatch");
    compare(tokens(json.identity.loadedPartition), expectedFunction, id + ": loaded solver");
    if (!meta.options.indices) {
      assert(frozen, id + ": full run requires frozen population in 170-none/cases.json");
      const pageName = page.file.replace(/\.psd$/i, "");
      const expected = frozen.filter(c => c.page === pageName).map(c => c.index).sort((a, b) => a - b);
      compare(expected, json.layers.map(r => r.index).sort((a, b) => a - b), id + ": page population");
    }
    for (const row of json.layers) {
      const key = page.file.replace(/\.psd$/i, "") + "#" + row.index;
      assert(!rows.has(key), id + ": duplicate " + key);
      if (row.skipped === "hiddenLayer") { excluded.push(key); continue; }
      assert(!row.skipped, id + ": skipped/error " + key);
      assert(row.restored === true, id + ": failed restoration " + key);
      rows.set(key, { row, page: json });
    }
  }
  if (meta.options.indices) {
    const wanted = meta.options.indices.split(",").map(Number).sort((a, b) => a - b);
    const got = [...rows.values()].map(x => x.row.index).sort((a, b) => a - b);
    compare(wanted, got, id + ": selected population");
  }
  return { id, meta, rows, excluded, omittedPages, host: liftFrom(instrument(measuredSource)) };
}

function auditCapture(run) {
  const host = run.host || defaultHost;
  let maxReplayDifference = 0, maxMovementResidual = 0, passes = 0;
  const unresolved = [], noSolver = [];
  for (const [key, { row }] of run.rows) {
    for (const [field, after] of [["geometry", "after"], ["geometry2", "after2"]]) {
      const g = row.region[field];
      const result = field === "geometry" ? row.align.result : row.align.result2;
      if (result !== "") {
        assert(g && !g.position && !g.final.target, key + ": failed call has a target");
        unresolved.push({ key, pass: field, result });
        continue;
      }
      assert(g && g.version === 2 && g.exceptions.length === 0 && g.position, key + ": missing geometry");
      const residual = Math.max(Math.abs(row[after].metric.xMid - g.position.target.x), Math.abs(row[after].metric.yMid - g.position.target.y));
      assert(residual <= 0.51, key + ": applied movement residual " + residual);
      maxMovementResidual = Math.max(maxMovementResidual, residual);
      passes++;
      const p = g.partition;
      if (!p) {
        assert(!g.final.partition.used && g.final.partition.cuts === 0, key + ": cut without solver input");
        noSolver.push({ key, pass: field, reason: g.final.fallback });
        continue;
      }
      assert(p && p.execution && p.acquisitionId !== null, key + ": missing real execution/acquisition");
      const acq = g.acquisitions.find(a => a.id === p.acquisitionId);
      assert(acq && acq.probe && acq.raw, key + ": missing acquisition provenance");
      const opened = acq.outlines.filter(o => o.stage === p.stage && o.polygons);
      assert(opened.length === 1, key + ": ambiguous producing call");
      compare(opened[0].polygons, p.polygons, key + ": producing polygons");
      compare(p.execution.polygons, p.polygons, key + ": solver input");
      const report = {};
      const target = host.splitAtCusps(p.execution.polygons, p.execution.activeBox, report);
      maxReplayDifference = Math.max(maxReplayDifference, compare(report.execution, p.execution, key + ": executed events"));
      compare(target, p.engineCentroid, key + ": solver centroid", 0.001);
      const used = !!(target && host.centreInsideOutline(p.polygons, target));
      assert(used === g.final.partition.used && report.cuts === g.final.partition.cuts, key + ": final decision");
      if (used) compare(target, g.final.target, key + ": final target", 0.001);
    }
  }
  return { cases: run.rows.size, excluded: run.excluded.length, passes, unresolved, noSolver, maxReplayDifference, maxMovementResidual };
}

function auditNull(base, observed) {
  assert(base.meta.harnessSha1 === observed.meta.harnessSha1, "null requires same harness");
  for (const k of ["resize", "padding", "wandTolerance", "liveSelection", "phantomRatio", "scatter", "indices"]) compare(base.meta.options[k], observed.meta.options[k], "null options " + k);
  compare([...base.rows.keys()].sort(), [...observed.rows.keys()].sort(), "null population");
  let maxDifference = 0;
  for (const [key, { row: a, page }] of base.rows) {
    const { row: b, page: other } = observed.rows.get(key);
    compare(page.identity.inputSha1, other.identity.inputSha1, key + ": input hash");
    for (const [field, after] of [["geometry", "after"], ["geometry2", "after2"]]) {
      const ag = a.region[field], bg = b.region[field];
      for (const what of ["final", "position"]) maxDifference = Math.max(maxDifference, compare(ag[what], bg[what], key + ": " + what));
      if (ag.partition && bg.partition) {
        for (const what of ["polygons", "activeBox"]) maxDifference = Math.max(maxDifference, compare(ag.partition[what], bg.partition[what], key + ": " + what));
      } else compare(ag.partition, bg.partition, key + ": solver presence");
      for (const what of ["metric", "ink"]) maxDifference = Math.max(maxDifference, compare(a[after][what], b[after][what], key + ": " + after + "." + what));
    }
  }
  return { base: base.id, observed: observed.id, maxDifference, ...auditCapture(observed) };
}

function nearestBoundary(polygons, point) {
  let best = Infinity, choices = [];
  for (let ring = 0; ring < polygons.length; ring++) {
    const poly = polygons[ring];
    for (let edge = 0; edge < poly.length; edge++) {
      const a = poly[edge], b = poly[(edge + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1];
      const square = dx * dx + dy * dy;
      if (!square) continue;
      const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / square));
      const q = [a[0] + t * dx, a[1] + t * dy], d = distance(point, q);
      if (d < best - 1e-7) { best = d; choices = []; }
      if (Math.abs(d - best) <= 1e-7 && !choices.some(c => c.ring === ring && distance(c.point, q) < 1e-7)) choices.push({ ring, edge, t, point: q, distance: d });
    }
  }
  return choices.length === 1 ? choices[0] : null;
}

function crossesInterior(a, b, c, d) {
  const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-10) return false;
  const qx = c[0] - a[0], qy = c[1] - a[1];
  const t = (qx * sy - qy * sx) / denom, u = (qx * ry - qy * rx) / denom;
  return t > 1e-7 && t < 1 - 1e-7 && u >= -1e-7 && u <= 1 + 1e-7;
}

function insertEndpoints(poly, a, b) {
  const at = p => (p.edge + p.t) % poly.length;
  const positions = [at(a), at(b)];
  const entries = poly.map((point, i) => ({ point, position: i }));
  for (const p of [a, b]) if (!entries.some(e => Math.abs(e.position - at(p)) < 1e-7)) entries.push({ point: p.point, position: at(p) });
  entries.sort((x, y) => x.position - y.position);
  return { points: entries.map(e => e.point), indices: positions.map(x => entries.findIndex(e => Math.abs(e.position - x) < 1e-7)) };
}

function transfer(rawPolygons, openedPolygons, activeBox, radius, host = defaultHost) {
  const rawReport = {};
  const rawTarget = host.splitAtCusps(rawPolygons, activeBox, rawReport);
  const result = { target: null, cuts: 0, reason: "noRawCut", mappings: [], rawTarget, rawReport };
  const proposals = rawReport.execution.events.filter(e => e.accepted);
  if (!proposals.length) return result;
  let current = host.largestContour(openedPolygons);
  const component = openedPolygons.indexOf(current);
  const others = openedPolygons.filter(p => p !== current);
  let cumulative = 1;
  for (const proposal of proposals) {
    const from = proposal.points[proposal.pair.a], to = proposal.points[proposal.pair.b];
    const domain = [current, ...others];
    const a = nearestBoundary(domain, from), b = nearestBoundary(domain, to);
    const mapping = { from, to, a, b, component, accepted: false, reason: "" };
    result.mappings.push(mapping);
    function refuse(reason) { mapping.reason = reason; result.reason = reason; return result; }
    if (!a || !b) return refuse("ambiguousEndpoint");
    if (a.ring !== 0 || b.ring !== 0) return refuse("differentComponentOrHole");
    if (Math.max(a.distance, b.distance) > radius + 0.5) return refuse("beyondOpeningRadius");
    if (distance(a.point, b.point) < 1e-7) return refuse("collapsedChord");
    for (const ring of domain) for (let k = 0; k < ring.length; k++) {
      if (crossesInterior(a.point, b.point, ring[k], ring[(k + 1) % ring.length])) return refuse("boundaryCrossing");
    }
    const mid = { x: (a.point[0] + b.point[0]) / 2, y: (a.point[1] + b.point[1]) / 2 };
    if (!host.centreInsideOutline(domain, mid)) return refuse("outsideOpened");
    const inserted = insertEndpoints(current, a, b);
    const pieces = host.splitContourAtChord(inserted.points, ...inserted.indices);
    if (!pieces) return refuse("noPiece");
    const chosen = host.pieceOnSideOf(pieces, a.point, b.point, (activeBox.left + activeBox.right) / 2, (activeBox.top + activeBox.bottom) / 2);
    if (!chosen) return refuse("noSide");
    mapping.share = chosen.share;
    const area = Math.abs(host.signedArea(current));
    if (chosen.share < host.tuning._CUSP_MIN_PIECE_SHARE) return refuse("shareLow");
    if (chosen.share > 1 - host.tuning._CUSP_MIN_PIECE_SHARE && distance(a.point, b.point) > host.tuning._CUSP_SHARE_WAIST * Math.sqrt(area)) return refuse("shareHigh");
    if (cumulative * chosen.share < host.tuning._CUSP_MIN_PIECE_SHARE) return refuse("thinPiece");
    const target = host.areaCentroid(chosen.points);
    if (!target || !host.centreInsideOutline(openedPolygons, target)) return refuse("outsideTarget");
    mapping.accepted = true;
    current = chosen.points;
    cumulative *= chosen.share;
    result.target = target;
    result.cuts++;
    result.reason = "accepted";
  }
  return result;
}

function analyze(run) {
  const host = run.host || defaultHost;
  const audit = auditCapture(run), rows = [];
  for (const [key, { row }] of run.rows) {
    const g = row.region.geometry, p = g.partition;
    if (row.align.result !== "") { rows.push({ key, status: "unresolved", reason: row.align.result, baseline: null, raw: null, candidate: null }); continue; }
    const truth = row.before.ink || row.before.metric;
    function error(t) { const dx = t.x - truth.xMid, dy = t.y - truth.yMid; return { dx, dy, E: Math.hypot(dx, dy), target: t }; }
    const base = { key, status: "resolved", baseline: error(g.position.target),
      baselineRaster: error({ x: row.after.ink.xMid, y: row.after.ink.yMid }),
      secondPass: row.delta && { x: row.delta.repeatX, y: row.delta.repeatY } };
    if (!p || p.stage !== "opened") {
      rows.push({ ...base, raw: null, candidate: base.baseline, cuts: g.final.partition.cuts,
        activated: false, reason: p ? "currentRawRetry" : "noSolverInput", mappings: [] });
      continue;
    }
    const acq = g.acquisitions.find(a => a.id === p.acquisitionId);
    if (!acq.raw.polygons) {
      rows.push({ ...base, raw: null, candidate: base.baseline, cuts: g.final.partition.cuts,
        activated: !g.final.partition.used, reason: "rawUnavailable:" + acq.raw.skip, mappings: [] });
      continue;
    }
    const radius = Math.max(0, ...acq.modifications.map(m => m.amount));
    const result = transfer(acq.raw.polygons, p.polygons, p.execution.activeBox, radius, host);
    const rawTarget = result.rawTarget && host.centreInsideOutline(acq.raw.polygons, result.rawTarget) ? result.rawTarget : acq.raw.centroid;
    const candidate = g.final.partition.used ? g.position.target : result.target || g.position.target;
    rows.push({ ...base, source: acq.source, radius, rawRings: acq.raw.polygons.length, openedRings: p.polygons.length,
      raw: rawTarget ? error(rawTarget) : null, candidate: error(candidate), activated: !g.final.partition.used,
      preserved: g.final.partition.used, cuts: g.final.partition.used ? g.final.partition.cuts : result.cuts,
      reason: g.final.partition.used ? "preservedCurrentPartition" : result.reason,
      mappings: result.mappings, secondPass: row.delta && { x: row.delta.repeatX, y: row.delta.repeatY } });
  }
  return { run: run.id, audit, rows, analysisSha1: sha1(fs.readFileSync(__filename)), omittedPages: run.omittedPages || [], identity: run.meta && {
    head: run.meta.head, sourceSha1: run.meta.sourceSha1, hostSha1: run.meta.hostSha1,
    harnessSha1: run.meta.harnessSha1, options: run.meta.options, failedRun: run.meta.failed,
    pages: run.meta.pages.map(p => ({ file: p.file, seconds: p.seconds, memoryBefore: p.memoryBefore, memoryAfter: p.memoryAfter, result: p.result }))
  } };
}

// Frozen before the candidate: a large gain in E cannot hide an axis regression.
function caseGate(row) {
  if (!row.baseline || !row.candidate) return { status: "unresolved" };
  for (const value of [row.baseline, row.candidate]) assert([value.dx, value.dy, value.E, value.target.x, value.target.y].every(Number.isFinite), row.key + ": nonfinite gate input");
  const targetChange = distance([row.baseline.target.x, row.baseline.target.y], [row.candidate.target.x, row.candidate.target.y]);
  const deltaE = row.candidate.E - row.baseline.E;
  const deltaAbsX = Math.abs(row.candidate.dx) - Math.abs(row.baseline.dx);
  const deltaAbsY = Math.abs(row.candidate.dy) - Math.abs(row.baseline.dy);
  return { status: targetChange <= 0.5 ? "withinRasterBand" : Math.max(deltaE, deltaAbsX, deltaAbsY) > 1 ? "REJECT" : "pass",
    targetChange, deltaE, deltaAbsX, deltaAbsY };
}

function summarize(result) {
  const frozen = read(path.join(root, ".centering-lab/runs/170-none/cases.json")).cases;
  const byKey = new Map(frozen.map(c => [c.page + "#" + c.index, c]));
  const groups = {};
  function stats(values) {
    values.sort((a, b) => a - b);
    const q = p => values.length ? values[Math.min(values.length - 1, Math.floor(p * values.length))] : null;
    return { n: values.length, p50: q(0.5), p75: q(0.75), p95: q(0.95), max: q(1),
      over10: values.filter(v => v > 10).length, over25: values.filter(v => v > 25).length, over50: values.filter(v => v > 50).length };
  }
  const counts = { eligible: result.rows.length, comparable: 0, unresolved: 0, activations: 0, accepted: 0, preserved: 0, fallback: 0 };
  for (const row of result.rows) {
    const c = byKey.get(row.key);
    assert(c && !c.skipped, "not in frozen eligible population: " + row.key);
    row.groups = ["TOTAL", topology(c), classify(c)];
    row.gate = caseGate(row);
    if (!row.baseline) { counts.unresolved++; continue; }
    counts.comparable++;
    if (row.activated) counts.activations++;
    if (row.activated && row.cuts > 0) counts.accepted++;
    if (row.preserved) counts.preserved++;
    if (!row.cuts) counts.fallback++;
    for (const group of row.groups) (groups[group] ||= []).push(row);
  }
  for (const [group, rows] of Object.entries(groups)) {
    groups[group] = {};
    for (const field of ["baseline", "candidate", "baselineRaster"]) {
      groups[group][field] = {};
      for (const axis of ["E", "dx", "dy"]) groups[group][field][axis] = stats(rows.filter(r => r[field]).map(r => Math.abs(r[field][axis])));
    }
  }
  const failures = result.rows.filter(r => r.gate.status === "REJECT").map(r => ({ key: r.key, ...r.gate }));
  return { counts, groups, failures, decision: failures.length ? "REJECT: per-case gate" : "NOT PROMOTED: geometry, independent data, integration and cost still required",
    candidateRaster: "not measured; candidate applied only offline", candidateSecondPass: "not measured",
    falseCuts: "manual geometry review required; texts:1 is not a ground-truth label", independentValidation: "none" };
}

function writeResults(result, output) {
  const dir = path.resolve(output), lab = path.join(root, ".centering-lab") + path.sep;
  assert(dir.startsWith(lab) && !fs.existsSync(dir), "use a new output directory inside .centering-lab");
  if (result.rows) result.summary = summarize(result);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2) + "\n");
  if (!result.rows) return;
  const fields = ["key", "status", "groups", "baseline.dx", "baseline.dy", "baseline.E", "candidate.dx", "candidate.dy", "candidate.E",
    "baselineRaster.dx", "baselineRaster.dy", "baselineRaster.E", "raw.E", "activated", "preserved", "cuts", "reason",
    "secondPass.x", "secondPass.y", "gate.status", "gate.targetChange", "gate.deltaE", "gate.deltaAbsX", "gate.deltaAbsY"];
  const csv = value => '"' + String(value == null ? "" : value).replace(/"/g, '""') + '"';
  fs.writeFileSync(path.join(dir, "cases.csv"), [fields.join(","), ...result.rows.map(r => fields.map(f => csv(f.split(".").reduce((v, k) => v && v[k], r))).join(","))].join("\n") + "\n");
}

module.exports = { compare, loadRun, auditCapture, auditNull, nearestBoundary, insertEndpoints, transfer, analyze, caseGate, summarize };
if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    const outAt = args.indexOf("--out"), output = outAt < 0 ? null : args.splice(outAt, 2)[1];
    const completedOnly = args[0] === "--completed-only";
    if (completedOnly) args.shift();
    const result = args[0] === "--null" ? auditNull(loadRun(args[1]), loadRun(args[2])) : analyze(loadRun(args[0], completedOnly));
    if (result.rows) result.summary = summarize(result);
    if (output) { writeResults(result, output); console.log(JSON.stringify({ output, audit: result.audit, summary: result.summary && { counts: result.summary.counts, failures: result.summary.failures, decision: result.summary.decision } }, null, 2)); }
    else console.log(JSON.stringify(result, null, 2));
    if (result.summary && result.summary.failures.length) process.exitCode = 2;
  } catch (error) { console.error("Task33 audit FAILED: " + error.message); process.exitCode = 1; }
}
