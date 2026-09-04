const assert = require("assert");
const babel = require("@babel/core");
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");

const loadModule = (relativePath) => {
  const source = fs.readFileSync(path.join(rootDir, relativePath), "utf8");
  const transformed = babel.transformSync(source, {
    presets: [["@babel/preset-env", { modules: "commonjs" }]],
  }).code;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", transformed)(require, loaded, loaded.exports);
  return loaded.exports;
};

const { PS_EVENT_MOVE, isPhotoshopMoveEvent, isPhotoshopSelectionOnlyEvent } = loadModule("app_src/photoshopEvents.js");
const { getBubbleCacheKey, haveSameLayerSize, findEnclosingBubbleShape, profileContainsPoint } = loadModule("app_src/textShapeRTracking.js");

assert.strictEqual(PS_EVENT_MOVE, 1836021349);
assert.strictEqual(isPhotoshopMoveEvent({ data: `{"eventID":${PS_EVENT_MOVE}}` }), true);
assert.strictEqual(isPhotoshopMoveEvent({ data: '{"eventID":1936028772}' }), false);
assert.strictEqual(isPhotoshopMoveEvent({}), false);

// Payloads captured from a running Photoshop 27.9 / CEP 12 panel. A marquee
// cannot change any layer, so it must not trigger the ~95 ms layer text read.
const marqueeEvent = { data: 'ver1,{ "eventID": 1936028772, "eventData": {"_obj":"set","antiAlias":true,"null":{"_property":"selection","_ref":"channel"},"to":{"_obj":"polygon","points":[]}}}' };
const tempChannelEvent = { data: 'ver1,{ "eventID": 1936028772, "eventData": {"null":{"_enum":"ordinal","_ref":"channel","_value":"targetEnum"},"to":{"_obj":"channel","name":"__TyperSelectionTemp__"}}}' };
const deselectEvent = { data: 'ver1,{ "eventID": 1936028772, "eventData": {"null":{"_property":"selection","_ref":"channel"},"to":{"_enum":"ordinal","_value":"none"}}}' };
const textEditEvent = { data: 'ver1,{ "eventID": 1936028772, "eventData": {"null":{"_enum":"ordinal","_ref":"textLayer","_value":"targetEnum"},"to":{"_obj":"textLayer","antiAlias":{"_enum":"antiAliasType","_value":"antiAliasSmooth"}}}}' };
const layerSelectEvent = { data: 'ver1,{ "eventID": 1936483188, "eventData": {"_obj":"select","layerID":[25],"null":{"_ref":[{"_id":25,"_ref":"layer"}]}}}' };

assert.strictEqual(isPhotoshopSelectionOnlyEvent(marqueeEvent), true);
assert.strictEqual(isPhotoshopSelectionOnlyEvent(tempChannelEvent), true);
assert.strictEqual(isPhotoshopSelectionOnlyEvent(deselectEvent), true);
assert.strictEqual(isPhotoshopSelectionOnlyEvent(textEditEvent), false, "a text edit must still refresh the layer");
assert.strictEqual(isPhotoshopSelectionOnlyEvent(layerSelectEvent), false, "a layer switch must still refresh the layer");
// Unreadable payloads fail closed: the heavy path is the safe one
assert.strictEqual(isPhotoshopSelectionOnlyEvent({}), false);
assert.strictEqual(isPhotoshopSelectionOnlyEvent({ data: "" }), false);

const original = { left: 100, top: 200, width: 80, height: 40 };
const translated = { left: 112, top: 197, width: 80, height: 40 };
const resized = { left: 112, top: 197, width: 81, height: 40 };

assert.strictEqual(
  getBubbleCacheKey(42, original, "fallback"),
  getBubbleCacheKey(42, translated, "fallback"),
  "Translating a text layer must keep its cached bubble"
);
assert.notStrictEqual(
  getBubbleCacheKey(42, original, "fallback"),
  getBubbleCacheKey(42, resized, "fallback"),
  "Resizing a text layer must invalidate its cached bubble"
);
assert.strictEqual(haveSameLayerSize(original, translated), true);
assert.strictEqual(haveSameLayerSize(original, resized), false);

const utilsSource = fs.readFileSync(path.join(rootDir, "app_src", "utils.js"), "utf8");
const previewSource = fs.readFileSync(
  path.join(rootDir, "app_src", "components", "previewBlock", "previewBlock.jsx"),
  "utf8"
);
const hostSource = fs.readFileSync(path.join(rootDir, "app_src", "host.js"), "utf8");

assert.ok(
  /registerEvent\.data = `\$\{PS_EVENT_SELECT\}, \$\{PS_EVENT_SET\}, \$\{PS_EVENT_MOVE\}`/.test(utilsSource),
  "The CEP bridge must subscribe to Photoshop move events"
);
assert.ok(
  /if \(isPhotoshopMoveEvent\(event\)\)[\s\S]*?refreshInlineLayerGeometry\(\);[\s\S]*?return;/.test(previewSource),
  "Move events must take the geometry-only refresh path"
);
assert.ok(
  /const contentEventVersion = inlineContentEventVersion\.current;[\s\S]*?contentEventVersion !== inlineContentEventVersion\.current/.test(previewSource),
  "A concurrent text/style event must invalidate an in-flight move acknowledgement"
);
assert.ok(
  /inlineContentEventVersion\.current \+= 1;[\s\S]*?inlineMoveDebounce\.current = null;[\s\S]*?inlineEventDebounce\.current = setTimeout/.test(previewSource),
  "Content refreshes must cancel queued move acknowledgements"
);
assert.ok(
  /function getActiveTextLayerGeometry\(\) \{[\s\S]*?_getCurrentTextLayerBounds\(\)[\s\S]*?signature:/.test(hostSource),
  "The host must expose a lightweight geometry acknowledgement"
);
const geometryStart = hostSource.indexOf("function getActiveTextLayerGeometry()");
const geometryEnd = hostSource.indexOf("// Shared lightweight snapshot", geometryStart);
assert.ok(geometryStart >= 0 && geometryEnd > geometryStart, "Geometry acknowledgement function must exist");
const geometrySource = hostSource.slice(geometryStart, geometryEnd);
assert.ok(!geometrySource.includes("getActiveLayerText("));
assert.ok(!geometrySource.includes("getActiveLayerBubbleShape("));
assert.ok(!geometrySource.includes("jamText.getLayerText("));

assert.ok(
  /if \(isPhotoshopSelectionOnlyEvent\(event\)\) \{[\s\S]*?\} else \{[\s\S]*?inlineEventNeedsSource\.current = true;/.test(previewSource),
  "Marquee events must skip the layer source refresh"
);
assert.ok(
  /if \(needsSource\) refreshInlineLayerSource\(\);[\s\S]{0,40}refreshInlineSelectionShape\(\);/.test(previewSource),
  "A marquee must still re-detect the shape"
);
assert.ok(
  /const requestPanelSnapshot = \(signature, callback, needsLayer = true\)/.test(previewSource),
  "Snapshot callers must be able to skip the layer read"
);
assert.strictEqual(
  (previewSource.match(/\}, false\);/g) || []).length,
  2,
  "The bubble shape and batch tracking must both request a layer-free snapshot"
);
assert.ok(
  /if \(!data \|\| data\.layer !== false\) \{[\s\S]*?getActiveLayerTextIfChanged/.test(hostSource),
  "The host must honour a layer-free snapshot request"
);

// Balão duplo: os três textos abaixo saem da página de referência 13.psd, onde
// as camadas 25, 23 e 21 dividem o balão em 93,1043 930x542 e as camadas 17 e
// 15 dividem o de 135,288 501x756.
const bubbleShape = (bounds, rows, textSize = 17) => ({ source: "bubble", textSize, profile: { bounds, rows } });
const wideBubble = bubbleShape(
  { left: 93, top: 1043, right: 1023, bottom: 1585, width: 930, height: 542 },
  [
    { y: 0, left: 0.05, right: 0.95 },
    { y: 0.5, left: 0, right: 1 },
    { y: 1, left: 0.05, right: 0.95 },
  ]
);
const otherBubble = bubbleShape(
  { left: 135, top: 288, right: 636, bottom: 1044, width: 501, height: 756 },
  [
    { y: 0, left: 0, right: 1 },
    { y: 1, left: 0, right: 1 },
  ]
);

const cache = new Map([["bubble:25", wideBubble], ["bubble:17", otherBubble]]);

// camada 23, dentro do balão largo
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 370, top: 1231, right: 540, bottom: 1411, width: 170, height: 180 }, 17),
  wideBubble,
  "A second layer inside a traced bubble must reuse it"
);
// A camada 23 da mesma página tem corpo 16 e o contorno saiu até 0,15 mais
// estreito: outro corpo, outro fechamento de buracos, outro contorno
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 370, top: 1231, right: 540, bottom: 1411, width: 170, height: 180 }, 16),
  null,
  "A different body size must not borrow another layer's outline"
);
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 370, top: 1231, right: 540, bottom: 1411, width: 170, height: 180 }, null),
  null,
  "Without a known body size there is nothing safe to reuse"
);
// camada 15, dentro do outro balão
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 404, top: 464, right: 573, bottom: 538, width: 169, height: 74 }, 17),
  otherBubble,
  "Each bubble must serve only the layers inside it"
);
// camada 27, em nenhum dos dois
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 850, top: 1983, right: 1099, bottom: 2170, width: 249, height: 187 }, 17),
  null,
  "A layer outside every traced bubble must still pay for its own scan"
);
// dentro da caixa envolvente mas fora do contorno: o topo do balão afila
assert.strictEqual(
  findEnclosingBubbleShape(cache, { left: 100, top: 1045, right: 160, bottom: 1075, width: 60, height: 30 }, 17),
  null,
  "The bounding box alone must not decide: the profile has to contain the layer"
);
// falhas e formas de seleção manual em cache não dizem nada sobre onde a camada está
assert.strictEqual(
  findEnclosingBubbleShape(
    new Map([["a", null], ["b", { source: "selection", textSize: 17, profile: wideBubble.profile }]]),
    { left: 370, top: 1231, right: 540, bottom: 1411, width: 170, height: 180 },
    17
  ),
  null,
  "Only a detected bubble may be reused"
);
assert.strictEqual(findEnclosingBubbleShape(cache, null, 17), null);
assert.strictEqual(findEnclosingBubbleShape(cache, { left: 0, top: 0, width: 0, height: 0 }, 17), null);

// Interpola entre faixas em vez de arredondar para a mais próxima: os dois
// pontos abaixo caem na mesma faixa do topo e só a interpolação os separa.
assert.strictEqual(profileContainsPoint(wideBubble.profile, 200, 1178), true);
assert.strictEqual(profileContainsPoint(wideBubble.profile, 116, 1070), false);

assert.ok(
  /findEnclosingBubbleShape\([\s\S]{0,120}inlineTextSizeRef\.current/.test(previewSource),
  "The panel must look for an already traced bubble, body size included, before running the wand"
);
assert.ok(
  /textSize: inlineTextSizeRef\.current/.test(previewSource),
  "A cached bubble must carry the body size that produced it"
);

console.log("TextShapeR layer tracking tests passed");
