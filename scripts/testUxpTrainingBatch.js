const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const source = fs.readFileSync(path.join(__dirname, "../uxp-src/host/photoshop.js"), "utf8");
const functions = ["_collectTrainingTextLayers", "_readTextShapeRTrainingLayers"].map(name => {
  const match = source.match(new RegExp("function " + name + "\\([^]*?\\n\\}"));
  assert.ok(match, name);
  return match[0];
}).join("\n");
function scan(batchFails) {
  const calls = [];
  const box = vm.createContext({
    ps: { constants: { LayerKind: { TEXT: "text", GROUP: "group" } } },
    play(descriptor) {
      calls.push(["batch", Array.from(descriptor._target, target => target._id)]);
      if (batchFails) throw Error("locked layer");
    },
    _changeToPointText() { calls.push(["convert"]); },
    _textLayerIsPointText: () => false,
    _selectLayerById(id) { calls.push(["select", id]); },
    get(target) { calls.push(["read", target[1]._id]); return { textKey: { textKey: "layer " + target[1]._id } }; },
  });
  vm.runInContext(functions, box);
  const entries = box._readTextShapeRTrainingLayers({ layers: [
    { id: 3, name: "a", kind: "text", visible: true },
    { name: "folder", kind: "group", visible: false, layers: [{ id: 7, name: "b", kind: "text", visible: true }] },
  ] });
  assert.deepStrictEqual(Array.from(entries, entry => entry.text), ["layer 3", "layer 7"]);
  assert.strictEqual(entries[1].visible, false, "hidden group visibility is preserved");
  return calls;
}
assert.deepStrictEqual(scan(false), [["batch", [3, 7]], ["convert"], ["read", 3], ["read", 7]], "one conversion, no per-layer selection");
assert.deepStrictEqual(scan(true), [["batch", [3, 7]], ["select", 3], ["convert"], ["read", 3], ["select", 7], ["convert"], ["read", 7]], "a refused batch still reads every layer");
console.log("UXP training batch tests passed");
