const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");

assert(
  /hiddenCleaningLayerIdsByDocument:\s*\{\}/.test(hostSource),
  "Cleaning-layer visibility must be stored per Photoshop document"
);
assert(
  /function toggleCleaningLayers\(\)/.test(hostSource),
  "The Photoshop host must expose toggleCleaningLayers"
);

const collectStart = hostSource.indexOf("function _collectVisibleCleaningLayerIds()");
const toggleStart = hostSource.indexOf("function toggleCleaningLayers()", collectStart);
assert(collectStart >= 0 && toggleStart > collectStart, "Missing cleaning-layer collection implementation");
const collectSource = hostSource.slice(collectStart, toggleStart);
[
  'stringIDToTypeID("layerSection")',
  'stringIDToTypeID("layerSectionStart")',
  'stringIDToTypeID("layerSectionEnd")',
  "!layer.hasKey(charID.Text)",
  "!layer.getBoolean(charID.Background)",
  "layer.getBoolean(charID.Visible)",
  "!layer.hasKey(charID.AdjustmentLayer)",
  "layer.getInteger(charID.LayerID)",
].forEach((term) => {
  assert(collectSource.includes(term), `Cleaning-layer filter is missing: ${term}`);
});
assert(
  /var stopIndex = _documentHasBackgroundLayer\(\) \? 0 : 1;/.test(collectSource),
  "The real background or bottom-most fallback layer must be preserved"
);
assert(
  /executeAction\(visible \? charID\.Show : charID\.Hide/.test(hostSource),
  "Cleaning layers must be hidden and shown through batched Action Manager commands"
);
assert(
  /hiddenByDocument\.hasOwnProperty\(documentKey\)/.test(hostSource) &&
    /delete hiddenByDocument\[documentKey\]/.test(hostSource),
  "A second toggle must restore and clear the document-specific layer IDs"
);

console.log("cleaning layer toggle tests passed");
