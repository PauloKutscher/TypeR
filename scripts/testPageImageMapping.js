const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(rootDir, "app_src", "pageImageMapping.js"), "utf8");
const transformed = babel.transformSync(source, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const mappingModule = { exports: {} };
new Function("require", "module", "exports", transformed)(
  require,
  mappingModule,
  mappingModule.exports
);

const {
  createPageImageLookup,
  getImageForPage,
  getImagePageNumber,
} = mappingModule.exports;

assert.strictEqual(getImagePageNumber({ name: "chap016_023.psd" }), 23);
assert.strictEqual(getImagePageNumber({ name: "page-24-final.psd" }), 24);
assert.strictEqual(getImagePageNumber({ name: "cover.psd" }), null);

const pagesWithGap = Array.from({ length: 20 }, (_, index) => ({
  name: `chap016_${String(index + 1).padStart(3, "0")}.psd`,
  path: `C:\\chapter\\page-${index + 1}.psd`,
})).concat([
  { name: "chap016_023.psd", path: "C:\\chapter\\page-23.psd" },
  { name: "chap016_024.psd", path: "C:\\chapter\\page-24.psd" },
]);
const gapLookup = createPageImageLookup(pagesWithGap);
assert.strictEqual(getImageForPage(pagesWithGap, 23, gapLookup).name, "chap016_023.psd");
assert.strictEqual(getImageForPage(pagesWithGap, 24, gapLookup).name, "chap016_024.psd");

const unnamedPages = [
  { name: "cover.psd" },
  { name: "credits.psd" },
];
const unnamedLookup = createPageImageLookup(unnamedPages);
assert.strictEqual(
  getImageForPage(unnamedPages, 2, unnamedLookup),
  unnamedPages[1],
  "Names without numbers must preserve positional matching"
);

const duplicatePages = [
  { name: "page-001.psd" },
  { name: "page-001-final.psd" },
];
const duplicateLookup = createPageImageLookup(duplicatePages);
assert.strictEqual(
  getImageForPage(duplicatePages, 1, duplicateLookup),
  duplicatePages[0],
  "Duplicate page numbers must preserve positional matching"
);

console.log("page image mapping tests passed");
