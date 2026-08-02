const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(rootDir, relativePath);
  const source = fs.readFileSync(filePath, "utf8");
  const { code } = babel.transformSync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });

  const mod = new Module(filePath, module);
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(code, filePath);
  return mod.exports;
};

const { getAutomaticTagStyles } = loadAppModule("app_src/folderUtils.js");

const styles = [
  { id: "unsorted-a", folder: null },
  { id: "unsorted-b" },
  { id: "folder-a-1", folder: "folder-a" },
  { id: "folder-a-2", folder: "folder-a" },
  { id: "folder-b-1", folder: "folder-b" },
  { id: "nested", folder: "folder-a-child" },
];

assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "folder-a-1").map((style) => style.id),
  ["folder-a-1", "folder-a-2"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "nested").map((style) => style.id),
  ["nested"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "unsorted-a").map((style) => style.id),
  ["unsorted-a", "unsorted-b"]
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "folder-a-1", false).map((style) => style.id),
  styles.map((style) => style.id)
);
assert.deepStrictEqual(
  getAutomaticTagStyles(styles, "missing").map((style) => style.id),
  styles.map((style) => style.id)
);

console.log("current folder tag isolation tests passed");
