const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");
const moduleCache = {};

const loadAppModule = (relativePath) => {
  const filePath = path.resolve(rootDir, relativePath);
  if (moduleCache[filePath]) return moduleCache[filePath].exports;

  const source = fs.readFileSync(filePath, "utf8");
  const { code } = babel.transformSync(source, {
    filename: filePath,
    babelrc: false,
    configFile: false,
    plugins: [
      "@babel/plugin-transform-modules-commonjs",
      "@babel/plugin-proposal-optional-chaining",
      "@babel/plugin-proposal-class-properties",
    ],
  });

  const mod = new Module(filePath, module);
  moduleCache[filePath] = mod;
  mod.filename = filePath;
  mod.paths = Module._nodeModulePaths(path.dirname(filePath));
  mod._compile(code, filePath);
  return mod.exports;
};

const {
  estimateManualLineCount,
  generateManualTextShapeRVariant,
  generateTextShapeRVariants,
  visibleLength,
  visibleWidth,
} = loadAppModule("app_src/textShapeR.js");

const variants = generateTextShapeRVariants("This sentence needs a pleasant bubble shaped manga layout today.");
// Default cap is MAX_VARIANTS (12); the exact count depends on how many
// unique candidates the sentence yields, so only bound it
assert.ok(variants.length > 0 && variants.length <= 12);
assert.strictEqual(new Set(variants.map((variant) => variant.text)).size, variants.length);
assert.ok(variants[0].lines.length >= 2);

const bestLengths = variants[0].lines.map(visibleLength);
const middleIndex = Math.floor((bestLengths.length - 1) / 2);
const middleLength = bestLengths[middleIndex];
if (bestLengths.length > 2) {
  assert.ok(middleLength >= bestLengths[0]);
  assert.ok(middleLength >= bestLengths[bestLengths.length - 1]);
} else {
  assert.ok(Math.abs(bestLengths[0] - bestLengths[1]) <= 6);
}

const hyphenated = generateTextShapeRVariants("extraordinarily shaped lettering can fit better", { limit: 10 });
assert.ok(hyphenated.some((variant) => /-\n/.test(variant.text)));

const noHyphen = generateTextShapeRVariants("extraordinarily shaped lettering can fit better", { limit: 10, allowHyphenation: false });
assert.ok(noHyphen.every((variant) => !/-\n/.test(variant.text)));

const markdown = generateTextShapeRVariants("A **bold sentence** should keep markdown markers safe", { limit: 10 });
assert.ok(markdown.every((variant) => !/\*\*bo\nld|sent\nence\*\*/.test(variant.text)));
assert.ok(markdown.every((variant) => (variant.text.match(/\*\*/g) || []).length === 2));

const short = generateTextShapeRVariants("Bonjour");
assert.deepStrictEqual(short.map((variant) => variant.text), ["Bonjour"]);

const profileText = "A longer sentence can choose different bubble silhouettes for the same lettering.";
const tall = generateTextShapeRVariants(profileText, { profile: "tall", limit: 10 });
const wide = generateTextShapeRVariants(profileText, { profile: "wide", limit: 10 });
assert.ok(tall[0].lines.length > wide[0].lines.length);
assert.ok(visibleWidth("minimum") < visibleWidth("maximum"));

const punctuated = generateTextShapeRVariants("Mais attends, je voulais juste te parler de ce qui est arrive hier soir.", { limit: 10 });
assert.ok(/attends,\n/.test(punctuated[0].text));

const clyde = generateTextShapeRVariants("CLYDE, JE PEUX UTILISER UN M\u00c9DAILLON ?", { limit: 10 });
const hasAbruptJump = (variant) => {
  const widths = variant.lines.map(visibleWidth);
  const maxWidth = Math.max.apply(null, widths);
  return widths.some((width, index) => (
    index > 0 && Math.abs(width - widths[index - 1]) / maxWidth > 0.55
  ));
};
assert.ok(!/^CLYDE,\nJE PEUX UTILISER/.test(clyde[0].text));
assert.ok(clyde.slice(0, 5).every((variant) => variant.lines.length <= 2 || !hasAbruptJump(variant)));

// French spacing before "!" / "?" must never allow punctuation to start a
// line or an opening quote to end one
const frenchPunctuation = generateTextShapeRVariants("salut ! comment ça va aujourd'hui mes amis ?", { limit: 12 });
assert.ok(frenchPunctuation.length > 0);
frenchPunctuation.forEach((variant) => {
  variant.lines.forEach((line) => {
    assert.ok(!/^[!?;:.,…»›)\]}]/.test(line.trim()), `line starts with punctuation: "${line}" in\n${variant.text}`);
    assert.ok(!/[«‹¿¡(\[{]$/.test(line.trim()), `line ends with opening punctuation: "${line}" in\n${variant.text}`);
  });
});

const frenchHyphenation = generateTextShapeRVariants("utiliser", { limit: 10 });
assert.ok(frenchHyphenation.some((variant) => /uti-\nliser/i.test(variant.text)));
assert.ok(frenchHyphenation.every((variant) => !/util-\niser/i.test(variant.text)));

const manualText = "Manual shaping should follow the bubble selection and still keep a readable text block.";
const manual = generateManualTextShapeRVariant(manualText, {
  width: 260,
  height: 360,
  shape: "ellipse",
  lineCount: 5,
  softness: 0.6,
  floor: 0.15,
});
assert.strictEqual(manual.lines.length, 5);
assert.strictEqual(manual.text.split("\n").length, 5);
assert.ok(manual.widths.length === manual.targets.length);

const manualTall = estimateManualLineCount(manualText, 220, 440);
const manualWide = estimateManualLineCount(manualText, 440, 220);
assert.ok(manualTall > manualWide);

const selectionProfile = {
  rows: [
    { y: 0, left: 0.45, right: 0.55, width: 0.1 },
    { y: 0.25, left: 0.18, right: 0.82, width: 0.64 },
    { y: 0.5, left: 0, right: 1, width: 1 },
    { y: 0.75, left: 0.28, right: 0.72, width: 0.44 },
    { y: 1, left: 0.48, right: 0.52, width: 0.04 },
  ],
};
const selectionManual = generateManualTextShapeRVariant(manualText, {
  width: 260,
  height: 360,
  shape: "selection",
  shapeProfile: selectionProfile,
  lineCount: 5,
});
assert.ok(selectionManual.targets[2] > selectionManual.targets[0]);
assert.ok(selectionManual.targets[2] > selectionManual.targets[4]);

console.log("TextShapeR tests passed");
