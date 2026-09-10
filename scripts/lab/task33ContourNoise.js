/* Task 33 B, isolated from raw/open transport. Fixed document-pixel budgets;
 * no example name or reference position enters simplify() or the solver. */
const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { loadRun, caseGate, auditCapture, compare } = require("./task33Analysis");
const { liftFrom } = require("./liftHost");
const root = path.resolve(__dirname, "../..");
const host = liftFrom(fs.readFileSync(path.join(root, "app_src/host.js"), "utf8"));
const budgets = [0, 0.5, 1, 2, 4]; // Frozen before B; no fitting after results.

function segmentDistance(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], square = dx * dx + dy * dy;
  const t = square ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / square)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function simplify(poly, epsilon) {
  if (!epsilon || poly.length < 4) return poly.slice();
  let points = poly.slice();
  if (Math.hypot(points[0][0] - points.at(-1)[0], points[0][1] - points.at(-1)[1]) < 1e-9) points.pop();
  // Two open chains avoid an arbitrary zero-length root chord on a closed ring.
  const first = points.reduce((best, p, i) => p[0] < points[best][0] ? i : best, 0);
  points = points.slice(first).concat(points.slice(0, first));
  const opposite = points.reduce((best, p, i) => p[0] > points[best][0] ? i : best, 0);
  if (!opposite) return poly.slice();
  function chain(p) {
    const keep = new Set([0, p.length - 1]), stack = [[0, p.length - 1]];
    while (stack.length) {
      const [start, end] = stack.pop();
      let maximum = epsilon, selected = -1;
      for (let i = start + 1; i < end; i++) {
        const d = segmentDistance(p[i], p[start], p[end]);
        if (d > maximum) { maximum = d; selected = i; }
      }
      if (selected >= 0) { keep.add(selected); stack.push([start, selected], [selected, end]); }
    }
    return [...keep].sort((a, b) => a - b).map(i => p[i]);
  }
  const result = chain(points.slice(0, opposite + 1)).slice(0, -1)
    .concat(chain(points.slice(opposite).concat([points[0]])).slice(0, -1));
  return result.length >= 3 ? result : poly.slice();
}

function boundaryError(before, after) {
  return Math.max(...before.map(p => Math.min(...after.map((a, i) => segmentDistance(p, a, after[(i + 1) % after.length])))));
}

function totalAbsoluteTurn(poly) {
  let total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[i], c = poly[(i + 1) % poly.length];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    total += Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
  }
  return total;
}

function syntheticCheck() {
  const theta = Math.acos(60 / 70), neck = Math.sqrt(70 * 70 - 60 * 60), clean = [];
  for (const [cx, start, end] of [[-60, theta, 2 * Math.PI - theta], [60, Math.PI + theta, 3 * Math.PI - theta]]) {
    for (let i = 0; i <= 600; i++) { const a = start + (end - start) * i / 600; clean.push([cx + 70 * Math.cos(a), 70 * Math.sin(a)]); }
  }
  const rows = [];
  for (const phase of [0, 0.25, 0.5]) {
    // Contour-level raster/phase perturbation, not a Photoshop AA simulation.
    const noisy = clean.map(([x, y], i) => [Math.round(x + phase) - phase + 0.35 * Math.sin(i * 1.7), Math.round(y + phase) - phase + 0.35 * Math.cos(i * 1.3)]);
    for (const epsilon of budgets.slice(1)) {
      const filtered = simplify(noisy, epsilon), error = boundaryError(noisy, filtered);
      assert(error <= epsilon + 1e-8, "geometric error budget exceeded");
      const retainedNeck = [neck, -neck].every(y => Math.min(...filtered.map(p => Math.hypot(p[0], p[1] - y))) <= epsilon + 1);
      const report = {};
      host.splitAtCusps([filtered], { left: -85, right: -35, top: -20, bottom: 20 }, report);
      const turnBefore = totalAbsoluteTurn(noisy), turnAfter = totalAbsoluteTurn(filtered);
      if (epsilon >= 1) assert(turnAfter < turnBefore / 4, "high-frequency contour oscillation was not removed");
      assert(retainedNeck && report.cuts === 1, "known synthetic junction was lost");
      rows.push({ phase, epsilon, inputPoints: noisy.length, outputPoints: filtered.length, error, retainedNeck, cuts: report.cuts, turnBefore, turnAfter });
    }
  }
  return rows;
}

function experiment(runs) {
  const audits = runs.map(run => ({ run: run.id, ...auditCapture(run) }));
  const expected = JSON.parse(fs.readFileSync(path.join(root, ".centering-lab/runs/170-none/cases.json"), "utf8")).cases.filter(c => !c.skipped).map(c => c.page + "#" + c.index).sort();
  compare(runs.flatMap(run => [...run.rows.keys()]).sort(), expected, "B frozen population");
  const rows = [];
  for (const run of runs) for (const [key, { row }] of run.rows) {
    const host = run.host;
    const geometry = row.region.geometry, p = geometry.partition;
    if (row.align.result !== "" || !p || p.stage !== "opened" || geometry.final.partition.used) continue;
    const acquisition = geometry.acquisitions.find(a => a.id === p.acquisitionId);
    if (!acquisition.raw.polygons) continue;
    const truth = row.before.ink || row.before.metric;
    const error = target => ({ target, dx: target.x - truth.xMid, dy: target.y - truth.yMid, E: Math.hypot(target.x - truth.xMid, target.y - truth.yMid) });
    for (const epsilon of budgets) {
      const polygons = acquisition.raw.polygons.map(poly => simplify(poly, epsilon));
      const report = {};
      const target = host.splitAtCusps(polygons, p.execution.activeBox, report);
      const used = !!(target && host.centreInsideOutline(polygons, target));
      const result = { key, epsilon, baseline: error(geometry.position.target), candidate: error(used ? target : geometry.position.target), cuts: used ? report.cuts : 0,
        rawPoints: acquisition.raw.polygons.reduce((n, p) => n + p.length, 0), filteredPoints: polygons.reduce((n, p) => n + p.length, 0), skip: report.skip };
      result.gate = caseGate(result);
      rows.push(result);
    }
  }
  return { experiment: "B: bounded simplification then raw solver; no A transport", budgets, audits, synthetic: syntheticCheck(), rows };
}

module.exports = { simplify, boundaryError, syntheticCheck, experiment };
if (require.main === module) {
  try {
    const [first, second, output] = process.argv.slice(2);
    assert(first && second && output, "usage: node scripts/lab/task33ContourNoise.js <completed-partial-run> <complete-run> <new-output.json>");
    const destination = path.resolve(output);
    assert(destination.startsWith(path.join(root, ".centering-lab") + path.sep) && !fs.existsSync(destination), "new lab output required");
    const result = experiment([loadRun(first, true), loadRun(second)]);
    fs.writeFileSync(destination, JSON.stringify(result, null, 2) + "\n");
    const byBudget = budgets.map(epsilon => ({ epsilon,
      cases: result.rows.filter(r => r.epsilon === epsilon).length,
      cuts: result.rows.filter(r => r.epsilon === epsilon && r.cuts > 0).length,
      rejections: result.rows.filter(r => r.epsilon === epsilon && r.gate.status === "REJECT").length }));
    const rejected = byBudget.filter(b => b.epsilon > 0).every(b => b.rejections > 0);
    console.log(JSON.stringify({ output, syntheticChecks: result.synthetic.length, byBudget, decision: rejected ? "REJECT: every filtered budget fails per-case gates" : "NOT PROMOTED: remaining gates required" }));
    if (rejected) process.exitCode = 2;
  } catch (error) { console.error("Task33 B FAILED: " + error.message); process.exitCode = 1; }
}
