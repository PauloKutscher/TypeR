// Pure update helpers shared by the panel (utils.js / updateInstaller.js) and
// the node test suite. No CEP or DOM access here.

const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000;

// Folders owned by the application: these are the only paths an update is
// allowed to write. User data (storage*, app/themes customizations kept in
// storage) is never listed here, so an update can never destroy it.
const INSTALL_FOLDERS = ["app/", "CSXS/", "icons/", "locale/"];

const parseVersion = (version) => {
  const cleanVersion = String(version || "").replace(/^v/, "");
  return cleanVersion.split(".").map((num) => parseInt(num, 10) || 0);
};

const compareVersions = (v1, v2) => {
  const version1 = parseVersion(v1);
  const version2 = parseVersion(v2);
  for (let i = 0; i < Math.max(version1.length, version2.length); i++) {
    const num1 = version1[i] || 0;
    const num2 = version2[i] || 0;
    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }
  return 0;
};

// Only a built release asset is installable. The GitHub "source code" zipball
// has no compiled app/ folder (webpack output), so installing it would leave a
// broken extension — no fallback on purpose.
const pickUpdateDownloadUrl = (release) => {
  const assets = release && Array.isArray(release.assets) ? release.assets : [];
  const zipAsset = assets.find(
    (asset) =>
      asset &&
      typeof asset.name === "string" &&
      asset.name.toLowerCase().endsWith(".zip") &&
      asset.name.toLowerCase().indexOf("typer") !== -1
  );
  return zipAsset && zipAsset.browser_download_url ? zipAsset.browser_download_url : null;
};

const findNewerReleases = (releases, currentVersion) => {
  const list = Array.isArray(releases) ? releases : [];
  const newer = list.filter(
    (release) => release && release.tag_name && compareVersions(release.tag_name, currentVersion) > 0
  );
  newer.sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  return newer;
};

// Release zips may nest everything under a top folder (e.g. "TypeR-3.1.0/").
// The folder containing CSXS/manifest.xml is the package root. Returns "" for
// a flat zip, the "folder/" prefix otherwise, and null when the zip is not a
// TypeR package at all.
const findZipRootPrefix = (paths) => {
  const marker = "CSXS/manifest.xml";
  let best = null;
  for (const entryPath of paths || []) {
    if (typeof entryPath !== "string" || !entryPath.endsWith(marker)) continue;
    const prefix = entryPath.slice(0, entryPath.length - marker.length);
    if (prefix !== "" && !prefix.endsWith("/")) continue;
    if (prefix.indexOf("..") !== -1) continue;
    if (best === null || prefix.length < best.length) best = prefix;
  }
  return best;
};

// Maps a zip entry to its path inside the extension folder, or null when the
// entry must not be installed. Guards against zip-slip on top of the folder
// allow-list.
const mapZipEntryToTargetPath = (entryPath, rootPrefix) => {
  if (typeof entryPath !== "string" || !entryPath || entryPath.endsWith("/")) return null;
  const prefix = rootPrefix || "";
  if (entryPath.slice(0, prefix.length) !== prefix) return null;
  const rel = entryPath.slice(prefix.length);
  if (!rel || rel.indexOf("..") !== -1 || rel.startsWith("/") || rel.indexOf("\\") !== -1) return null;
  // Repo zips ship default themes at the root; they live under app/themes once
  // installed (same mapping as install.ps1)
  if (rel.startsWith("themes/")) return "app/" + rel;
  for (const folder of INSTALL_FOLDERS) {
    if (rel.startsWith(folder)) return rel;
  }
  return null;
};

const shouldRunUpdateCheck = (lastCheckAt, now, interval = UPDATE_CHECK_INTERVAL) => {
  const last = Number(lastCheckAt) || 0;
  if (last <= 0) return true;
  // A stored timestamp in the future means the clock moved back; treat it as
  // stale instead of silencing the check for days
  if (last > now) return true;
  return now - last >= interval;
};

export {
  UPDATE_CHECK_INTERVAL,
  INSTALL_FOLDERS,
  parseVersion,
  compareVersions,
  pickUpdateDownloadUrl,
  findNewerReleases,
  findZipRootPrefix,
  mapZipEntryToTargetPath,
  shouldRunUpdateCheck,
};
