// Learning from the whole page reads the typesetter's own layers, so the
// batched path must never convert or delete one of them, and must fall back to
// the layer-at-a-time walk rather than lose the page.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const makeHost = ({ duplicateLeavesOriginals = false, convertThrows = false } = {}) => {
  const layers = [
    { id: 11, name: "One", text: "First line", box: true },
    { id: 12, name: "Two", text: "Second line", box: false },
    { id: 13, name: "Three", text: "Third line", box: true },
  ];
  const deleted = [];
  const state = { selection: [11], nextCopyId: 100, selects: 0, batchSelects: 0, duplicates: 0, converts: 0 };
  const find = (id) => layers.find((layer) => layer.id === id);
  const box = vm.createContext({
    app: { activeDocument: { name: "page" } },
    documents: [{}],
    jamJSON: JSON,
    _hostState: { getAllRenderedTextLines: { scanBubbles: false, result: "" } },
    _getActiveLayerId: () => state.selection[0],
    _getCurrentSelectionBounds: () => null,
    _collectTextLayerIds: (doc, ids) => layers.forEach((layer) => ids.push(layer.id)),
    _layerIsTextLayer: () => true,
    _selectLayerById(id) { state.selects++; state.selection = [id]; },
    _selectLayersAtOnce(ids) { state.batchSelects++; state.selection = ids.slice(); },
    _getSelectedLayerIds: () => state.selection.slice(),
    _duplicateActiveLayer() {
      state.duplicates++;
      // Only the page-wide duplicate misbehaves, so the assertion is about the
      // guard and not about how the layer-at-a-time walk copes
      if (duplicateLeavesOriginals && state.selection.length > 1) return;
      const copies = state.selection.map((id) => {
        const source = find(id);
        const copy = { id: state.nextCopyId++, name: source.name + " copy", text: source.text, box: source.box };
        layers.push(copy);
        return copy.id;
      });
      state.selection = copies;
    },
    _changeSelectionToPointText() {
      state.converts++;
      if (convertThrows) throw new Error("locked layer");
      state.selection.forEach((id) => {
        const layer = find(id);
        if (layer && layer.box) layer.text = layer.text + "\rwrapped";
      });
    },
    _changeToPointText() {
      const layer = find(state.selection[0]);
      if (layer && layer.box) layer.text = layer.text + "\rwrapped";
    },
    _textLayerIsPointText: () => !find(state.selection[0]).box,
    _getTextKeyById: (id) => find(id).text,
    jamText: { getLayerText: () => ({ layerText: { textKey: find(state.selection[0]).text } }) },
    _deleteActiveLayer() {
      state.selection.forEach((id) => {
        deleted.push(id);
        const index = layers.findIndex((layer) => layer.id === id);
        if (index !== -1) layers.splice(index, 1);
      });
      state.selection = [];
    },
    _scanActiveLayerBubble: () => null,
  });
  const source = fs.readFileSync(path.join(__dirname, "../app_src/host.js"), "utf8");
  ["_readPageTextsInOneBatch", "_getAllRenderedTextLines"].forEach((name) => {
    const match = source.match(new RegExp(`function ${name}\\([^]*?\\n\\}`));
    assert.ok(match, `${name} must exist`);
    vm.runInContext(match[0], box);
  });
  return { box, layers, deleted, state };
};

const expected = ["First line\rwrapped", "Second line", "Third line\rwrapped"];

// The page is read in one batch, and the typesetter's own layers survive it
const batched = makeHost();
batched.box._getAllRenderedTextLines();
const result = JSON.parse(batched.box._hostState.getAllRenderedTextLines.result);
assert.deepStrictEqual(result.entries.map((entry) => entry.text), expected);
assert.strictEqual(batched.state.duplicates, 1, "One duplicate covers the page");
assert.strictEqual(batched.state.converts, 1, "One conversion covers the page");
assert.deepStrictEqual(batched.deleted, [100, 101, 102], "Only the copies are deleted");
assert.deepStrictEqual(batched.layers.map((layer) => layer.id), [11, 12, 13], "The page keeps every layer");
assert.deepStrictEqual(
  batched.layers.map((layer) => layer.text),
  ["First line", "Second line", "Third line"],
  "The typesetter's own layers are never converted"
);

// A duplicate that leaves the originals selected must be refused outright:
// converting and deleting them would destroy the page
const unclear = makeHost({ duplicateLeavesOriginals: true });
unclear.box._getAllRenderedTextLines();
assert.ok(
  unclear.deleted.every((id) => id >= 100),
  "The guard must refuse before a single one of the typesetter's layers is deleted"
);
assert.deepStrictEqual(unclear.layers.map((layer) => layer.id), [11, 12, 13], "The page survives");
assert.deepStrictEqual(
  JSON.parse(unclear.box._hostState.getAllRenderedTextLines.result).entries.map((entry) => entry.text),
  expected,
  "The walk still reads the page"
);

// A page the batch cannot convert falls back to the walk instead of coming
// back empty
const refused = makeHost({ convertThrows: true });
refused.box._getAllRenderedTextLines();
assert.deepStrictEqual(
  JSON.parse(refused.box._hostState.getAllRenderedTextLines.result).entries.map((entry) => entry.text),
  expected,
  "A refused batch still learns from the page"
);
assert.deepStrictEqual(refused.layers.map((layer) => layer.id), [11, 12, 13], "The page survives a refused batch");

console.log("Page text read tests passed (batch, copy safety and fallback)");
