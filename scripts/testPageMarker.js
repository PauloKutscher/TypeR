const assert = require("assert");
const path = require("path");
const { loadAppModule } = require("./loadAppModule");

const { matchPageMarker, isPageMarker } = loadAppModule(
  path.resolve(__dirname, "../app_src/pageMarker.js")
);

// 1. Every reasonable spelling of a page marker is recognised, with the number.
const recognised = {
  "Page 1": 1,
  "Page 43": 43,
  "Pg43": 43,
  "Pg 43": 43,
  "PG43": 43,
  "PG 43": 43,
  "page43": 43,
  "page 43": 43,
  "PAGE  43": 43,
  "Page-43": 43,
  "Pg.43": 43,
  "Pg. 43": 43,
  "Pages 43": 43,
  "pgs 43": 43,
  "Page #43": 43,
  "Page: 43": 43,
  "  Page 43  ": 43,
  "Page 43 - Final Chapter": 43,
  "Page 007": 7,
  // Portuguese scripts
  "Pag 11": 11,
  "Pag11": 11,
  "PAG 11": 11,
  "Pág 11": 11,
  "Pág. 11": 11,
  "PÁG11": 11,
  "Pags 11": 11,
  "Págs. 11": 11,
  "Pagina 11": 11,
  "Página 11": 11,
  "página11": 11,
  "Páginas 11": 11,
};
Object.entries(recognised).forEach(([text, page]) => {
  assert.strictEqual(matchPageMarker(text), page, `expected "${text}" to be page ${page}`);
  assert.strictEqual(isPageMarker(text), true, `expected "${text}" to be a page marker`);
});

// 2. A number alone never means a page, and neither does another word + number.
const rejected = [
  "43",
  "1",
  "2026",
  "Chapter 43",
  "Version 43",
  "Panel 43",
  "Page",
  "Pg",
  "Pageant 43",
  "Pagando 43",
  "Pagar 43",
  "See Page 43",
  "Here!",
  "",
  "   ",
];
rejected.forEach((text) => {
  assert.strictEqual(matchPageMarker(text), null, `expected "${text}" NOT to be a page marker`);
  assert.strictEqual(isPageMarker(text), false, `expected "${text}" NOT to be a page marker`);
});

// 3. Non-string input is tolerated.
[null, undefined, 43, {}].forEach((value) => {
  assert.strictEqual(matchPageMarker(value), null);
});

// 4. No /g flag: repeated calls on the same string must stay stable.
assert.strictEqual(matchPageMarker("Pg43"), 43);
assert.strictEqual(matchPageMarker("Pg43"), 43);

console.log("testPageMarker: all assertions passed");
