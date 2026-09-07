const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const filePath = path.resolve(__dirname, "../app_src/markdownConvert.js");
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

const { parseMarkdownRuns, convertDomToMarkdown } = mod.exports;

// --- tiny hand-rolled DOM node builders (no jsdom/DOMParser needed in Node) ---
const tx = (value) => ({ nodeType: 3, nodeValue: value });
const el = (tag, style, children = []) => ({
  nodeType: 1,
  tagName: tag,
  getAttribute: (name) => (name === "style" ? style || null : null),
  childNodes: children,
});

// 1. Plain text passes through unchanged
assert.strictEqual(convertDomToMarkdown([tx("Hello world")]), "Hello world");

// 2. Bold / italic / bold+italic single runs
assert.strictEqual(convertDomToMarkdown([el("b", null, [tx("Hello world")])]), "**Hello world**");
assert.strictEqual(convertDomToMarkdown([el("i", null, [tx("Hello world")])]), "*Hello world*");
assert.strictEqual(
  convertDomToMarkdown([el("b", null, [el("i", null, [tx("Hello world")])])]),
  "***Hello world***"
);

// 3. Partial-sentence bold and italic within one line
assert.strictEqual(
  convertDomToMarkdown([
    el("p", null, [
      tx("This is "),
      el("b", null, [tx("very important")]),
      tx(" and "),
      el("i", null, [tx("very interesting")]),
      tx("."),
    ]),
  ]),
  "This is **very important** and *very interesting*."
);

// 4. Single bold word inside a longer plain sentence
assert.strictEqual(
  convertDomToMarkdown([tx("Say "), el("b", null, [tx("hello")]), tx(" now")]),
  "Say **hello** now"
);

// 5. Multiple style changes with no separating text: adjacent runs must not
// merge markers into an ambiguous run of 3+ of the same character.
const adjacent = convertDomToMarkdown([el("b", null, [tx("Bold")]), el("i", null, [tx("Italic")])]);
assert.strictEqual(adjacent, "**Bold**_Italic_");
assert.deepStrictEqual(
  parseMarkdownRuns(adjacent).runs.map((r) => ({ text: r.text, bold: r.bold, italic: r.italic })),
  [
    { text: "Bold", bold: true, italic: false },
    { text: "Italic", bold: false, italic: true },
  ]
);

// 6. Consecutive normal lines: one line per <p>, no blank lines injected
assert.strictEqual(
  convertDomToMarkdown([el("p", null, [tx("Line one")]), el("p", null, [tx("Line two")])]),
  "Line one\nLine two"
);

// 7. Multiple artificial empty blocks / duplicated <br> collapse to nothing
assert.strictEqual(
  convertDomToMarkdown([
    el("p", null, [tx("Hello")]),
    el("p", null, [tx(" ")]),
    el("br"),
    el("br"),
    el("div", null, []),
    el("p", null, [tx("World")]),
  ]),
  "Hello\nWorld"
);

// 8. Table with empty cells/rows mixed with real ones
assert.strictEqual(
  convertDomToMarkdown([
    el("table", null, [
      el("tr", null, [el("td", null, [el("p", null, [tx("Page 1")])])]),
      el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
      el("tr", null, [el("td", null, [el("p", null, [tx("Final Chapter")])])]),
    ]),
  ]),
  "Page 1\nFinal Chapter"
);

// 9. Real explicit <br>-driven line break between two words is preserved
assert.strictEqual(convertDomToMarkdown([tx("Hello"), el("br"), tx("World")]), "Hello\nWorld");

// 9b. Literal newline embedded directly in a single text node (no <br> at
// all — e.g. a grid app using CSS white-space:pre) must be treated as a
// real break, same as an actual <br>.
assert.strictEqual(convertDomToMarkdown([tx("Hello\nWorld")]), "Hello\nWorld");

// 9c. A "blank separator" made of raw embedded newlines only (no tags, no
// <br>) between two real cells must collapse just like an empty <p>/<td>
// does — this is the real-world case that slipped through: a grid/table
// app embedding "\n\n" directly in text instead of using empty <p> tags.
assert.strictEqual(
  convertDomToMarkdown([
    el("td", null, [tx("Oh, the clock's fixed.")]),
    el("td", null, [tx("\n\n")]),
    el("td", null, [tx("TK TK")]),
  ]),
  "Oh, the clock's fixed.\nTK TK"
);

// 9d. Regression, verbatim shape from the real report: each "row" is one
// text node holding "dialogue\nnumber", separator rows are one text node
// holding just "\n\n" — must collapse to one line per row, no blank lines.
assert.strictEqual(
  convertDomToMarkdown([
    el("td", null, [tx("Pg43\n1")]),
    el("td", null, [tx("\n\n")]),
    el("td", null, [tx("Oh, the clock's fixed.\n1")]),
    el("td", null, [tx("\n\n")]),
    el("td", null, [tx("TK TK\n2")]),
  ]),
  "Pg43\n1\nOh, the clock's fixed.\n1\nTK TK\n2"
);

// 10. Bold/italic + blank-line normalization combined
assert.strictEqual(
  convertDomToMarkdown([
    el("p", null, []),
    el("p", null, [el("b", null, [tx("Important")])]),
    el("p", null, []),
    el("p", null, [el("i", null, [tx("Warning")])]),
    el("p", null, []),
    el("p", null, [tx("Continue")]),
  ]),
  "**Important**\n*Warning*\nContinue"
);

// 11. Regression case verbatim from the request: table with real rows mixed
// with several empty spacer rows/cells must collapse to exactly one line per
// real row, no blank lines.
const regressionInput = [
  el("table", null, [
    el("tr", null, [el("td", null, [el("p", null, [tx("Page 1")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx("Final Chapter")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx("Graduation Ceremony")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx("Tsukiya Noah!")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx(" ")])])]),
    el("tr", null, [el("td", null, [el("p", null, [tx("Here!")])])]),
  ]),
];
assert.strictEqual(
  convertDomToMarkdown(regressionInput),
  "Page 1\nFinal Chapter\nGraduation Ceremony\nTsukiya Noah!\nHere!"
);

// The editor stacks a transparent highlight layer under the glyph layers, so
// both must lay out the exact characters the textarea holds. The overlay keeps
// the markers as hidden spans; the highlight layer must not process markdown at
// all. Drop a single character on either side and every highlight drifts a
// wrapped row away from its line.
[
  "**bold** text",
  "Career path survey___Year ___Class ___Number  Name",
  "a _really_ long *one* here",
  "escaped \\*star\\* and \\_score\\_",
  "no markers at all",
].forEach((raw) => {
  assert.strictEqual(
    parseMarkdownRuns(raw).overlaySegments.map((segment) => segment.text).join(""),
    raw,
    `Overlay segments must keep every character of: ${raw}`
  );
});

const textBlockSource = fs.readFileSync(
  path.resolve(__dirname, "../app_src/components/textBlock/textBlock.jsx"),
  "utf8"
);
// `core.autocrlf` decides how this file lands in the working tree, so the
// matcher has to accept both endings or the check passes or fails by checkout.
const highlightRenderer = textBlockSource.match(
  /const renderHighlightedText = React\.useCallback\(\r?\n[\s\S]*?\r?\n {4}\[ignoreTagsRegex\]/
);
assert.ok(highlightRenderer, "The highlight layer renderer must exist");
assert.ok(
  !/parseMarkdownRuns|renderMarkdownText/.test(highlightRenderer[0]),
  "The highlight layer must render raw characters: stripping markdown markers makes it wrap before the textarea"
);

// Um marcador que nao fecha na propria linha nao formata nada: antes, um "*"
// solto abria formatacao que corria ate a proxima linha que por acaso tivesse
// o mesmo simbolo, e as falas do meio saiam formatadas sem motivo.
const styles = (input) =>
  parseMarkdownRuns(input).runs.map((r) => ({ text: r.text, bold: r.bold, italic: r.italic }));

assert.deepStrictEqual(
  styles("a *b\nc* d"),
  [{ text: "a *b\nc* d", bold: false, italic: false }],
  "A marker that only closes on a later line must not format anything"
);
assert.deepStrictEqual(
  styles("**abre\nfecha** depois"),
  [{ text: "**abre\nfecha** depois", bold: false, italic: false }],
  "The same holds for bold"
);
assert.deepStrictEqual(
  styles("um *so* aqui\noutro *so* la"),
  [
    { text: "um ", bold: false, italic: false },
    { text: "so", bold: false, italic: true },
    { text: " aqui\noutro ", bold: false, italic: false },
    { text: "so", bold: false, italic: true },
    { text: " la", bold: false, italic: false },
  ],
  "Markers that do close on their own line keep working, line after line"
);
assert.deepStrictEqual(
  styles("*aberto e nunca fechado"),
  [{ text: "*aberto e nunca fechado", bold: false, italic: false }],
  "A marker with no closer at all stays literal, as before"
);
assert.deepStrictEqual(
  styles("**negrito** e *solto\nfim"),
  [
    { text: "negrito", bold: true, italic: false },
    { text: " e *solto\nfim", bold: false, italic: false },
  ],
  "A closed marker and an unclosed one on the same line do not interfere"
);
// CRLF conta como quebra: e o que chega do Photoshop e do Windows
assert.deepStrictEqual(
  styles("a *b\rc* d"),
  [{ text: "a *b\rc* d", bold: false, italic: false }],
  "CR must end the line just like LF"
);
// O texto exibido continua mostrando o simbolo que o usuario digitou
assert.strictEqual(
  parseMarkdownRuns("a *b\nc* d").overlaySegments.map((s) => s.text).join(""),
  "a *b\nc* d",
  "The overlay must still show every character the user typed"
);

console.log("markdown convert tests passed");
