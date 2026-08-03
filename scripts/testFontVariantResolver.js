const assert = require("assert");
const path = require("path");

const { resolveTypeRFontVariant } = require(path.resolve(__dirname, "../app_src/fontVariantResolver.jsxinc"));

const fonts = [
  { name: "Example Regular", postScriptName: "Example-Regular", family: "Example", style: "Regular" },
  { name: "Example Bold", postScriptName: "Example-Bold", family: "Example", style: "Bold" },
  { name: "Example Italic", postScriptName: "Example-Italic", family: "Example", style: "Italic" },
  { name: "Solo Regular", postScriptName: "Solo-Regular", family: "Solo", style: "Regular" },
  { name: "Partial Regular", postScriptName: "Partial-Regular", family: "Partial", style: "Regular" },
  { name: "Partial Bold", postScriptName: "Partial-Bold", family: "Partial", style: "Bold" },
];

const makeStyle = (family = "Example", postScriptName = "Example-Regular", style = "Regular") => ({
  fontName: family,
  fontPostScriptName: postScriptName,
  fontStyleName: style,
});

const bold = resolveTypeRFontVariant(makeStyle(), { bold: true }, fonts);
assert.strictEqual(bold.fontPostScriptName, "Example-Bold");
assert.strictEqual(bold.syntheticBold, false);
assert.strictEqual(bold.syntheticItalic, false);

const italic = resolveTypeRFontVariant(makeStyle(), { italic: true }, fonts);
assert.strictEqual(italic.fontPostScriptName, "Example-Italic");
assert.strictEqual(italic.syntheticItalic, false);

const fallback = resolveTypeRFontVariant(makeStyle("Solo", "Solo-Regular"), { bold: true, italic: true }, fonts);
assert.strictEqual(fallback.fontPostScriptName, "Solo-Regular");
assert.strictEqual(fallback.syntheticBold, true);
assert.strictEqual(fallback.syntheticItalic, true);

const partial = resolveTypeRFontVariant(makeStyle("Partial", "Partial-Regular"), { bold: true, italic: true }, fonts);
assert.strictEqual(partial.fontPostScriptName, "Partial-Bold");
assert.strictEqual(partial.syntheticBold, false);
assert.strictEqual(partial.syntheticItalic, true);

const italicBase = resolveTypeRFontVariant(makeStyle("Example", "Example-Italic", "Italic"), { bold: true }, fonts);
assert.strictEqual(italicBase.fontPostScriptName, "Example-Bold");
assert.strictEqual(italicBase.syntheticItalic, true);

console.log("font variant resolver tests passed");
