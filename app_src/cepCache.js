// TypeR runs in Adobe's CEP Chromium runtime. Its disposable browser caches
// live in the OS temp directory, separately from the extension's storage file.
// Keep the allow-list deliberately narrow so clearing cache can never remove
// settings, styles, themes, saved states, or Chromium local storage.
const CACHE_DIRECTORY_NAMES = ["Cache", "Code Cache", "GPUCache", "blob_storage"];
const TYPE_R_PROFILE_PATTERN = /(?:^|_)typer$/i;

const getNode = () => {
  const nodeRequire =
    (window.cep_node && window.cep_node.require) ||
    (typeof window.require === "function" ? window.require : null);
  if (!nodeRequire) return null;
  try {
    return {
      fs: nodeRequire("fs"),
      os: nodeRequire("os"),
      path: nodeRequire("path"),
    };
  } catch (error) {
    return null;
  }
};

const readDirectory = (node, directory) => {
  try {
    return node.fs.readdirSync(directory);
  } catch (error) {
    return [];
  }
};

const getCacheDirectories = (node) => {
  const root = node.path.join(node.os.tmpdir(), "cep_cache");
  const directories = [];
  readDirectory(node, root).forEach((profileName) => {
    if (!TYPE_R_PROFILE_PATTERN.test(profileName)) return;
    const profilePath = node.path.join(root, profileName);
    let profileStat;
    try {
      profileStat = node.fs.statSync(profilePath);
    } catch (error) {
      return;
    }
    if (!profileStat.isDirectory()) return;
    CACHE_DIRECTORY_NAMES.forEach((cacheName) => {
      const cachePath = node.path.join(profilePath, cacheName);
      try {
        if (node.fs.statSync(cachePath).isDirectory()) directories.push(cachePath);
      } catch (error) {
        // Missing cache categories are normal and do not make the scan fail.
      }
    });
  });
  return directories;
};

const getEntrySize = (node, entryPath) => {
  let stat;
  try {
    stat = node.fs.lstatSync(entryPath);
  } catch (error) {
    return { bytes: 0, files: 0 };
  }
  if (!stat.isDirectory()) return { bytes: stat.size || 0, files: 1 };
  return readDirectory(node, entryPath).reduce(
    (total, name) => {
      const size = getEntrySize(node, node.path.join(entryPath, name));
      total.bytes += size.bytes;
      total.files += size.files;
      return total;
    },
    { bytes: 0, files: 0 }
  );
};

const inspectTypeRCache = (node) => {
  const directories = getCacheDirectories(node);
  const totals = directories.reduce(
    (total, directory) => {
      const size = getEntrySize(node, directory);
      total.bytes += size.bytes;
      total.files += size.files;
      return total;
    },
    { bytes: 0, files: 0 }
  );
  return { supported: true, bytes: totals.bytes, files: totals.files, directories };
};

const getTypeRCacheInfo = () => {
  const node = getNode();
  if (!node) return { supported: false, bytes: 0, files: 0, directories: [] };
  return inspectTypeRCache(node);
};

const removeEntry = (node, entryPath, errors) => {
  let stat;
  try {
    stat = node.fs.lstatSync(entryPath);
  } catch (error) {
    return;
  }
  if (stat.isDirectory()) {
    readDirectory(node, entryPath).forEach((name) => {
      removeEntry(node, node.path.join(entryPath, name), errors);
    });
    try {
      node.fs.rmdirSync(entryPath);
    } catch (error) {
      // A running CEP process can keep an empty cache directory open. The
      // important part is deleting its contents, so only report non-empty ones.
      if (readDirectory(node, entryPath).length) errors.push(entryPath);
    }
    return;
  }
  try {
    node.fs.unlinkSync(entryPath);
  } catch (error) {
    errors.push(entryPath);
  }
};

const clearTypeRCache = () => {
  const node = getNode();
  if (!node) {
    return { supported: false, ok: false, clearedBytes: 0, remainingBytes: 0, errors: [] };
  }
  const before = inspectTypeRCache(node);
  const errors = [];
  before.directories.forEach((directory) => removeEntry(node, directory, errors));
  const after = inspectTypeRCache(node);
  return {
    supported: true,
    ok: after.bytes === 0,
    clearedBytes: Math.max(0, before.bytes - after.bytes),
    remainingBytes: after.bytes,
    errors,
  };
};

const formatCacheBytes = (bytes) => {
  const value = Math.max(0, Number(bytes) || 0);
  const units = ["B", "KB", "MB", "GB"];
  let unitIndex = 0;
  let amount = value;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const decimals = unitIndex > 0 && amount < 10 ? 1 : 0;
  return `${amount.toFixed(decimals)} ${units[unitIndex]}`;
};

export { clearTypeRCache, formatCacheBytes, getTypeRCacheInfo };
