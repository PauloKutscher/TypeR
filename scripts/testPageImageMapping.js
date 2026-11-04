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

// Script page 33 is the 33rd selected file, even when that file is numbered 36.
const offsetPages = Array.from({ length: 36 }, (_, index) => ({ name: `kouchauji_02_${String(index + 4).padStart(3, "0")}.psd` }));
const byName = createPageImageLookup(offsetPages);
const byOrder = createPageImageLookup(offsetPages, "order");
assert.strictEqual(getImageForPage(offsetPages, 33, byName).name, "kouchauji_02_033.psd");
assert.strictEqual(getImageForPage(offsetPages, 33, byOrder).name, "kouchauji_02_036.psd");
assert.strictEqual(getImageForPage(pagesWithGap, 21, createPageImageLookup(pagesWithGap, "order")).name, "chap016_023.psd");
assert.strictEqual(getImageForPage(offsetPages, 37, byOrder), null);
assert.strictEqual(getImageForPage(offsetPages, 0, byOrder), null);
assert.strictEqual(getImageForPage([], 1, createPageImageLookup([], "order")), null);
assert.strictEqual(getImageForPage(duplicatePages, 2, createPageImageLookup(duplicatePages, "order")), duplicatePages[1]);

const loadContext = require("./helpers/loadContext");
assert.strictEqual(loadContext().initial.pageImageMatchMode, "filename");
assert.strictEqual(loadContext({ pageImageMatchMode: "order" }).initial.pageImageMatchMode, "order");
assert.strictEqual(loadContext({ pageImageMatchMode: "invalid" }).initial.pageImageMatchMode, "filename");
const { reducer, initial, writes } = loadContext();
let state = reducer(initial, { type: "setPageImageMatchMode", value: "order" });
assert.strictEqual(state.pageImageMatchMode, "order");
assert.strictEqual(writes[writes.length - 1][0].pageImageMatchMode, "order");
state = reducer(state, { type: "import", data: {} });
assert.strictEqual(state.pageImageMatchMode, "order", "older imports preserve the chosen mode");
assert.strictEqual(reducer(state, { type: "import", data: { pageImageMatchMode: "filename" } }).pageImageMatchMode, "filename");
assert.strictEqual(reducer(state, { type: "setPageImageMatchMode", value: "invalid" }).pageImageMatchMode, "filename");
console.log("page matching mode persistence and offset regressions passed");
