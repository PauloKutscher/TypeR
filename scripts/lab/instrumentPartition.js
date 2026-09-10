/* Lab-only observation of the actual solver. Never edits/installs a host. */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const acorn = require("acorn");

function functionRange(source, name) {
  const nodes = acorn.parse(source, { ecmaVersion: "latest" }).body
    .filter(n => n.type === "FunctionDeclaration" && n.id.name === name);
  assert.strictEqual(nodes.length, 1, "one top-level " + name);
  return nodes[0];
}

function instrument(source) {
  const node = functionRange(source, "_splitOutlineAtCusps");
  let fn = source.slice(node.start, node.end).replace(/\r\n/g, "\n");
  function once(from, to) {
    assert.strictEqual(fn.split(from).length, 2, "instrumentation anchor changed: " + from);
    fn = fn.replace(from, to);
  }
  once("  if (report) { report.skip", "  var execution = { version: 1, polygons: polygons, activeBox: activeBox, events: [] };\n  if (report) report.execution = execution;\n  if (report) { report.skip");
  once("  if (!points || points.length", "  execution.contour = points;\n  if (!points || points.length");
  once("      var pair = _findCuspPair(points, attempt);", "      var pair = _findCuspPair(points, attempt);\n      var event = { pass: pass, attempt: attempt, points: points, pair: pair, shareBefore: share, accepted: false, guard: '' };\n      execution.events.push(event);");
  for (const [condition, guard] of [
    ["!pair", "noCusp"], ["pair.a < 0", "shallow"], ["!pieces", "noPiece"],
    ["!chosen", "noSide"], ["chosen.share < _CUSP_MIN_PIECE_SHARE", "shareLow"],
    ["!waist", "shareHigh"], ["share * chosen.share < _CUSP_MIN_PIECE_SHARE", "thinPiece"],
  ]) once("if (" + condition + ") {", "if (" + condition + ") {\n        event.guard = '" + guard + "';");
  once("      if (!chosen) {", "      event.chosen = chosen;\n      if (!chosen) {");
  once("      points = chosen.points;", "      event.accepted = true;\n      event.shareAfter = share * chosen.share;\n      points = chosen.points;");
  once("  if (!cuts) return null;", "  execution.piece = points;\n  if (!cuts) return null;");
  once("  var centre = _polygonAreaCentroid(points);", "  var centre = _polygonAreaCentroid(points);\n  execution.centroid = centre;");
  return source.slice(0, node.start) + fn + source.slice(node.end);
}

function sha1(data) { return crypto.createHash("sha1").update(data).digest("hex"); }

function prepare(root, output) {
  const lab = path.resolve(root, ".centering-lab");
  output = path.resolve(output);
  assert(output.startsWith(lab + path.sep), "bundles must stay inside .centering-lab");
  assert(!fs.existsSync(output), "use a new bundle directory");
  const source = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");
  const bundle = fs.readFileSync(path.join(root, "app/host.jsx"), "utf8");
  const observedSource = instrument(source);
  const srcNode = functionRange(observedSource, "_splitOutlineAtCusps");
  const bundleNode = functionRange(bundle, "_splitOutlineAtCusps");
  const observedBundle = bundle.slice(0, bundleNode.start) + observedSource.slice(srcNode.start, srcNode.end) + bundle.slice(bundleNode.end);
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, "base.jsx"), bundle);
  fs.writeFileSync(path.join(output, "observed.jsx"), observedBundle);
  const manifest = { sourceSha1: sha1(source), baseSha1: sha1(bundle), observedSha1: sha1(observedBundle), observerSha1: sha1(fs.readFileSync(__filename)), changedFunction: "_splitOutlineAtCusps", productionChanged: false };
  fs.writeFileSync(path.join(output, "identity.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
}

module.exports = { instrument, functionRange, prepare, sha1 };
if (require.main === module) {
  const root = path.resolve(__dirname, "../..");
  assert(process.argv[2], "usage: node scripts/lab/instrumentPartition.js .centering-lab/task33/bundles");
  console.log(JSON.stringify(prepare(root, process.argv[2]), null, 2));
}
