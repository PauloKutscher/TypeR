const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const commandSource = fs.readFileSync(path.join(rootDir, "app_src", "shortcutCommands.js"), "utf8");
const contextSource = fs.readFileSync(path.join(rootDir, "app_src", "context.jsx"), "utf8");
const hotkeySource = fs.readFileSync(path.join(rootDir, "app_src", "hotkeys.jsx"), "utf8");
const previewSource = fs.readFileSync(path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"), "utf8");

const commandBlocks = [...commandSource.matchAll(/\{\s*\n\s+id:\s+"([^"]+)"[\s\S]*?\n\s{2}\},/g)];
const commandIds = commandBlocks.map((match) => match[1]);
const commandBlockById = new Map(commandBlocks.map((match) => [match[1], match[0]]));
const expectedNewCommands = [
  "previousPage",
  "previousStyle",
  "nextStyle",
  "applyStyle",
  "removeLastSelection",
  "clearSelections",
  "toggleTextShapeR",
  "previousTab",
  "nextTab",
];

assert(commandIds.length > 0, "No shortcut commands found");
assert.strictEqual(new Set(commandIds).size, commandIds.length, "Shortcut command IDs must be unique");
expectedNewCommands.forEach((id) => {
  assert(commandIds.includes(id), `Missing shortcut command: ${id}`);
  const block = commandBlockById.get(id);
  assert(
    new RegExp(`label:\\s*"shortcut_${id}"`).test(block) && /defaultKeys:\s*\[\]/.test(block),
    `${id} must have its translated label and remain unassigned by default`
  );
});
assert(contextSource.includes("getDefaultShortcuts()"), "Context must read defaults from the shortcut registry");
assert(!contextSource.includes('add: ["WIN", "CTRL"]'), "Shortcut defaults must not be duplicated in context");
assert(hotkeySource.includes("shortcutCommands.forEach"), "Hotkey matching must use the shortcut registry");
assert(!hotkeySource.includes("bindingOrder"), "Hotkey command order must not be maintained separately");
assert(
  (previewSource.match(/withShortcutHint\(/g) || []).length >= 3,
  "Paste, align, and apply tooltips must use the configured shortcut"
);

const utilityCalls = [];
const transformedCommands = babel.transformSync(commandSource, {
  presets: [["@babel/preset-env", { modules: "commonjs" }]],
}).code;
const commandModule = { exports: {} };
const mockRequire = (request) => {
  if (request === "./utils") {
    return {
      alignTextLayerToSelection: (...args) => utilityCalls.push(["align", ...args]),
      changeActiveLayerTextSize: (...args) => utilityCalls.push(["resize", ...args]),
      createTextLayerInSelection: (...args) => utilityCalls.push(["create", ...args]),
      createTextLayersInStoredSelections: (...args) => utilityCalls.push(["createMany", ...args]),
      deselectDocument: (...args) => utilityCalls.push(["deselect", ...args]),
      setActiveLayerText: (...args) => utilityCalls.push(["setText", ...args]),
    };
  }
  if (request === "./textLayerPayload") {
    return {
      buildStoredSelectionPayload: () => ({ texts: [], styles: [] }),
      getScaledStyle: (style) => style,
    };
  }
  throw new Error(`Unexpected shortcutCommands dependency: ${request}`);
};
new Function("require", "module", "exports", transformedCommands)(
  mockRequire,
  commandModule,
  commandModule.exports
);
const runtimeCommands = commandModule.exports.shortcutCommands;
const getCommand = (id) => runtimeCommands.find((command) => command.id === id);

const dispatches = [];
const baseContext = {
  state: {
    currentStyle: { id: "style-1" },
    currentStyleId: "style-1",
    direction: "rtl",
    inlineTextShapeR: false,
    multiBubbleMode: true,
    storedSelections: [{ id: "selection-1" }, { id: "selection-2" }],
    tabs: [{ id: "tab-1" }, { id: "tab-2" }, { id: "tab-3" }],
    currentTabId: "tab-2",
    multiTabEnabled: true,
  },
  dispatch: (action) => dispatches.push(action),
};

getCommand("applyStyle").handler(baseContext);
assert.deepStrictEqual(utilityCalls.shift(), ["setText", "", baseContext.state.currentStyle, "rtl"]);
getCommand("removeLastSelection").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "removeSelection", index: 1 });
assert.deepStrictEqual(utilityCalls.shift(), ["deselect"]);
getCommand("clearSelections").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "clearSelections" });
assert.deepStrictEqual(utilityCalls.shift(), ["deselect"]);
getCommand("toggleTextShapeR").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "setInlineTextShapeR", value: true });
getCommand("previousTab").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "switchTab", id: "tab-1" });
getCommand("nextTab").handler(baseContext);
assert.deepStrictEqual(dispatches.shift(), { type: "switchTab", id: "tab-3" });
["previousPage", "previousStyle", "nextStyle"].forEach((id) => {
  getCommand(id).handler(baseContext);
});
assert.deepStrictEqual(dispatches, [
  { type: "previousPage" },
  { type: "previousStyle" },
  { type: "nextStyle" },
]);

const localeFiles = [
  path.join(rootDir, "locale", "messages.properties"),
  ...fs.readdirSync(path.join(rootDir, "locale"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(rootDir, "locale", entry.name, "messages.properties")),
];

localeFiles.forEach((file) => {
  const source = fs.readFileSync(file, "utf8");
  expectedNewCommands.forEach((id) => {
    assert(
      new RegExp(`^shortcut_${id}=`, "m").test(source),
      `Missing shortcut_${id} in ${path.relative(rootDir, file)}`
    );
  });
  assert(/^shortcutConflict=.*\{actions\}/m.test(source), `Missing shortcutConflict placeholder in ${path.relative(rootDir, file)}`);
  ["createLayerDescr", "alignLayerDescr", "insertStyledText"].forEach((key) => {
    const line = source.match(new RegExp(`^${key}=(.*)$`, "m"));
    assert(line, `Missing ${key} in ${path.relative(rootDir, file)}`);
    assert(!/\(Win\s*\+/.test(line[1]), `${key} still hard-codes a shortcut in ${path.relative(rootDir, file)}`);
  });
});

console.log("shortcut registry tests passed");
