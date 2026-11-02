// Guard the hardware calibration at the host boundary, not only the polygon solver.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
for (const file of ["app_src/host.js", "uxp-src/host/photoshop.js"]) {
  const source = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
  const fn = source.match(/function _alignReadOutline\([^]*?\n\}/);
  assert.ok(fn, file);
  let tolerance;
  const rawPath = { pathContents: { pathComponents: [] } };
  const bounds = { left: 10, top: 20, right: 60, bottom: 80 };
  const box = vm.createContext({
    _liveSelectionBounds: () => bounds,
    _makeWorkPathFromSelection: value => { tolerance = value; },
    _smartReadWorkPath: () => rawPath,
    play: descriptor => { tolerance = descriptor.tolerance._value; },
    get: () => rawPath, px: value => ({ _unit: "pixelsUnit", _value: value }), SELECTION: {},
  });
  vm.runInContext(fn[0], box);
  const result = box._alignReadOutline();
  assert.strictEqual(tolerance, 0.5, file + " must keep the calibrated path precision");
  assert.strictEqual(result.rawPath, rawPath);
  assert.deepStrictEqual({ ...result.selectionBounds }, bounds);
}
console.log("Align capture precision tests passed");
