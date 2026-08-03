const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const babel = require("@babel/core");

const filePath = path.resolve(__dirname, "../app_src/markdownFormatting.js");
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

const { formatMarkdownSelection } = mod.exports;

assert.deepStrictEqual(formatMarkdownSelection("hello", 0, 5, "bold"), {
  text: "**hello**", selectionStart: 2, selectionEnd: 7,
});
assert.deepStrictEqual(formatMarkdownSelection("**hello**", 2, 7, "italic"), {
  text: "***hello***", selectionStart: 3, selectionEnd: 8,
});
assert.deepStrictEqual(formatMarkdownSelection("***hello***", 3, 8, "bold"), {
  text: "*hello*", selectionStart: 1, selectionEnd: 6,
});
assert.deepStrictEqual(formatMarkdownSelection("_hello_", 1, 6, "italic"), {
  text: "hello", selectionStart: 0, selectionEnd: 5,
});
assert.deepStrictEqual(formatMarkdownSelection("**hello**", 0, 9, "italic"), {
  text: "***hello***", selectionStart: 3, selectionEnd: 8,
});
assert.deepStrictEqual(formatMarkdownSelection("*hello*", 0, 7, "italic"), {
  text: "hello", selectionStart: 0, selectionEnd: 5,
});
assert.deepStrictEqual(formatMarkdownSelection("hello", 2, 2, "bold"), {
  text: "hello", selectionStart: 2, selectionEnd: 2,
});

console.log("markdown formatting tests passed");
