const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
process.env.BROWSERSLIST_IGNORE_OLD_DATA = "1";
const babel = require("@babel/core");

const rootDir = path.resolve(__dirname, "..");

const loadModule = (relativePath) => {
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
  require.cache[filePath] = mod;
  mod._compile(code, filePath);
  return mod.exports;
};

loadModule("app_src/fontPreview.js");
const { selectFontPreviewCandidates, wrapCanvasText } = loadModule("app_src/fontContactSheet.js");
const { getProfileWidthAt, sampleBubbleShapeProfile, stripMarkdown } = loadModule("app_src/textShapeContactSheet.js");

const fonts = [
  { family: "Comic Talk", style: "Regular", name: "Comic Talk", postScriptName: "ComicTalk-Regular" },
  { family: "Comic Talk", style: "Bold", name: "Comic Talk Bold", postScriptName: "ComicTalk-Bold" },
  { family: "Quiet Serif", style: "Italic", name: "Quiet Serif Italic", postScriptName: "QuietSerif-Italic" },
];

assert.deepStrictEqual(
  selectFontPreviewCandidates(fonts, { fontPostScriptNames: ["QuietSerif-Italic", "ComicTalk-Bold"] })
    .map((font) => font.postScriptName),
  ["QuietSerif-Italic", "ComicTalk-Bold"],
  "explicit shortlist order must be preserved"
);
assert.deepStrictEqual(
  selectFontPreviewCandidates(fonts, { query: "comic", limit: 1 }).map((font) => font.postScriptName),
  ["ComicTalk-Regular"],
  "query and limit must narrow the preview sheet"
);
assert.deepStrictEqual(
  selectFontPreviewCandidates(fonts, { fontPostScriptNames: ["Missing", "ComicTalk-Bold"] })
    .map((font) => font.postScriptName),
  ["ComicTalk-Bold"],
  "unknown PostScript names must be ignored without duplicating fallbacks"
);

const fakeContext = { measureText: (value) => ({ width: value.length * 10 }) };
assert.deepStrictEqual(
  wrapCanvasText(fakeContext, "Une réplique assez longue", 100, 2),
  ["Une", "réplique"],
  "canvas wrapping must respect width and line cap"
);

const imageWidth = 60;
const imageHeight = 44;
const pixels = new Uint8ClampedArray(imageWidth * imageHeight * 4);
for (let y = 0; y < imageHeight; y++) {
  for (let x = 0; x < imageWidth; x++) {
    const nx = (x - imageWidth / 2) / (imageWidth * 0.44);
    const ny = (y - imageHeight / 2) / (imageHeight * 0.44);
    const light = nx * nx + ny * ny <= 1;
    const offset = (y * imageWidth + x) * 4;
    pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = light ? 255 : 20;
    pixels[offset + 3] = 255;
  }
}
const bubbleProfile = sampleBubbleShapeProfile(
  { data: pixels, width: imageWidth, height: imageHeight },
  { left: 0, top: 0, right: imageWidth, bottom: imageHeight },
  11
);
assert.ok(bubbleProfile && bubbleProfile.rows.length === 11, "bubble outline sampler must return normalized rows");
assert.ok(
  getProfileWidthAt(bubbleProfile, 0.5) > getProfileWidthAt(bubbleProfile, 0.12),
  "sampled ellipse must be wider in the middle than near its edge"
);
assert.strictEqual(stripMarkdown("Je **crie** et *cours*."), "Je crie et cours.");

console.log("MCP font preview tests passed");
