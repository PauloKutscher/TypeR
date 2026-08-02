const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const rootDir = path.resolve(__dirname, "..");
const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), "typer-cache-test-"));
const cacheRoot = path.join(sandboxRoot, "cep_cache");

const writeSizedFile = (filePath, size) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(size, 1));
};

try {
  writeSizedFile(path.join(cacheRoot, "PHXS_27.1.0_typer", "Cache", "data"), 2048);
  writeSizedFile(path.join(cacheRoot, "PHXS_27.1.0_typer", "Code Cache", "js", "data"), 1024);
  writeSizedFile(path.join(cacheRoot, "PHXS_27.1.0_typer", "Local Storage", "textblock"), 4096);
  writeSizedFile(path.join(cacheRoot, "PHXS_27.1.0_other", "Cache", "data"), 512);

  let source = fs.readFileSync(path.join(rootDir, "app_src", "cepCache.js"), "utf8");
  source = source.replace(
    /export \{[^}]+\};/,
    "module.exports = { clearTypeRCache, formatCacheBytes, getTypeRCacheInfo };"
  );
  const moduleRef = { exports: {} };
  const nodeRequire = (name) => {
    if (name === "os") return { tmpdir: () => sandboxRoot };
    return require(name);
  };
  vm.runInNewContext(source, {
    module: moduleRef,
    exports: moduleRef.exports,
    window: { cep_node: { require: nodeRequire } },
  });

  const { clearTypeRCache, formatCacheBytes, getTypeRCacheInfo } = moduleRef.exports;
  const before = getTypeRCacheInfo();
  assert.strictEqual(before.supported, true);
  assert.strictEqual(before.bytes, 3072, "Only allow-listed TypeR cache directories should be counted");
  assert.strictEqual(before.files, 2);
  assert.strictEqual(formatCacheBytes(before.bytes), "3.0 KB");

  const result = clearTypeRCache();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.clearedBytes, 3072);
  assert.strictEqual(result.remainingBytes, 0);
  assert.strictEqual(
    fs.readFileSync(path.join(cacheRoot, "PHXS_27.1.0_typer", "Local Storage", "textblock")).length,
    4096,
    "TextBlock/local storage data must never be deleted"
  );
  assert.strictEqual(
    fs.readFileSync(path.join(cacheRoot, "PHXS_27.1.0_other", "Cache", "data")).length,
    512,
    "Other CEP extensions must never be deleted"
  );
  console.log("CEP cache tests passed");
} finally {
  fs.rmSync(sandboxRoot, { recursive: true, force: true });
}
