const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const loadModule = (relativePath) => {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const transformed = babel.transformSync(source, {
    presets: [["@babel/preset-env", { modules: "commonjs" }]],
  }).code;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);
  return loaded.exports;
};

const { withWatcherKey } = loadModule("app_src/hotkeyState.js");

// Photoshop 27.9.1: keyboardState.keyName is undefined, the host only names
// the modifiers. The watcher's held key completes the state in host format.
assert.strictEqual(withWatcherKey("a", "F2"), "aF2a");
assert.strictEqual(withWatcherKey("aCTRLaSHIFTa", "X"), "aCTRLaSHIFTaXa");
assert.strictEqual(withWatcherKey("aWINaCTRLa", ""), "aWINaCTRLa");
// An older host that still reports the key keeps its own name
assert.strictEqual(withWatcherKey("aCTRLaENTERa", "X"), "aCTRLaENTERa");
// Not a keyboard state at all: pass through untouched
assert.strictEqual(withWatcherKey("EvalScript error.", "F2"), "EvalScript error.");
assert.strictEqual(withWatcherKey(undefined, "F2"), undefined);

// The Windows watcher must emit the held key and the panel must read it
const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
assert(/WriteLine\('KD\|' \+ \$key\)/.test(utilsSource), "watcher must report the held key as KD|");
assert(/line\.indexOf\("KD\|"\) === 0/.test(utilsSource), "panel must parse KD| lines before the FG fallback");
assert(/withWatcherKey\(state, foregroundWatcher\.key\)/.test(utilsSource), "hotkey poll must splice the watcher key in");

console.log("hotkey watcher key: ok");
