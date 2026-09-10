/* Observation must preserve both the source solver and the installed build. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const acorn = require("acorn");
const { instrument } = require("./lab/instrumentPartition");
const { liftFrom } = require("./lab/liftHost");
const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");
const bundle = fs.readFileSync(path.join(root, "app/host.jsx"), "utf8");
const real = liftFrom(source);
const observed = liftFrom(instrument(source));
const pure = ["_pointInPolygon", "_polygonCentroid", "_polygonSignedArea", "_polygonAreaCentroid",
  "_largestContour", "_resampleContour", "_centreInsideOutline", "_splitContourAtChord",
  "_pieceOnSideOf", "_findCuspPair", "_splitOutlineAtCusps"];
const nodes = acorn.parse(bundle, { ecmaVersion: "latest" }).body
  .filter(n => n.type === "FunctionDeclaration" && pure.includes(n.id.name));
assert.strictEqual(nodes.length, pure.length);
const compiled = vm.createContext({ ...real.tuning });
vm.runInContext(nodes.map(n => bundle.slice(n.start, n.end)).join("\n"), compiled);
const plain = x => JSON.parse(JSON.stringify(x));
let checked = 0;
function check(polygons, box, label) {
  const a = {}, b = {}, c = {};
  const expected = real.splitAtCusps(polygons, box, a);
  const result = observed.splitAtCusps(polygons, box, b);
  const built = compiled._splitOutlineAtCusps(polygons, box, c);
  assert.deepStrictEqual(result, expected, label + ": observer target");
  assert.deepStrictEqual(plain(built), plain(expected), label + ": bundled target");
  const execution = b.execution;
  delete b.execution;
  assert.deepStrictEqual(b, a, label + ": observer decision");
  assert.deepStrictEqual(plain(c), a, label + ": bundled decision");
  assert.strictEqual(execution.events.filter(e => e.accepted).length, a.cuts, label + ": actual cuts");
  for (const e of execution.events) {
    assert(e.accepted || e.guard, label + ": every attempt has an outcome");
    if (e.accepted) assert(e.shareAfter >= real.tuning._CUSP_MIN_PIECE_SHARE);
  }
  checked++;
  return execution;
}
const fixtures = require("./balloonOutlines.fixture.json");
for (const [name, f] of Object.entries(fixtures)) {
  const trace = check([f.contour], f.box, name);
  if (name === "chainTop") assert.strictEqual(trace.events.filter(e => e.accepted).length, 1);
  if (name === "chainMiddle") assert.strictEqual(trace.events.filter(e => e.accepted).length, 2);
  // Fixture names predate the membership fix: a formerly refused first pair
  // can now succeed. The decision must agree with the current bundle.
}
check(null, null, "missing input");
check([], fixtures.singleBalloon.box, "empty input");
assert.throws(() => instrument(source.replace("_findCuspPair(points, attempt)", "CHANGED(points, attempt)")), /instrumentation|anchor/);
// Existing data is optional; the versioned tests remain runnable in a clone.
const archived = path.join(root, ".centering-lab/runs/190-rawoutline/out");
if (fs.existsSync(archived)) {
  for (const file of fs.readdirSync(archived).filter(f => f.endsWith(".json"))) {
    const page = JSON.parse(fs.readFileSync(path.join(archived, file), "utf8").replace(/^\uFEFF/, ""));
    for (const row of page.layers) {
      if (row.skipped || !row.region.trueRegion) continue;
      for (const field of ["rawOutline", "openedOutline"]) {
        const points = row.region.trueRegion[field];
        if (points && points.length) check([points], row.before.metric, file + "#" + row.index + "/" + field);
      }
    }
  }
}
console.log("Task 33: " + checked + " source/bundle/observer equivalence checks passed");

const analysis = require("./lab/task33Analysis");
const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
assert.strictEqual(analysis.nearestBoundary([square], [50, 50]), null, "equally plausible endpoints must be refused");
const vertex = analysis.nearestBoundary([square], [-1, -1]);
assert.deepStrictEqual(vertex.point, [0, 0], "two segments sharing one endpoint are one correspondence");
const left = analysis.nearestBoundary([square], [-1, 40]);
const right = analysis.nearestBoundary([square], [101, 40]);
const inserted = analysis.insertEndpoints(square, left, right);
const pieces = real.splitContourAtChord(inserted.points, ...inserted.indices);
const shares = pieces.map(p => Math.abs(real.signedArea(p)) / 10000).sort();
assert(Math.abs(shares[0] - 0.4) < 1e-9 && Math.abs(shares[1] - 0.6) < 1e-9, "transported chord must conserve area");
assert.throws(() => analysis.compare([1], [], "population"), /keys differ/);
assert.throws(() => analysis.compare({ x: 1 }, { x: NaN }, "target"), /nonfinite/);
assert.throws(() => analysis.compare({ x: 1 }, { x: 2 }, "target"), /numeric drift/);
assert.strictEqual(analysis.caseGate({ baseline: { target: { x: 20, y: 2 }, dx: 20, dy: 2, E: Math.hypot(20, 2) },
  candidate: { target: { x: 0, y: 6 }, dx: 0, dy: 6, E: 6 } }).status, "REJECT", "E improvement cannot hide axis regression");
assert.strictEqual(analysis.caseGate({ baseline: null, candidate: null }).status, "unresolved");
assert.throws(() => analysis.caseGate({ baseline: { target: { x: 0, y: 0 }, dx: NaN, dy: 0, E: 0 },
  candidate: { target: { x: 0, y: 0 }, dx: 0, dy: 0, E: 0 } }), /nonfinite gate input/);
console.log("Task 33: correspondence and fail-closed audit checks passed");
const noise = require("./lab/task33ContourNoise");
assert.deepStrictEqual(noise.simplify(square, 0), square);
assert.strictEqual(noise.syntheticCheck().length, 12);
console.log("Task 33: bounded-noise synthetic checks passed");
