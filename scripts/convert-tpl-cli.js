const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(__dirname, relativePath);
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

const { convertTplHexToTypeRFormat } = loadAppModule("../app_src/tplConverter.js");

const convertTplFileToTypeRExport = (tplFilePath, outputJsonPath) => {
  if (!fs.existsSync(tplFilePath)) {
    throw new Error(`File not found: ${tplFilePath}`);
  }

  const hexData = fs.readFileSync(tplFilePath).toString("hex");
  const converted = convertTplHexToTypeRFormat(hexData, path.basename(tplFilePath));
  const targetPath = outputJsonPath || tplFilePath.replace(/\.tpl$/i, "_Export.json");
  fs.writeFileSync(targetPath, JSON.stringify(converted, null, 2), "utf8");
  console.log(`Converted ${converted.styles.length} text preset(s) to ${targetPath}`);
};

const args = process.argv.slice(2);
if (!args.length) {
  console.log("Usage: node scripts/convert-tpl-cli.js <path-to-file.tpl> [path-to-output.json]");
  process.exit(0);
}

try {
  convertTplFileToTypeRExport(args[0], args[1]);
} catch (error) {
  console.error(`TPL conversion failed: ${error.message || error}`);
  process.exitCode = 1;
}
