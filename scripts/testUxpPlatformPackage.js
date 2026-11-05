// The way from clients up to 3.0.0 to the Windows package: TypeR-UXP.ccx runs on
// every system and replaces itself on Windows (app_src/uxpPlatformPackage.js).
const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const { strToU8, zipSync } = require("fflate");

const root = path.resolve(__dirname, "..");
const { installPluginFiles, registeredPluginFolder, stalePluginFolders } = require("./helpers/loadAppModule")()("app_src/uxpManualInstall.js");

// keysHelper on a given system, with what it needs from UXP left out
const loadKeysHelper = (platform) => {
  const filename = path.join(root, "uxp-src/host/keysHelper.js");
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const stubs = {
    os: { platform: () => platform },
    uxp: {},
    fs: {},
    "./files": { resolveFolders: () => { throw new Error("A reader was started"); } },
    "./keyboard": { setState() {} },
    "./jsx": {},
  };
  loaded.require = (name) => stubs[name];
  loaded._compile(fs.readFileSync(filename, "utf8"), filename);
  return loaded.exports;
};

async function checkOfflineSwap() {
  const run = async ({ needed = true, fail = false, testUrl = null } = {}) => {
    const calls = [];
    let pending;
    global.window = { typerUXP: {
      flushStorage: async () => { calls.push("flush"); },
      request: async (name) => {
        calls.push(name);
        if (name === "needsPlatformPackage") return needed;
        if (fail) throw new Error("disk unavailable");
        return { ok: true, method: "manual" };
      },
    } };
    const load = require("./helpers/loadAppModule")({
      react: { useEffect: (effect) => { pending = effect(); } },
      "./utils": {
        getUpdateTestConfig: () => testUrl ? { platformPackageUrl: testUrl } : null,
        downloadAndInstallUpdate: async (url, progress, complete, error, options) => {
          assert.strictEqual(url, testUrl, "An offline build must never download its Windows module");
          calls.push(["download", url, options.expectedVersion]);
          complete({ reloading: false });
        },
        locale: { updateAutoInstalled: "Restart {version}", uxpWindowsPackageFailed: "failed" },
        nativeAlert: (message) => { calls.push(["alert", message]); },
      },
    });
    load("app_src/uxpPlatformPackage.js").useUxpPlatformPackage();
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    delete global.window;
    return calls;
  };
  const version = require("../package.json").version;
  assert.deepStrictEqual(await run(), ["needsPlatformPackage", "flush", "installBundledPlatformPackage", ["alert", "Restart " + version]]);
  assert.deepStrictEqual(await run({ needed: false }), ["needsPlatformPackage"], "Windows native and macOS packages keep running");
  assert.deepStrictEqual(await run({ fail: true }), ["needsPlatformPackage", "flush", "installBundledPlatformPackage", ["alert", "failed"]]);
  assert.deepStrictEqual(await run({ testUrl: "http://localhost/package.ccx" }), [["download", "http://localhost/package.ccx", version], ["alert", "Restart " + version]], "Keep the explicit update-test override");
}

async function checkBundledHostPackage() {
  const version = "3.0.3.3";
  const manifest = { id: "com.scanr.typer", name: "TypeR", version, manifestVersion: 5,
    requiredPermissions: {}, host: { app: "PS", minVersion: "26.0.0" } };
  const reader = fs.readFileSync(path.join(root, "uxp-src/native/typer-keys-win.json"), "utf8");
  const pack = (overrides = {}, binary = reader) => zipSync({
    "manifest.json": strToU8(JSON.stringify({ ...manifest, ...overrides })),
    ...(binary ? { "native/typer-keys-win.json": strToU8(binary) } : {}),
  });
  let bundled = pack();
  let registry = JSON.stringify({ plugins: [{ pluginId: "other", path: "other-plugin" }] });
  const written = new Map();
  const plugin = { nativePath: "External/com.scanr.typer_" + version,
    getEntry: async (name) => ({ read: async ({ format }) => {
      if (name === "manifest.json") return JSON.stringify({ ...manifest, manifestVersion: 5 });
      assert.strictEqual(name, "native/UXP-Windows.ccx");
      assert.strictEqual(format, "binary");
      return bundled;
    } }),
  };
  const load = require("./helpers/loadAppModule")({
    os: { platform: () => "win32" },
    uxp: { storage: { localFileSystem: { getPluginFolder: async () => plugin }, formats: { utf8: "utf8", binary: "binary" } } },
    "./jsx": { systemCall: () => { throw new Error("The offline swap must not start Creative Cloud or a shell"); } },
    "./files": {
      getPluginInstallPaths: async () => ({ pluginsFolder: "External", registry: "PS.json" }),
      basename: (name) => name.split("/").pop(), joinPath: (...parts) => parts.join("/"),
      exists: async (name) => name === "PS.json", readText: async () => registry,
      removeTree: async (name) => { assert.notStrictEqual(name, plugin.nativePath, "Preserve the running plugin"); },
      writeBinary: async (name, bytes) => { written.set(name, Buffer.from(bytes)); },
      rename: async () => {}, writeTextAtomic: async (name, text) => { registry = text; },
    },
  });
  const { installBundledPlatformPackage } = load("uxp-src/host/services.js").requests;
  assert.deepStrictEqual(await installBundledPlatformPackage(), { ok: true, method: "manual" });
  assert.strictEqual(registeredPluginFolder(registry), "com.scanr.typer_" + version + ".win");
  assert.strictEqual(JSON.parse(registry).plugins[0].pluginId, "other", "Keep other plugins registered");
  assert(written.get("External/com.scanr.typer_" + version + ".win.installing/native/typer-keys-win.json").equals(Buffer.from(reader)));
  const originalRegistry = registry;
  written.clear();
  for (const [bytes, error] of [
    [pack({ version: "3.0.3.2" }), /version mismatch/],
    [pack({ id: "other" }), /identity/],
    [pack({ requiredPermissions: { enableAddon: true } }), /keyboard addon/],
    [pack({}, false), /keyboard reader/],
    [pack({}, JSON.stringify({ binary: "", sha256: "bad" })), /Invalid Windows keyboard reader/],
    [pack({}, JSON.stringify({ binary: "bm90LWFuLWV4ZQ==", sha256: "a".repeat(64) })), /reader binary/],
    [strToU8("corrupt"), /Invalid update size/],
  ]) {
    bundled = bytes;
    await assert.rejects(installBundledPlatformPackage(), error);
    assert.strictEqual(registry, originalRegistry, "Invalid bundles must not change registration");
    assert.strictEqual(written.size, 0, "Invalid bundles must not write files");
  }
}

async function main() {
  await checkOfflineSwap();
  await checkBundledHostPackage();
  const onWindows = loadKeysHelper("win32");
  assert.strictEqual(await onWindows.start(() => {}), false, "No macOS reader on Windows");
  assert.strictEqual(onWindows.needsPlatformPackage(), true);
  assert.strictEqual(onWindows.needsPlatformPackage(), false, "A panel reload must not install it again");
  assert.strictEqual(loadKeysHelper("darwin").needsPlatformPackage(), false, "macOS keeps this package");

  const { needsPlatformPackage, _internals } = require("../uxp-src/host/keysAddon");
  assert.strictEqual(needsPlatformPackage(), false, "The Windows package must not replace itself");

  // The reader of 3.0.0 keeps its program busy until its owner file changes
  const written = [];
  let busy = 2;
  let present = true;
  const oldFiles = {
    resolveFolders: async () => {},
    getStorageRoot: () => "root",
    joinPath: (...parts) => parts.join("/"),
    exists: async () => present,
    writeText: async (name, text) => written.push([name, text]),
    removeTree: async () => {
      if (busy-- > 0) throw new Error("busy");
      present = false;
    },
  };
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), true);
  assert.deepStrictEqual(written, [["root/keys/state.owner", "update"]]);
  assert.strictEqual(present, false);
  written.length = 0;
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), true, "Nothing left to remove");
  assert.deepStrictEqual(written, []);
  present = true;
  busy = Infinity;
  assert.strictEqual(await _internals.removeOldReader(oldFiles, async () => {}), false, "Still running: next start");

  // By hand, the package of the running version goes next to the running folder
  const pack = zipSync({
    "manifest.json": strToU8(JSON.stringify({ id: "com.scanr.typer", name: "TypeR", version: "3.0.1", host: { app: "PS", minVersion: "26.0.0" } })),
    "win/x64/typer-keys.uxpaddon": strToU8("addon"),
  });
  const install = async (ownFolder) => {
    const removed = [];
    const renamed = [];
    let registry = null;
    await installPluginFiles(pack, {
      ownFolder,
      platform: "win32",
      pluginsFolder: "External",
      join: (...parts) => parts.join("\\"),
      removeTree: async (name) => removed.push(name),
      rename: async (from, to) => renamed.push([from, to]),
      writeFile: async () => {},
      readRegistry: async () => JSON.stringify({ plugins: [{ pluginId: "com.scanr.typer", path: "$localPlugins\\External\\com.scanr.typer_3.0.1" }, { pluginId: "other" }] }),
      writeRegistry: async (text) => { registry = text; },
    });
    return { removed, renamed, registry };
  };
  const same = await install("com.scanr.typer_3.0.1");
  assert(!same.removed.includes("External\\com.scanr.typer_3.0.1"), "The running folder stays");
  assert.deepStrictEqual(same.renamed, [["External\\com.scanr.typer_3.0.1.win.installing", "External\\com.scanr.typer_3.0.1.win"]]);
  assert.strictEqual(registeredPluginFolder(same.registry), "com.scanr.typer_3.0.1.win");
  assert.strictEqual(JSON.parse(same.registry).plugins.length, 2, "Other plugins stay registered");
  assert.deepStrictEqual(stalePluginFolders(["com.scanr.typer_3.0.1", "com.scanr.typer_3.0.1.win"], same.registry, "com.scanr.typer_3.0.1.win"), ["com.scanr.typer_3.0.1"]);
  assert.deepStrictEqual(stalePluginFolders(["com.scanr.typer_3.0.1", "com.scanr.typer_3.0.1.win"], same.registry, "com.scanr.typer_3.0.1"), [], "Nothing removed before the restart");

  const other = await install("com.scanr.typer_3.0.0");
  assert.strictEqual(registeredPluginFolder(other.registry), "com.scanr.typer_3.0.1", "Another version keeps the usual name");

  console.log("UXP platform package: offline swap, bundle validation, single swap, old reader removal and same-version install passed");
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
