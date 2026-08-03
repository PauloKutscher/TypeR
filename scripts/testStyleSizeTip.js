const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "styleSizeTip.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const loaded = { exports: {} };
new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);

const {
  STYLE_SIZE_TIP_THRESHOLD,
  STYLE_SIZE_TIP_IDLE_MS,
  normalizeStyleSizeTipCount,
  recordStyleSizeChange,
} = loaded.exports;

let tracking = recordStyleSizeChange({}, 1000);
assert.deepStrictEqual(tracking, { count: 1, lastChangeAt: 1000 });

tracking = recordStyleSizeChange(tracking, 1000 + STYLE_SIZE_TIP_IDLE_MS - 1);
assert.strictEqual(tracking.count, 1, "Rapid changes must stay in the same session");

for (let count = 2; count <= STYLE_SIZE_TIP_THRESHOLD; count += 1) {
  tracking = recordStyleSizeChange(tracking, tracking.lastChangeAt + STYLE_SIZE_TIP_IDLE_MS);
  assert.strictEqual(tracking.count, count);
}

tracking = recordStyleSizeChange(tracking, tracking.lastChangeAt + STYLE_SIZE_TIP_IDLE_MS);
assert.strictEqual(tracking.count, STYLE_SIZE_TIP_THRESHOLD, "The persisted counter must remain bounded");
assert.strictEqual(normalizeStyleSizeTipCount(-4), 0);
assert.strictEqual(normalizeStyleSizeTipCount(999), STYLE_SIZE_TIP_THRESHOLD);

console.log("style size tip tests passed");
