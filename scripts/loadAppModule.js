const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

// The app_src modules are ESM; Node's require can't load them and the ad-hoc
// loaders inside each test script can't follow relative imports between them.
// This transforms a file to CommonJS and resolves its relative imports the
// same way, recursively, so a module is free to import a sibling.
const cache = new Map();

const loadAppModule = (filePath) => {
  const resolved = require.resolve(path.resolve(filePath));
  if (cache.has(resolved)) return cache.get(resolved);

  const { code } = babel.transformSync(fs.readFileSync(resolved, "utf8"), {
    filename: resolved,
    babelrc: false,
    configFile: false,
    presets: [["@babel/preset-env", { modules: "commonjs" }]],
  });

  const moduleShim = { exports: {} };
  cache.set(resolved, moduleShim.exports);
  const localRequire = (request) =>
    request.startsWith(".")
      ? loadAppModule(path.resolve(path.dirname(resolved), request))
      : require(request);
  new Function("require", "module", "exports", code)(localRequire, moduleShim, moduleShim.exports);
  cache.set(resolved, moduleShim.exports);
  return moduleShim.exports;
};

module.exports = { loadAppModule };
