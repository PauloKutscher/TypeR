/*
 * Every identifier the panel reads must be declared, imported, or a real global.
 *
 * This exists because a merge dropped one parameter: `setActiveLayerText` kept a
 * body reading `options.preserveActiveTextSize` while its signature lost
 * `options`. Nothing failed at build time — webpack does not resolve globals —
 * and every suite stayed green, but applying a style from the panel threw on the
 * first line that touched it and the typesetter's font never changed.
 *
 * Scope analysis catches that whole class in a second, so it runs on every panel
 * module rather than on the file that happened to break.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const parser = require("@babel/parser");
const traverse = require("@babel/traverse").default;

const root = path.resolve(__dirname, "..");
const sourceDir = path.join(root, "app_src");

// Browser, CEP and build-time names the panel legitimately reads without
// declaring. ExtendScript (app_src/host.js) is not a module and is checked by
// its own suites, so it stays out.
const KNOWN_GLOBALS = new Set([
  "window", "document", "console", "navigator", "location", "localStorage", "sessionStorage",
  "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "queueMicrotask", "fetch", "alert", "confirm", "prompt", "getComputedStyle",
  "matchMedia", "performance", "requestIdleCallback", "structuredClone",
  "JSON", "Math", "Object", "Array", "String", "Number", "Boolean", "Date", "RegExp", "Function",
  "Error", "TypeError", "RangeError", "SyntaxError", "Promise", "Map", "Set", "WeakMap", "WeakSet",
  "Symbol", "Proxy", "Reflect", "Intl", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
  "Infinity", "NaN", "undefined", "isNaN", "isFinite", "parseInt", "parseFloat",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "escape", "unescape", "atob", "btoa",
  "ArrayBuffer", "SharedArrayBuffer", "Atomics", "DataView", "Uint8Array", "Uint16Array", "Uint32Array",
  "Int8Array", "Int16Array", "Int32Array", "Float32Array", "Float64Array", "Buffer",
  "DOMParser", "XMLHttpRequest", "MouseEvent", "KeyboardEvent", "CustomEvent", "Event", "Blob", "File",
  "FileReader", "FormData", "Image", "ResizeObserver", "MutationObserver", "IntersectionObserver",
  "AbortController", "CSInterface", "SystemPath", "CSEvent", "ThemeManager",
  "require", "module", "exports", "process", "globalThis", "__dirname", "__filename", "arguments",
]);

const collectFiles = (directory, found = []) => {
  fs.readdirSync(directory).forEach((name) => {
    const absolute = path.join(directory, name);
    if (fs.statSync(absolute).isDirectory()) {
      if (name === "lib") return; // vendored third-party scripts, not our modules
      collectFiles(absolute, found);
      return;
    }
    if (!/\.jsx?$/.test(name)) return;
    if (absolute === path.join(sourceDir, "host.js")) return; // ExtendScript, not a module
    found.push(absolute);
  });
  return found;
};

const offenders = [];
collectFiles(sourceDir).forEach((filename) => {
  const source = fs.readFileSync(filename, "utf8");
  const { code } = babel.transformSync(source, {
    filename,
    babelrc: false,
    configFile: false,
    presets: ["@babel/preset-react"],
    plugins: ["@babel/plugin-transform-modules-commonjs"],
  });
  const ast = parser.parse(code, { sourceType: "script", allowReturnOutsideFunction: true });
  const seen = new Set();
  traverse(ast, {
    ReferencedIdentifier(nodePath) {
      const name = nodePath.node.name;
      if (KNOWN_GLOBALS.has(name) || seen.has(name)) return;
      if (nodePath.scope.hasBinding(name, true)) return;
      seen.add(name);
      offenders.push(path.relative(root, filename).replace(/\\/g, "/") + ": " + name);
    },
  });
});

assert.deepStrictEqual(
  offenders,
  [],
  "These identifiers are read but never declared, imported or global:\n  " + offenders.join("\n  ")
);

console.log("no undeclared identifiers in the panel sources");
