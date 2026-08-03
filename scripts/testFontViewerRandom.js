const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const source = fs.readFileSync(path.resolve(__dirname, "../app_src/fontViewerRandom.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const randomModule = { exports: {} };
new Function("require", "module", "exports", transformed)(require, randomModule, randomModule.exports);
const { shuffleFamilies } = randomModule.exports;

const families = new Array(20).fill(null).map((_, id) => ({ id }));
const first = shuffleFamilies(families, 12345);
const sameSeed = shuffleFamilies(families, 12345);
const anotherSeed = shuffleFamilies(families, 67890);

assert.deepStrictEqual(first, sameSeed, "a shuffle must stay stable for the same seed");
assert.notDeepStrictEqual(first, anotherSeed, "a new seed should produce a new inspiration order");
assert.deepStrictEqual(first.map(({ id }) => id).sort((a, b) => a - b), families.map(({ id }) => id));
assert.deepStrictEqual(families.map(({ id }) => id), new Array(20).fill(null).map((_, id) => id), "the source list must not be mutated");

console.log("font viewer random tests passed");
