const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const appDir = path.join(rootDir, "app");

const files = fs.existsSync(appDir) ? fs.readdirSync(appDir) : [];
const fileSet = new Set(files);

[
  "index.html",
  "index.js",
  "index.css",
  "host.jsx",
  "modal-edit-folder.index.js",
  "modal-edit-style.index.js",
  "modal-export.index.js",
  "modal-help.index.js",
  "modal-settings.index.js",
  "modal-update.index.js",
].forEach((file) => {
  assert(fileSet.has(file), `Missing build artifact: app/${file}`);
});

const topcoatCss = files.filter((file) => /^[a-f0-9]{32}\.css$/.test(file));
assert(topcoatCss.length >= 2, "Missing copied Topcoat theme CSS files");

console.log("build artifact tests passed");
