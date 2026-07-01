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

const { generateTextShapRVariants, visibleLength, visibleWidth } = loadAppModule("app_src/textShapR.js");

const variants = generateTextShapRVariants("This sentence needs a pleasant bubble shaped manga layout today.");
assert.strictEqual(variants.length, 10);
assert.strictEqual(new Set(variants.map((variant) => variant.text)).size, variants.length);
assert.ok(variants[0].lines.length >= 2);

const bestLengths = variants[0].lines.map(visibleLength);
const middleIndex = Math.floor((bestLengths.length - 1) / 2);
const middleLength = bestLengths[middleIndex];
assert.ok(middleLength >= bestLengths[0]);
assert.ok(middleLength >= bestLengths[bestLengths.length - 1]);

const hyphenated = generateTextShapRVariants("extraordinarily shaped lettering can fit better", { limit: 10 });
assert.ok(hyphenated.some((variant) => /-\n/.test(variant.text)));

const noHyphen = generateTextShapRVariants("extraordinarily shaped lettering can fit better", { limit: 10, allowHyphenation: false });
assert.ok(noHyphen.every((variant) => !/-\n/.test(variant.text)));

const markdown = generateTextShapRVariants("A **bold sentence** should keep markdown markers safe", { limit: 10 });
assert.ok(markdown.every((variant) => !/\*\*bo\nld|sent\nence\*\*/.test(variant.text)));
assert.ok(markdown.every((variant) => (variant.text.match(/\*\*/g) || []).length === 2));

const short = generateTextShapRVariants("Bonjour");
assert.deepStrictEqual(short.map((variant) => variant.text), ["Bonjour"]);

const profileText = "A longer sentence can choose different bubble silhouettes for the same lettering.";
const tall = generateTextShapRVariants(profileText, { profile: "tall", limit: 10 });
const wide = generateTextShapRVariants(profileText, { profile: "wide", limit: 10 });
assert.ok(tall[0].lines.length > wide[0].lines.length);
assert.ok(visibleWidth("minimum") < visibleWidth("maximum"));

const punctuated = generateTextShapRVariants("Mais attends, je voulais juste te parler de ce qui est arrive hier soir.", { limit: 10 });
assert.ok(/attends,\n/.test(punctuated[0].text));

console.log("TextShapR tests passed");
