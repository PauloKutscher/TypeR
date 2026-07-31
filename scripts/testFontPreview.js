const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const filePath = path.resolve(rootDir, "app_src/fontPreview.js");
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

const {
  createFontPreviewRegistry,
  findInstalledFont,
  getFontPreviewFamily,
} = mod.exports;

const textStyle = {
  fontPostScriptName: "ExampleSans-Bold",
  fontName: "Example Sans Bold",
};
const installedFont = {
  postScriptName: "ExampleSans-Bold",
  name: "Example Sans Bold",
  family: "Example Sans",
  style: "Bold",
};

assert.strictEqual(findInstalledFont([], textStyle), undefined);
assert.strictEqual(findInstalledFont([installedFont], textStyle), installedFont);

const missingRegistry = createFontPreviewRegistry([], [textStyle], 1);
assert.strictEqual(missingRegistry.css, "");
assert.strictEqual(
  getFontPreviewFamily(textStyle, missingRegistry),
  '"Example Sans Bold", "ExampleSans-Bold", "Tahoma"'
);

const installedRegistry = createFontPreviewRegistry([installedFont], [textStyle], 2);
assert.ok(installedRegistry.css.includes('@font-face{font-family:"TypeRPreview_2_0"'));
assert.ok(installedRegistry.css.includes('local("ExampleSans-Bold")'));
assert.strictEqual(
  getFontPreviewFamily(textStyle, installedRegistry),
  '"TypeRPreview_2_0", "Example Sans Bold", "ExampleSans-Bold", "Tahoma"'
);

const refreshedRegistry = createFontPreviewRegistry([installedFont], [textStyle], 3);
assert.notStrictEqual(
  getFontPreviewFamily(textStyle, installedRegistry),
  getFontPreviewFamily(textStyle, refreshedRegistry)
);

console.log("font preview refresh tests passed");
