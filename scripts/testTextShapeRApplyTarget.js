// The panel builds its shape variants from a snapshot of one text layer. If
// Photoshop moved on to another layer before the click lands, applying that
// text would overwrite a balloon the typesetter never looked at.
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const written = [];
const doc = { suspendHistory(name, script) { vm.runInContext(script, box); } };
const box = vm.createContext({ app: { activeDocument: doc, documents: [doc] }, documents: [doc], jamJSON: JSON });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../app_src/host.js'), 'utf8'), box);

let activeLayerId = 10;
Object.assign(box, {
  _getActiveLayerId: () => activeLayerId,
  _setTextShapeRText() {
    written.push(box._hostState.setTextShapeRText.data.text);
    box._hostState.setTextShapeRText.result = '';
  },
});

const payload = (layerId) => ({
  text: 'shaped text',
  layerId,
  style: { textProps: { layerText: { textStyleRange: [{ textStyle: { size: 12 } }] } } },
});

assert.strictEqual(box.setTextShapeRLayerText(payload(10)), '');
assert.deepStrictEqual(written, ['shaped text']);

activeLayerId = 11;
assert.strictEqual(box.setTextShapeRLayerText(payload(10)), 'staleLayer');
assert.deepStrictEqual(written, ['shaped text'], 'A stale snapshot must not write to the selected layer');

// Callers without a snapshot ID (legacy paths) keep working on the active layer
assert.strictEqual(box.setTextShapeRLayerText(payload(null)), '');
assert.deepStrictEqual(written, ['shaped text', 'shaped text']);

console.log('TextShapeR apply target tests passed');
