// Both build modes must include the shared solver and watch its source files.
const assert = require("assert");
const path = require("path");
const webpack = require("webpack");
const config = require("../webpack.config");
const root = path.resolve(__dirname, "..");
require("acorn").parse(require("fs").readFileSync(path.join(root, "app_src/bubbleGeometry.jsxinc"), "utf8"), { ecmaVersion: 3 });
for (const mode of ["development", "production"]) {
  const plugins = config({}, { mode })[0].plugins;
  const plugin = plugins.find(item => item.constructor.name === "HostScriptPlugin");
  assert.ok(plugin, mode);
  const watched = new Set();
  let output;
  const compilation = {
    fileDependencies: watched,
    hooks: { processAssets: { tap(options, fn) { fn(); } } },
    emitAsset(name, source) { assert.strictEqual(name, "host.jsx"); output = source.source(); },
  };
  plugin.apply({ webpack, hooks: { thisCompilation: { tap(name, fn) { fn(compilation); } } } });
  assert.ok(output.includes("function _splitOutlineAtCusps("), mode + " must ship the calibrated solver");
  assert.ok(output.includes("function setTextShapeRLayerText("), mode + " must ship the host entry points");
  assert.ok(watched.has(path.join(root, "app_src/bubbleGeometry.jsxinc")));
  assert.ok(watched.has(path.join(root, "app_src/host.js")));
}
const uxpPanel = require("../webpack.uxp.config")({}, { mode: "production" }).find(item => item.name === "uxp-panel");
assert.ok(!uxpPanel.plugins.some(item => item.constructor.name === "HostScriptPlugin"), "UXP must not include the ExtendScript host asset");
console.log("Native Webpack host build tests passed");
