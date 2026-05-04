const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
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

const { getNextLineNumberState } = loadAppModule("app_src/lineNumbering.js");

const getIndexes = (items, resetLineCounterOnPage) => {
  let linesCounter = 0;
  return items.map((item) => {
    const next = getNextLineNumberState({
      linesCounter,
      resetLineCounterOnPage,
      isPage: item === "page",
      ignore: item === "page" || item === "ignore",
    });
    linesCounter = next.linesCounter;
    return next.index;
  });
};

assert.deepStrictEqual(getIndexes(["line", "line", "page", "line", "line"], true), [1, 2, 0, 1, 2]);
assert.deepStrictEqual(getIndexes(["line", "line", "page", "line", "line"], false), [1, 2, 0, 3, 4]);
assert.deepStrictEqual(getIndexes(["line", "ignore", "line"], true), [1, 0, 2]);

console.log("line numbering tests passed");
