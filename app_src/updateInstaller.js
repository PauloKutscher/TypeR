import { unzip } from "fflate";

import { findZipRootPrefix, mapZipEntryToTargetPath } from "./updateLogic";

// Files loaded by Photoshop/CEF at panel startup. They are written last so a
// mid-install failure leaves the old entry points on disk, still referencing
// files that were not touched yet — the panel keeps working and the script
// fallback can repair everything.
const ENTRY_POINT_ORDER = ["app/index.js", "app/host.jsx", "app/index.html", "CSXS/manifest.xml"];

const writeRank = (rel) => {
  const index = ENTRY_POINT_ORDER.indexOf(rel);
  return index === -1 ? 0 : index + 1;
};

const uint8ToBase64 = (bytes) => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return window.btoa(binary);
};

// cep.fs.makedir is not guaranteed to create intermediate folders
const ensureDir = (fsApi, dirPath, made) => {
  if (!dirPath || made[dirPath] || dirPath.indexOf("/") === -1) return;
  const parent = dirPath.slice(0, dirPath.lastIndexOf("/"));
  ensureDir(fsApi, parent, made);
  fsApi.makedir(dirPath);
  made[dirPath] = true;
};

const unzipAsync = (zipBytes) =>
  new Promise((resolve, reject) => {
    try {
      unzip(zipBytes, (err, entries) => (err ? reject(err) : resolve(entries)));
    } catch (e) {
      reject(e);
    }
  });

// Installs the update directly into the running extension folder. CEF loads
// the panel into memory and does not lock the files on disk, so overwriting
// them while Photoshop runs is safe — the new version takes over at the next
// Photoshop restart. Throws when the package is invalid or the folder is not
// writable; the caller then falls back to the external script flow.
const installUpdateInPlace = async (zipBytes, targetRoot, onProgress) => {
  const fsApi = window.cep && window.cep.fs;
  if (!fsApi || !targetRoot) throw new Error("CEP filesystem unavailable");

  const entries = await unzipAsync(zipBytes);
  const rootPrefix = findZipRootPrefix(Object.keys(entries));
  if (rootPrefix === null) {
    throw new Error("Invalid update package: CSXS/manifest.xml not found");
  }

  const files = [];
  for (const entryPath of Object.keys(entries)) {
    const rel = mapZipEntryToTargetPath(entryPath, rootPrefix);
    if (rel) files.push({ rel, data: entries[entryPath] });
  }
  const hasFile = (rel) => files.some((file) => file.rel === rel);
  if (!hasFile("app/index.html") || !hasFile("app/host.jsx") || !hasFile("CSXS/manifest.xml")) {
    throw new Error("Update package is incomplete");
  }

  files.sort((a, b) => writeRank(a.rel) - writeRank(b.rel));

  // Probe before touching anything: a locked or read-only install (e.g. a
  // machine-wide extension folder) must fail here, not halfway through
  const probePath = targetRoot + "/.typer_update_probe";
  const probe = fsApi.writeFile(probePath, "ok");
  if (probe.err) {
    throw new Error("Extension folder is not writable (code " + probe.err + ")");
  }
  fsApi.deleteFile(probePath);

  const made = {};
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const target = targetRoot + "/" + file.rel;
    ensureDir(fsApi, target.slice(0, target.lastIndexOf("/")), made);
    const result = fsApi.writeFile(target, uint8ToBase64(file.data), window.cep.encoding.Base64);
    if (result.err) {
      throw new Error("Failed to write " + file.rel + " (code " + result.err + ")");
    }
    if (onProgress && i % 20 === 0) onProgress(i + 1, files.length);
  }
  return files.length;
};

export { installUpdateInPlace, uint8ToBase64 };
