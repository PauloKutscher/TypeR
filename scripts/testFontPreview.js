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
  getTextStyleFontKey,
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

const wildjessRegular = {
  postScriptName: "Wildjess",
  name: "Wildjess",
  family: "Wildjess",
  style: "Regular",
};
const wildjessBoldItalic = {
  postScriptName: "Wildjess-BoldItalic",
  name: "Wildjess BoldItalic",
  family: "Wildjess",
  style: "Bold Italic",
};
const wildjessTextStyle = {
  fontPostScriptName: "Wildjess",
  fontName: "Wildjess",
  fontStyleName: "BoldItalic",
};

assert.strictEqual(
  findInstalledFont([wildjessRegular, wildjessBoldItalic], wildjessTextStyle),
  wildjessBoldItalic,
  "family + style must resolve the exact face instead of the first family member"
);

const wildjessRegistry = createFontPreviewRegistry(
  [wildjessRegular, wildjessBoldItalic],
  [wildjessTextStyle],
  0,
  "preview"
);
assert.ok(wildjessRegistry.css.includes('@font-face{font-family:"TypeRPreview_preview_0_0"'));
assert.ok(wildjessRegistry.css.includes('local("Wildjess-BoldItalic")'));
assert.ok(wildjessRegistry.css.includes('local("Wildjess Bold Italic")'));
assert.strictEqual(
  getFontPreviewFamily(wildjessTextStyle, wildjessRegistry),
  '"TypeRPreview_preview_0_0", "Wildjess", "Tahoma"'
);


// --- alias stability -------------------------------------------------------
// Aliases used to be numbered by their position in the rule list, so the same
// font changed name whenever another font entered or left the registry. That
// rewrote the whole <style> block and made every element using it resolve its
// face again, on every style switch.
const fontA = { postScriptName: "AlphaSans-Regular", name: "Alpha Sans", family: "Alpha Sans", style: "Regular" };
const fontB = { postScriptName: "BetaSans-Regular", name: "Beta Sans", family: "Beta Sans", style: "Regular" };
const fontC = { postScriptName: "GammaSans-Regular", name: "Gamma Sans", family: "Gamma Sans", style: "Regular" };
const styleA = { fontPostScriptName: "AlphaSans-Regular", fontName: "Alpha Sans" };
const styleB = { fontPostScriptName: "BetaSans-Regular", fontName: "Beta Sans" };
const styleC = { fontPostScriptName: "GammaSans-Regular", fontName: "Gamma Sans" };
// One installed-font list, reused by every call below: that shared identity is
// what lets the panel keep a single alias table
const installed = [fontA, fontB, fontC];

const bothFonts = createFontPreviewRegistry(installed, [styleA, styleB], 0, "preview");
const aliasA = bothFonts.aliases[getTextStyleFontKey(styleA)];
const aliasB = bothFonts.aliases[getTextStyleFontKey(styleB)];
assert.ok(aliasA && aliasB && aliasA !== aliasB, "each font needs its own alias");

// The first font drops out of the request: the second must keep its name
const onlyB = createFontPreviewRegistry(installed, [styleB], 0, "preview");
assert.strictEqual(
  onlyB.aliases[getTextStyleFontKey(styleB)],
  aliasB,
  "the alias must follow the font, not its position in the rule list"
);

// ...and comes back: both names are the ones handed out the first time
const bothAgain = createFontPreviewRegistry(installed, [styleA, styleB], 0, "preview");
assert.strictEqual(bothAgain.aliases[getTextStyleFontKey(styleA)], aliasA);
assert.strictEqual(bothAgain.aliases[getTextStyleFontKey(styleB)], aliasB);

// --- the sheet only ever grows ---------------------------------------------
// Re-injecting the <style> block forces a full style recalculation of the
// panel, so a request for fonts already registered must leave it byte-identical
assert.strictEqual(onlyB.css, bothFonts.css, "a known font must not rewrite the sheet");
assert.strictEqual(bothAgain.css, bothFonts.css, "a known font must not rewrite the sheet");

const withC = createFontPreviewRegistry(installed, [styleC], 0, "preview");
assert.ok(withC.css.startsWith(bothFonts.css), "a new font appends, it never reorders");
assert.ok(withC.css.length > bothFonts.css.length, "a new font adds its own @font-face");
assert.strictEqual(
  withC.aliases[getTextStyleFontKey(styleA)],
  aliasA,
  "registering a new font must not rename the existing ones"
);

// --- one alias table per installed-font list -------------------------------
// The style list and the preview block ask for different fonts; sharing the
// table means the preview reuses faces the style list already registered
const otherCaller = createFontPreviewRegistry(installed, [styleA], 0);
assert.strictEqual(
  otherCaller.aliases[getTextStyleFontKey(styleB)],
  aliasB,
  "callers sharing an installed-font list share the alias table"
);
assert.strictEqual(otherCaller.css, withC.css, "and share the same accumulated sheet");

// A different installed-font list is a different table: fonts reinstalled
// mid-session must be resolved again instead of keeping a stale face
const afterFontRefresh = createFontPreviewRegistry([fontA, fontB, fontC], [styleA], 0, "preview");
assert.notStrictEqual(
  afterFontRefresh.aliases[getTextStyleFontKey(styleA)],
  aliasA,
  "a refreshed font list starts a new alias table"
);

console.log("font preview refresh tests passed");
