const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const createLoader = require('./helpers/loadAppModule');

const root = path.resolve(__dirname, '..');
const params = require('./fixtures/uxpTextLayers.json').layers[0].jam;
const polygon = [[0, 0], [100, 0], [100, 100], [0, 100]];

// Model layer ownership as well as stack order: ordinal front leaves a group.
function createStack(selected, background, existingClean = true) {
  const folder = { id: 10, kind: 'group', typename: 'LayerSet', layers: [], parent: null };
  const outer = { id: 20, kind: 'group', layers: [folder], parent: null };
  if (selected === 'nested folder') folder.parent = outer;
  const child = { id: 11, kind: 'pixel', parent: folder, clipped: true };
  if (selected !== 'empty folder') folder.layers = [{ id: 12, parent: folder }, child];
  const image = { id: 1, kind: 'pixel', parent: null, isBackgroundLayer: background };
  const clean = { id: 2, kind: 'pixel', name: 'TypeR Clean', parent: null };
  const group = folder.parent || folder;
  const layers = selected === 'folder below clean' ? [clean, group, image] : [group, clean, image];
  const doc = { id: 7, layers: layers.filter(layer => existingClean || layer !== clean),
    activeLayers: [selected === 'folder child' ? child : selected === 'root' ? image : folder] };
  let nextId = 30;
  const texts = [];
  const contents = layer => layer.parent ? layer.parent.layers : doc.layers;
  const flatten = layers => layers.flatMap(layer => [layer, ...flatten(layer.layers || [])]);
  const move = (layer, target, parent) => {
    const from = contents(layer);
    from.splice(from.indexOf(layer), 1);
    layer.parent = parent;
    const to = contents(layer);
    to.splice(target ? to.indexOf(target) : 0, 0, layer);
  };
  const execute = command => {
    let active = doc.activeLayers[0];
    if (command._obj === 'make') {
      const text = command._target[0]._ref === 'textLayer';
      const parent = active.kind === 'group' ? active : active.parent;
      const layer = { id: ++nextId, kind: text ? 'text' : 'pixel', name: command.using.name,
        parent, clipped: !!active.clipped,
        move(target, placement) {
          assert.strictEqual(placement, 'placeBefore');
          assert.strictEqual(target.parent, this.parent, 'raise only before a sibling');
          move(this, target, this.parent);
        } };
      const to = contents(layer);
      to.splice(active.kind === 'group' ? 0 : to.indexOf(active), 0, layer);
      doc.activeLayers = [layer];
      if (text) texts.push(layer);
    } else if (command._obj === 'select') {
      doc.activeLayers = [flatten(doc.layers).find(layer => layer.id === command._target[0]._id)];
      assert.ok(doc.activeLayers[0], 'select an existing layer');
    } else if (command._obj === 'get') {
      const property = command._target[0]._property;
      const target = command._target.find(target => target._id !== undefined);
      const stack = flatten(doc.layers);
      if (target) active = stack.find(layer => layer.id === target._id);
      if (property === 'group') return { group: !!active.clipped };
      if (property === 'layerID') return { layerID: active.id };
      if (property === 'itemIndex') return { itemIndex: stack.length - stack.indexOf(active) + Number(background) };
      if (property === 'boundsNoEffects') return { boundsNoEffects: { left: 10, top: 10, right: 30, bottom: 30 } };
      assert.fail('Unexpected property ' + property);
    } else if (command._obj === 'move') {
      assert.strictEqual(command.to._value, 'front', 'no computed layer indexes');
      move(active, null, null);
    } else if (command._obj === 'ungroup') {
      active.clipped = false;
    } else if (command._obj === 'fill') {
      assert.strictEqual(active.name, 'TypeR Clean', 'fill only the cleanup layer');
    } else {
      assert.strictEqual(command._obj, 'set', 'only selection changes remain');
    }
    return {};
  };
  const ps = { app: { activeDocument: doc }, core: {},
    constants: { LayerKind: {}, ElementPlacement: { PLACEBEFORE: 'placeBefore' } },
    action: { batchPlay: commands => commands.map(execute) } };
  const filename = path.join(root, 'uxp-src/host/photoshop.js');
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', fs.readFileSync(filename, 'utf8'))(name => {
    if (name === 'photoshop') return ps;
    if (name === 'uxp') return { storage: { localFileSystem: {} } };
    return require(path.resolve(path.dirname(filename), name));
  }, mod, mod.exports);
  return { doc, folder, texts, ps, port: mod.exports, flatten };
}

for (const background of [false, true]) {
  for (const selected of ['empty folder', 'folder', 'nested folder', 'folder child', 'root']) {
    const sim = createStack(selected, background);
    sim.port._internals._makeTextLayer(params);
    const text = sim.texts[0];
    const parent = selected === 'root' ? null : sim.folder;
    assert.strictEqual(text.parent, parent, selected + ': keep the folder');
    assert.strictEqual((parent ? parent.layers : sim.doc.layers)[0], text, selected + ': raise within its container');
    assert.strictEqual(text.clipped, false, 'release inherited clipping');
  }
}

// CEP shares the same rule, including an already-first layer and nested folders.
const hostSource = fs.readFileSync(path.join(root, 'app_src/host.js'), 'utf8');
const raiseSource = hostSource.slice(hostSource.indexOf('function _raiseNewTextLayer()'), hostSource.indexOf('function _createAndSetLayerText('));
for (const alreadyFirst of [false, true]) {
  const folder = { typename: 'LayerSet', parent: { typename: 'LayerSet' }, layers: [] };
  const first = { id: 1, parent: folder };
  const text = { id: 2, parent: folder, move(target, placement) {
    assert.strictEqual(target, first);
    assert.strictEqual(placement, 'placeBefore');
    folder.layers = [text, first];
  } };
  folder.layers = alreadyFirst ? [text, first] : [first, text];
  const box = vm.createContext({ app: { activeDocument: { activeLayer: text } },
    ElementPlacement: { PLACEBEFORE: 'placeBefore' },
    ActionReference: function () { this.putEnumerated = () => {}; },
    ActionDescriptor: function () { this.putReference = () => {}; },
    charID: { Layer: 'layer', Ordinal: 'ordinal', Target: 'target', Move: 'move' },
    charIDToTypeID: id => id, stringIDToTypeID: id => id, DialogModes: { NO: 0 },
    _getCurrent: () => ({ getBoolean: () => false }),
    executeAction: () => { text.parent = null; },
  });
  vm.runInContext(raiseSource + '\n_raiseNewTextLayer();', box);
  assert.strictEqual(text.parent, folder, 'CEP keeps the containing folder');
  assert.strictEqual(folder.layers[0], text);
}

// The CEP commit also keeps automatic wrapping as paragraph text and uses the
// existing frame sizing/centring helper rather than converting it to point text.
{
  const calls = [];
  const selection = { left: 0, top: 0, width: 100, height: 100, xMid: 50, yMid: 50 };
  const box = vm.createContext({
    _smartMakeText() {}, _raiseNewTextLayer() {}, _applyMiddleEast() {},
    _placeLayerInRect: (...args) => calls.push(args),
    _getActiveLayerId: () => 42,
  });
  vm.runInContext(hostSource.slice(hostSource.indexOf('function _smartPlaceText('), hostSource.indexOf('function _smartPasteCommitRun(')), box);
  assert.strictEqual(box._smartPlaceText({ plan: { selection }, text: { params, pad: 4, autoWrap: true } }, false), 42);
  assert.deepStrictEqual(calls, [[selection, true, 4]]);
}

(async () => {
  for (const background of [false, true]) for (const existingClean of [false, true]) {
    for (const autoWrap of [false, true])
    for (const selected of ['folder', 'nested folder', 'folder child', 'folder below clean', 'root']) {
      const sim = createStack(selected, background, existingClean);
      const placements = [];
      Object.assign(sim.port._internals, {
        modal: async (name, fn) => fn({}), suspendHistory: (context, name, fn) => fn(),
        _applyMiddleEast() {},
        _placeLayerInRect: (...args) => placements.push(args),
      });
      const load = createLoader({ photoshop: sim.ps, './photoshop': sim.port });
      const smart = load('uxp-src/host/smartPaste.js');
      const session = { plan: { autoClean: true, cleanupPolygon: polygon, cleanPolygon: polygon, selection: { left: 0, top: 0, width: 100, height: 100, xMid: 50, yMid: 50 } }, text: { params, pad: 0, autoWrap } };
      const result = await smart._internals.commitSessions({ documentId: sim.doc.id, sessions: [session, session], pointText: !autoWrap });
      assert.strictEqual(placements.length, autoWrap ? 2 : 0, 'only automatic wrapping resizes and centres the paragraph frame');
      placements.forEach(args => assert.deepStrictEqual(args, [session.plan.selection, true, 0]));
      assert.strictEqual(result.layerIds.length, 2, 'every chamber gets its text');
      const stack = sim.flatten(sim.doc.layers);
      const clean = stack.find(layer => layer.name === 'TypeR Clean');
      for (const text of sim.texts) {
        assert.ok(stack.indexOf(text) < stack.indexOf(clean), selected + ': text stays above Auto clean');
        const parent = selected === 'root' || (selected === 'folder below clean' && existingClean) ? null : sim.folder;
        assert.strictEqual(text.parent, parent, selected + ': preserve the folder whenever it is above cleanup');
      }
    }
  }
  console.log('Text layer stack: UXP/CEP folders, root order, clipping, backgrounds and multi-bubble Auto clean regressions passed');
  const sim = createStack('folder', false, false);
  Object.assign(sim.port._internals, { modal: async (name, fn) => fn({}), suspendHistory: (context, name, fn) => fn(), _applyMiddleEast() {} });
  const load = createLoader({ photoshop: sim.ps, './photoshop': sim.port });
  const smart = load('uxp-src/host/smartPaste.js');
  const refs = load('app_src/oneClick/autoFontSize.js');
  const prepared = { documentId: sim.doc.id, pointText: true, autoSizeReference: { key: 'commit-test', ratio: 1.2 },
    sessions: [{ plan: { cleanPolygon: polygon }, text: { params, pad: 0 } }] };
  const make = sim.port._internals._makeTextLayer;
  sim.port._internals._makeTextLayer = () => { throw new Error('failed text creation'); };
  await assert.rejects(smart._internals.commitSessions(prepared), /failed text creation/);
  assert.strictEqual(refs.readAutoSizeReference('commit-test'), null, 'a failed UXP commit never seeds the page size');
  sim.port._internals._makeTextLayer = make;
  await smart._internals.commitSessions(prepared);
  assert.strictEqual(refs.readAutoSizeReference('commit-test'), 1.2, 'a successful UXP commit records the page size');
})().catch(error => { console.error(error); process.exitCode = 1; });
