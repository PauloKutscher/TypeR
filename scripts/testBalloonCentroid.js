/*
 * Behaviour test for the balloon centring geometry.
 *
 * The host runs in ExtendScript, so the pure functions are lifted out of
 * app_src/host.js and executed in Node with real inputs. This checks what the
 * code does, not how it is written: it fails if the centroid maths breaks or if
 * the shared positioning helper stops honouring the target centre.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const hostSource = fs.readFileSync(path.join(__dirname, "..", "app_src", "host.js"), "utf8");

function lift(signature, args) {
  const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = hostSource.match(new RegExp("function " + escaped + " \\{([\\s\\S]*?)\\r?\\n\\}"));
  assert.ok(match, signature + " must exist in host.js");
  return new Function(...args, `return function ${signature} {${match[1]}\n};`);
}

/* ---------- scanline span, reused by the centroid ---------- */

const scanlineSpan = lift("_polygonScanlineSpan(polygons, y)", [])();
const square = [[0, 0], [100, 0], [100, 100], [0, 100]];
assert.deepStrictEqual(scanlineSpan([square], 50), { left: 0, right: 100 }, "a square spans its full width");
assert.strictEqual(scanlineSpan([square], 150), null, "a scanline outside the shape has no span");

/* ---------- centroid ---------- */

const pointInPolygon = lift("_pointInPolygon(x, y, poly)", [])();
const centroid = lift("_polygonCentroid(polygons)", ["_pointInPolygon"])(pointInPolygon);

assert.ok(pointInPolygon(5, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]), "inside must be inside");
assert.ok(!pointInPolygon(15, 5, [[0, 0], [10, 0], [10, 10], [0, 10]]), "outside must be outside");

let centre = centroid([square]);
assert.ok(Math.abs(centre.x - 50) < 0.5 && Math.abs(centre.y - 50) < 0.5, "square centre must be its middle");

// Winding must not matter: the same shape wound the other way is the same shape.
centre = centroid([square.slice().reverse()]);
assert.ok(Math.abs(centre.x - 50) < 0.5 && Math.abs(centre.y - 50) < 0.5, "reversed winding must give the same centre");

/*
 * A balloon with a tail: a 200x200 body plus a thin 60x10 spike on the right.
 * The bounding-box centre sits at x=130 because of the spike, while the body
 * centre is at x=100. The area-weighted centre must stay close to the body,
 * which is the whole reason it replaced the bounding-box centre.
 */
const tailed = [[
  [0, 0], [200, 0], [200, 95], [260, 95], [260, 105], [200, 105], [200, 200], [0, 200],
]];
centre = centroid(tailed);
assert.ok(
  Math.abs(centre.x - 100) < Math.abs(130 - 100),
  `centre ${centre.x.toFixed(1)} must sit closer to the body than the bounding box does`
);
assert.ok(centre.x < 106, "a thin tail must move the centre by only a few pixels");
assert.ok(Math.abs(centre.y - 100) < 1, "a horizontal tail must not move the centre vertically");

/*
 * A balloon that tapers upwards: the wide half must pull the centre towards it,
 * away from the bounding-box centre at y=100.
 */
const tapered = [[[95, 0], [105, 0], [200, 200], [0, 200]]];
centre = centroid(tapered);
assert.ok(centre.y > 120, `a tapering top must push the centre down, got ${centre.y.toFixed(1)}`);
assert.ok(Math.abs(centre.x - 100) < 1, `a symmetric taper must keep the centre horizontally centred, got ${centre.x.toFixed(1)}`);

/*
 * Photoshop returns the traced selection as several subpaths: the balloon plus
 * specks from the anti-aliased edge. Only the largest contour is the balloon, so
 * a speck far away must not move the centre.
 */
centre = centroid([square, [[900, 900], [906, 900], [906, 906], [900, 906]]]);
assert.ok(
  Math.abs(centre.x - 50) < 0.5 && Math.abs(centre.y - 50) < 0.5,
  `a distant speck must be ignored, got ${centre.x.toFixed(1)},${centre.y.toFixed(1)}`
);

// A hole must subtract, whichever way it is wound.
const holedReverse = centroid([square, [[10, 10], [10, 40], [40, 40], [40, 10]]]);
const holedForward = centroid([square, [[10, 10], [40, 10], [40, 40], [10, 40]]]);
assert.ok(holedReverse.x > 50 && holedReverse.y > 50, "a hole in the top-left must push the centre down and right");
assert.ok(
  Math.abs(holedReverse.x - holedForward.x) < 1e-6 && Math.abs(holedReverse.y - holedForward.y) < 1e-6,
  "a hole must subtract regardless of its winding order"
);

assert.strictEqual(centroid([[[0, 0], [10, 0], [20, 0]]]), null, "a degenerate outline must be refused");
assert.strictEqual(centroid([]), null, "no outline means no centre");

/* ---------- shared positioning helper ---------- */

const moves = [];
const positionLayer = lift(
  "_positionLayerWithinSelection(selection, bounds, phantomOffsetX, target)",
  ["_moveLayer"]
)((dx, dy) => moves.push({ dx, dy }));

const selection = { left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, xMid: 200, yMid: 150 };
const textBounds = { left: 150, top: 130, right: 250, bottom: 170, width: 100, height: 40, xMid: 200, yMid: 150 };

moves.length = 0;
positionLayer(selection, textBounds, 0, null);
assert.deepStrictEqual(moves[0], { dx: 0, dy: 0 }, "without a target the selection centre keeps the historical behaviour");

moves.length = 0;
positionLayer(selection, textBounds, 0, { x: 180, y: 160 });
assert.deepStrictEqual(moves[0], { dx: -20, dy: 10 }, "the target centre must drive the move");

/*
 * TextShapeR's phantom offset shifts the layer by a fraction of the balloon
 * width to compensate for the hidden half of a balloon cut by the panel edge,
 * and it was calibrated against the bounding-box centre. A centroid target
 * already carries that asymmetry, so applying both corrected the same thing
 * twice and threw the text far to the left, out of the balloon. The offset must
 * only survive where there is no usable target on that axis.
 */
moves.length = 0;
positionLayer(selection, textBounds, 5, { x: 180, y: 160 });
assert.deepStrictEqual(moves[0], { dx: -20, dy: 10 }, "a centroid target must ignore the phantom offset");

moves.length = 0;
positionLayer(selection, textBounds, -40, null);
assert.deepStrictEqual(moves[0], { dx: -40, dy: 0 }, "without a target the phantom offset must still apply");

moves.length = 0;
positionLayer(selection, textBounds, 0, { x: NaN, y: 160 });
assert.deepStrictEqual(moves[0], { dx: 0, dy: 10 }, "a broken target axis must fall back to the selection centre");

moves.length = 0;
positionLayer(selection, textBounds, -40, { x: NaN, y: 160 });
assert.deepStrictEqual(moves[0], { dx: -40, dy: 10 }, "a target without a usable X must still take the phantom offset");

/* ---------- Align must never refuse to move ---------- */
/*
 * Asked for explicitly: a balloon whose detected region spans two bubbles must be
 * centred badly rather than answered with "no selected area", because a refusal
 * costs more usability than a wrong centre.
 */
const alignStart = hostSource.indexOf("function _alignCurrentTextLayerToSelection(");
assert.ok(alignStart >= 0, "_alignCurrentTextLayerToSelection must exist");
const alignBody = hostSource.slice(alignStart, hostSource.indexOf("\n}", alignStart));
assert.ok(
  !/_regionIsImplausibleBalloon|_regionHoldsOtherTextLayer/.test(alignBody),
  "Align must not refuse on an implausible region"
);
assert.ok(
  !/return "noSelection"/.test(alignBody),
  "Align must not answer noSelection after finding a region"
);

/* ---------- the centroid must get a second chance ---------- */

/*
 * Opening a selection that is a mesh of thin slivers can leave `Make Work Path`
 * with nothing to trace (measured: 0 subpaths after a 9 px opening against 2 059
 * subpaths on the same selection unopened). Without a retry on the unopened
 * selection the layer falls back to the bounding-box centre and the phantom
 * offset comes back with it, which cost 405 px on the measured case.
 */
const openBody = hostSource.slice(
  hostSource.indexOf("function _getAdaptiveOpenedSelectionBounds("),
  hostSource.indexOf("\n}", hostSource.indexOf("return opened || bounds;"))
);
assert.ok(
  /!target\.centroid[\s\S]*_openedSelectionCentroid\(doc, _getCurrentSelectionBounds\(\)/.test(openBody),
  "the opened bounds helper must retry the centroid on the unopened selection"
);

/*
 * The anchor budget belongs to the Action Manager read (about 13 µs per anchor,
 * measured over 10 740 anchors); the old 4 000 came from the DOM read at 5.7 ms
 * per anchor and silently threw away usable centroids.
 */
const budget = Number((hostSource.match(/_MAX_BALLOON_PATH_ANCHORS = (\d+)/) || [])[1]);
assert.ok(budget >= 20000, `anchor budget must fit the Action Manager read, got ${budget}`);

/* ---------- path anchors read through the Action Manager ---------- */

/*
 * The centroid is only as good as the unit conversion: Action Manager reports
 * path coordinates in points, so a page at 144 dpi must come back doubled. This
 * fakes the descriptor chain and checks the numbers, then checks that the DOM
 * cross-check refuses a mismatch instead of trusting it.
 */
function fakePointsDescriptor(points) {
  const anchorOf = (point) => ({
    getUnitDoubleValue: (id) => (id === "horizontal" ? point[0] : point[1]),
  });
  const pointList = {
    count: points.length,
    getObjectValue: (i) => ({ getObjectValue: () => anchorOf(points[i]) }),
  };
  const subpathList = { count: 1, getObjectValue: () => ({ getList: () => pointList }) };
  const componentList = { count: 1, getObjectValue: () => ({ getList: () => subpathList }) };
  return { getObjectValue: () => ({ getList: () => componentList }) };
}

const readAnchors = lift("_readPathAnchorPolygons(doc)", [
  "ActionReference",
  "executeActionGet",
  "stringIDToTypeID",
  "charID",
]);

// Points at 144 dpi are twice as many pixels.
const anchorsInPoints = [[10, 20], [110, 20], [110, 120], [10, 120]];
const polygonsAt144 = readAnchors(
  function () { return { putProperty() {}, putEnumerated() {} }; },
  () => fakePointsDescriptor(anchorsInPoints),
  (name) => name,
  { Property: 0, Path: 0, Ordinal: 0, Target: 0 }
)({ resolution: 144 });
assert.deepStrictEqual(
  polygonsAt144,
  [[[20, 40], [220, 40], [220, 240], [20, 240]]],
  "anchors must be scaled from points to pixels by the document resolution"
);

const polygonsAt72 = readAnchors(
  function () { return { putProperty() {}, putEnumerated() {} }; },
  () => fakePointsDescriptor(anchorsInPoints),
  (name) => name,
  { Property: 0, Path: 0, Ordinal: 0, Target: 0 }
)({ resolution: 72 });
assert.deepStrictEqual(polygonsAt72, [anchorsInPoints], "at 72 dpi points and pixels coincide");

const anchorsMatchDom = lift("_pathAnchorsMatchDom(pathItem, polygons)", [])();
const domPath = { subPathItems: [{ pathPoints: [{ anchor: [20, 40] }] }] };
assert.ok(anchorsMatchDom(domPath, polygonsAt144), "matching anchors must be accepted");
assert.ok(!anchorsMatchDom(domPath, polygonsAt72), "a unit mismatch must be refused");
assert.ok(!anchorsMatchDom({}, polygonsAt144), "an unreadable path must be refused");

/* ---------- the three callers must go through the helper with a target ---------- */

for (const caller of [
  "_createTextLayerInSelection",
  "_alignCurrentTextLayerToSelection",
  "_createTextLayersInStoredSelections",
]) {
  const start = hostSource.indexOf("function " + caller + "(");
  assert.ok(start >= 0, caller + " must exist");
  const body = hostSource.slice(start, hostSource.indexOf("\n}", start));
  assert.ok(
    /_positionLayerWithinSelection\([^)]*,[^)]*,[^)]*,[^)]*\)/.test(body),
    caller + " must pass a target centre to _positionLayerWithinSelection"
  );
}

console.log("balloon centroid tests passed");
