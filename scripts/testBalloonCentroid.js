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

/* ---------- reading the bounds must never cost the user their selection ---------- */

/*
 * `Make Work Path` consumes the live selection, so every trace runs on the
 * marquee the user is still holding. Multi-bubble polls this helper for every new
 * selection: when the centroid was refused, the marquee was dropped and the next
 * poll read the empty document as a user deselect and wiped the stored batch.
 * A large selection is exactly the case that trips it, because it blows the
 * anchor budget on both passes.
 *
 * The fake document below models what Photoshop does: the channel keeps a copy,
 * contract/expand move the edges, and a trace eats the selection.
 */
const box = (left, top, right, bottom) => ({
  left, top, right, bottom,
  width: right - left,
  height: bottom - top,
  xMid: (left + right) / 2,
  yMid: (top + bottom) / 2,
});

const openRadius = lift("_getAdaptiveSelectionOpenRadius(bounds)", [
  "_MIN_SELECTION_OPEN_RADIUS",
  "_SELECTION_OPEN_RATIO",
  "_MAX_SELECTION_OPEN_RADIUS",
])(4, 0.1, 96);

/*
 * Contract/Expand cost grows with the radius and with the page. Measured on a
 * 6331x8882 smart object interior, a region taking almost the whole page opened
 * with a 629 px radius and one Contract alone took 2 708 ms. Across the 65
 * reference cases no region under a quarter of the page opens wider than 85 px,
 * so the ceiling must bite only above that.
 */
assert.strictEqual(openRadius(box(0, 0, 850, 850)), 85, "a reference-sized region keeps its measured radius");
assert.strictEqual(openRadius(box(0, 0, 6294, 8716)), 96, "a page-sized region must not open with a 629 px radius");

const openBounds = lift("_getAdaptiveOpenedSelectionBounds(bounds)", [
  "app",
  "_getAdaptiveSelectionOpenRadius",
  "_createTempSelectionChannel",
  "_modifySelectionBounds",
  "_getCurrentSelectionBounds",
  "_openedSelectionCentroid",
  "_centroidRetryWorthIt",
  "_regionCoversTooMuchPage",
  "_hostState",
]);

const retryWorthIt = lift("_centroidRetryWorthIt(skip)", [])();

function runOpen(initial, traceResults, coversPage = false) {
  const world = { live: { ...initial }, stored: null, traces: 0, channels: 0, channelRemoved: false, modifies: 0 };
  const hostState = { centroidSkip: "" };
  const doc = {
    selection: {
      load: () => {
        if (!world.stored) throw new Error("no channel to restore from");
        world.live = { ...world.stored };
      },
    },
  };
  const helper = openBounds(
    { activeDocument: doc },
    openRadius,
    () => {
      world.channels += 1;
      world.stored = { ...world.live };
      return { remove: () => { world.channelRemoved = true; } };
    },
    (amount) => {
      if (!world.live) throw new Error("no selection to modify");
      world.modifies += 1;
      world.live = {
        left: world.live.left - amount,
        top: world.live.top - amount,
        right: world.live.right + amount,
        bottom: world.live.bottom + amount,
      };
    },
    () => (world.live ? box(world.live.left, world.live.top, world.live.right, world.live.bottom) : undefined),
    () => {
      const result = traceResults[world.traces] || { skip: "anchors:0" };
      world.traces += 1;
      world.live = null; // Make Work Path consumed the selection
      hostState.centroidSkip = result.centroid ? "" : result.skip;
      return result.centroid || null;
    },
    retryWorthIt,
    () => coversPage,
    hostState
  );
  const result = helper(box(initial.left, initial.top, initial.right, initial.bottom));
  return { world, result, hostState };
}

const big = { left: 200, top: 300, right: 1400, bottom: 1600 };

// The reported bug: a big selection blows the anchor budget, the centroid is
// refused, and the marquee must still be there afterwards.
let run = runOpen(big, [{ skip: "anchors:41000" }]);
assert.ok(run.world.live, "a refused centroid must not cost the user their selection");
assert.strictEqual(run.world.traces, 1, "an outline over the anchor budget must not be traced again unopened");
assert.ok(run.world.channelRemoved, "the temporary channel must always be removed");
assert.ok(run.result && run.result.width > 0, "the caller must still get usable bounds");

// The Task 14 case must survive: an opening that wipes the outline out still
// gets its second chance, and the selection comes back from that trace too.
run = runOpen(big, [{ skip: "anchors:0" }, { skip: "anchors:0" }]);
assert.strictEqual(run.world.traces, 2, "an empty trace after opening must retry on the unopened selection");
assert.ok(run.world.live, "the retry must not cost the user their selection either");

run = runOpen(big, [{ skip: "anchors:0" }, { centroid: { x: 700, y: 900 } }]);
assert.deepStrictEqual(run.result.centroid, { x: 700, y: 900 }, "the retry's centroid must reach the caller");
assert.ok(run.world.live, "a successful retry must leave the selection alive");

// The normal path: the centroid comes from the opened selection, one trace, and
// the marquee is restored from the channel as it always was.
run = runOpen(big, [{ centroid: { x: 800, y: 950 } }]);
assert.strictEqual(run.world.traces, 1, "a usable centroid must not be traced twice");
assert.deepStrictEqual(run.result.centroid, { x: 800, y: 950 }, "the opened centroid must reach the caller");
assert.ok(run.world.live, "the historical restore must still happen");

// Which refusals are worth a second trace: everything the unopened selection
// could still fix, and nothing it provably cannot, because it is the larger one.
assert.ok(retryWorthIt(""), "no attempt yet means the unopened selection is still worth a try");
assert.ok(retryWorthIt("anchors:0"), "an empty outline is what the retry exists for");
assert.ok(!retryWorthIt("anchors:41000"), "an outline over the budget only gets bigger unopened");
// Everything else already paid for a full trace on the way to being refused, and
// the unopened selection is the larger one: repeating it bought the same refusal
// twice on the marquee the user is still holding.
assert.ok(!retryWorthIt("degenerateOutline"), "a refusal that already cost a trace must not cost a second one");
assert.ok(!retryWorthIt("outsideEnvelope"), "a traced-then-rejected centroid must not be traced again");
assert.ok(!retryWorthIt("amRead:out of memory"), "a read that blew up must not be repeated on a bigger outline");

/*
 * The reported freeze: a wand that escaped into the artwork covers almost the
 * whole page, and `_openedSelectionCentroid` was always going to refuse it. Doing
 * that after the opening meant paying for the opening anyway — measured 5 982 ms
 * in a single poll on a 6331x8882 page, with the poll firing every 1,5 s. Nothing
 * may be spent on such a region: no channel, no Contract/Expand, no trace.
 */
run = runOpen(big, [{ centroid: { x: 800, y: 950 } }], true);
assert.strictEqual(run.world.channels, 0, "a region covering the page must not cost a temp channel");
assert.strictEqual(run.world.modifies, 0, "a region covering the page must not be contracted or expanded");
assert.strictEqual(run.world.traces, 0, "a region covering the page must not be traced");
assert.ok(run.world.live, "and the marquee must be untouched");
assert.strictEqual(run.hostState.centroidSkip, "coversPage", "the refusal must still be reported");
assert.deepStrictEqual(
  { left: run.result.left, right: run.result.right },
  { left: big.left, right: big.right },
  "the caller still gets the raw bounds to work from"
);

/* ---------- an interrupted capture must not read back as a user deselect ---------- */

/*
 * `Make Work Path` consumes the selection, so between the trace and the restore
 * the marquee lives only in the temp channel. If that window is interrupted — Esc
 * during a slow trace, an engine error, a crash — the document is left empty, and
 * multi-bubble read that as "the user pressed Ctrl+D" and wiped the whole stored
 * batch. An orphan channel is proof the user did not deselect: it only exists
 * while one of our own readers is running.
 */
function runRecover(channelHolds) {
  const state = { live: null, removed: false };
  const channel = channelHolds ? { remove: () => { state.removed = true; } } : null;
  const doc = {
    channels: {
      getByName: (name) => {
        assert.strictEqual(name, "__TyperSelectionTemp__", "the reader must look for its own channel");
        if (!channel) throw new Error("no such channel");
        return channel;
      },
    },
    selection: { load: () => { state.live = box(10, 20, 110, 220); } },
  };
  const helper = lift("_recoverSelectionFromTempChannel()", [
    "app",
    "_TEMP_SELECTION_CHANNEL",
    "_getCurrentSelectionBounds",
  ])({ activeDocument: doc }, "__TyperSelectionTemp__", () => state.live || undefined);
  return { result: helper(), state };
}

let recovered = runRecover(true);
assert.ok(recovered.result, "an orphan channel must give the marquee back");
assert.strictEqual(recovered.result.width, 100, "and the recovered bounds must be the stored ones");
assert.ok(recovered.state.removed, "the orphan channel must not be left behind a second time");

recovered = runRecover(false);
assert.strictEqual(recovered.result, null, "a real Ctrl+D leaves no channel, so it must still read as cleared");

const changedBody = hostSource.match(/function getSelectionChanged\(\) \{([\s\S]*?)\n\}/)[1];
const clearedBranch = changedBody.slice(0, changedBody.indexOf("_selectionClearedResult"));
assert.ok(
  /_recoverSelectionFromTempChannel\(\)/.test(clearedBranch),
  "getSelectionChanged must try to recover before telling the panel the user deselected"
);
assert.ok(!retryWorthIt("coversPage"), "a region too big to trace must not be traced twice");
assert.ok(!retryWorthIt("userWorkPath"), "the user's work path must be left alone on both passes");

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
function fakePointsDescriptor(points, subpaths = 1, tally = {}, unit = "pointsUnit") {
  const anchorOf = (point) => ({
    getUnitDoubleValue: (id) => (id === "horizontal" ? point[0] : point[1]),
    getUnitDoubleType: () => unit,
  });
  const pointList = {
    count: points.length,
    getObjectValue: (i) => {
      tally.anchorsRead = (tally.anchorsRead || 0) + 1;
      return { getObjectValue: () => anchorOf(points[i]) };
    },
  };
  const subpathList = { count: subpaths, getObjectValue: () => ({ getList: () => pointList }) };
  const componentList = { count: 1, getObjectValue: () => ({ getList: () => subpathList }) };
  return { getObjectValue: () => ({ getList: () => componentList }) };
}

const readAnchors = lift("_readPathAnchorPolygons(doc)", [
  "ActionReference",
  "executeActionGet",
  "stringIDToTypeID",
  "typeIDToStringID",
  "charID",
  "_MAX_BALLOON_PATH_ANCHORS",
  "_hostState",
]);

function readerFor(descriptor, budget = 30000, state = {}) {
  return readAnchors(
    function () { return { putProperty() {}, putEnumerated() {} }; },
    () => descriptor,
    (name) => name,
    (id) => id,
    { Property: 0, Path: 0, Ordinal: 0, Target: 0 },
    budget,
    state
  );
}

// Points at 144 dpi are twice as many pixels.
const anchorsInPoints = [[10, 20], [110, 20], [110, 120], [10, 120]];
const polygonsAt144 = readerFor(fakePointsDescriptor(anchorsInPoints))({ resolution: 144 });
assert.deepStrictEqual(
  polygonsAt144,
  [[[20, 40], [220, 40], [220, 240], [20, 240]]],
  "anchors must be scaled from points to pixels by the document resolution"
);

const polygonsAt72 = readerFor(fakePointsDescriptor(anchorsInPoints))({ resolution: 72 });
assert.deepStrictEqual(polygonsAt72, [anchorsInPoints], "at 72 dpi points and pixels coincide");

/*
 * Measured on Photoshop 27.9: `pathContents` anchors carry `pixelsUnit` and are
 * already in document pixels. Scaling those by the resolution anyway multiplied
 * every anchor by 4.17 on a 300 dpi page, the DOM cross-check refused the
 * outline (`centroidSkip: unitMismatch`) and no balloon outside 72 dpi ever got
 * a centroid. The unit comes from the descriptor, it is not assumed.
 */
const anchorsInPixels = [[10, 20], [110, 20], [110, 120], [10, 120]];
const pixelsAt300 = readerFor(fakePointsDescriptor(anchorsInPixels, 1, {}, "pixelsUnit"))({ resolution: 300 });
assert.deepStrictEqual(pixelsAt300, [anchorsInPixels], "anchors already in pixels must not be rescaled by the resolution");

/*
 * The budget must be spent before the anchors are, not after. Subpath point
 * counts are list sizes, so an outline can be measured without materialising a
 * single anchor — which is the difference between refusing a screentone outline
 * for free and reading a few hundred thousand anchors first and then throwing
 * them away.
 */
const noisy = { anchorsRead: 0 };
const state = {};
const refused = readerFor(fakePointsDescriptor(anchorsInPoints, 5000, noisy), 400, state)({ resolution: 72 });
assert.strictEqual(refused, null, "an outline over the budget must be refused");
assert.strictEqual(noisy.anchorsRead, 0, "and refused without reading one anchor");
assert.strictEqual(state.lastPathAnchorCount > 400, true, "the caller must still learn how big it was");

const allowed = { anchorsRead: 0 };
const kept = readerFor(fakePointsDescriptor(anchorsInPoints, 3, allowed), 400, {})({ resolution: 72 });
assert.strictEqual(kept.length, 3, "an outline inside the budget is still read in full");
assert.strictEqual(allowed.anchorsRead, 12, "and every anchor of it is read exactly once");

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

/* ---------- the page-share guard must not depend on the user's rulers ---------- */

/*
 * `doc.width` comes back in the active ruler units. With rulers in centimetres a
 * 2700x3840 page reports ~21x30, so every balloon looks bigger than a quarter of
 * the "page", the guard refuses the region, and the centroid is never traced:
 * centring silently falls back to the bounding box for those users. The lab pages
 * are measured in pixels, which is why no run ever caught it.
 */
const pixelSize = lift("_getDocumentPixelSize(doc)", ["app", "Units"]);

function rulerWorld(startUnit, pageWidthPx, pageHeightPx) {
  const fakeApp = { preferences: { rulerUnits: startUnit } };
  const doc = {
    get width() { return fakeApp.preferences.rulerUnits === "px" ? pageWidthPx : pageWidthPx / 118.11; },
    get height() { return fakeApp.preferences.rulerUnits === "px" ? pageHeightPx : pageHeightPx / 118.11; },
  };
  return { fakeApp, doc };
}

let world = rulerWorld("cm", 2700, 3840);
let size = pixelSize(world.fakeApp, { PIXELS: "px" })(world.doc);
assert.deepStrictEqual(size, { width: 2700, height: 3840 }, "the page must be measured in pixels whatever the rulers say");
assert.strictEqual(world.fakeApp.preferences.rulerUnits, "cm", "the user's ruler unit must be put back");

world = rulerWorld("px", 2700, 3840);
size = pixelSize(world.fakeApp, { PIXELS: "px" })(world.doc);
assert.deepStrictEqual(size, { width: 2700, height: 3840 }, "rulers already in pixels must keep working");

const throwingWorld = { preferences: { rulerUnits: "in" } };
assert.strictEqual(
  pixelSize(throwingWorld, { PIXELS: "px" })({ get width() { throw new Error("no document"); } }),
  null,
  "an unreadable document must give no size instead of a wrong one"
);
assert.strictEqual(throwingWorld.preferences.rulerUnits, "in", "a failure must still put the ruler unit back");

const coversTooMuch = lift("_regionCoversTooMuchPage(bounds)", [
  "app",
  "_getDocumentPixelSize",
  "_MAX_BALLOON_PAGE_SHARE",
]);

const pageSize = { width: 2700, height: 3840 };
const guard = coversTooMuch({ activeDocument: {} }, () => pageSize, 0.25);
const balloon = { width: 900, height: 1200 };
const escapedFill = { width: 2000, height: 2000 };

assert.ok(!guard(balloon), "a real balloon must never be refused as too big");
assert.ok(guard(escapedFill), "a fill that swallowed a third of the page must still be refused");
assert.ok(!coversTooMuch({ activeDocument: {} }, () => null, 0.25)(balloon), "an unknown page size must not refuse anything");

/* ---------- a refused centroid must not kill the whole capture ---------- */

/*
 * `jamJSON.stringify` is not `JSON.stringify`: an undefined value throws
 * ("[jamJSON.stringify] Invalid JSON") instead of dropping the key. The capture
 * used to set `centroidX: undefined` whenever no centroid came out, so the whole
 * answer turned into `{error: true}` — and the panel drops errors silently, so
 * multi-bubble looked switched off and the counter never moved. Measured on the
 * user's 300 dpi page: 0 of 4 balloons stored, 4 of 4 after the fix.
 */
const captureChanged = lift("getSelectionChanged()", [
  "_hostState",
  "ScriptUI",
  "_getCurrentSelectionBounds",
  "_recoverSelectionFromTempChannel",
  "_selectionClearedResult",
  "jamJSON",
  "_withSuspendedHistory",
  "_getAdaptiveOpenedSelectionBounds",
  "_selectionBoundsKey",
]);

// Same contract as the host's serializer: undefined is not JSON.
const strictJson = {
  stringify: (value) => JSON.stringify(value, (key, item) => {
    if (item === undefined) throw new SyntaxError("[jamJSON.stringify] Invalid JSON");
    return item;
  }),
};

function captureWith(centroid) {
  const region = { top: 20, left: 10, right: 110, bottom: 140, width: 100, height: 120, xMid: 60, yMid: 80 };
  const opened = Object.assign({}, region);
  if (centroid) opened.centroid = centroid;
  return captureChanged(
    { selectionMonitor: { lastBounds: null, lastBoundsKey: null, multiWarnBounds: null } },
    { environment: { keyboardState: { shiftKey: false } } },
    () => region,
    () => null,
    () => strictJson.stringify({ cleared: true }),
    strictJson,
    (name, fn) => fn(),
    () => opened,
    () => "key"
  )();
}

const withoutCentroid = JSON.parse(captureWith(null));
assert.ok(!withoutCentroid.error, "a capture without a centroid must not report an error");
assert.strictEqual(withoutCentroid.multiSelection.length, 1, "and must still hand the panel its selection");
assert.ok(
  !("centroidX" in withoutCentroid.multiSelection[0]),
  "a missing centroid must leave the key out, never set it to undefined"
);

const withCentroid = JSON.parse(captureWith({ x: 55, y: 75 }));
assert.strictEqual(withCentroid.multiSelection[0].centroidX, 55, "a centroid must still travel with the selection");
assert.strictEqual(withCentroid.multiSelection[0].centroidY, 75, "on both axes");

/* ---------- cutting a region where two balloons were drawn over each other ---------- */

/*
 * A region that merges two balloons has one centroid and two texts, so both are
 * thrown at the same point: measured on the reference pages, a region holding one
 * text is off by 2/4 px at the median while a region holding two is off by 54/46
 * px and one holding four by 104/17 px, out to 346 px.
 *
 * The cut that fixes it reads nothing but the shape. That is the point: an
 * earlier version seeded the split with the ink boxes of the other text layers,
 * which measured well on pages that were already typeset and moved the answer
 * every time the button was pressed on a page that was not. Every case here
 * fails on the previous engine, where the functions lifted below do not exist.
 */
function tuning(name) {
  const match = hostSource.match(new RegExp(name + " = ([\\d.]+)"));
  assert.ok(match, name + " must be a tuning constant in host.js");
  return Number(match[1]);
}

const CONCAVITY = tuning("_CUSP_CONCAVITY");
const MIN_PIECE_SHARE = tuning("_CUSP_MIN_PIECE_SHARE");
const MAX_CUTS = tuning("_CUSP_MAX_CUTS");
const CONTOUR_POINTS = tuning("_CUSP_CONTOUR_POINTS");
const SPAN_DIVISOR = tuning("_CUSP_SPAN_DIVISOR");
const MIN_GAP = tuning("_CUSP_MIN_GAP");

const signedArea = lift("_polygonSignedArea(poly)", [])();
const areaCentroid = lift("_polygonAreaCentroid(poly)", [])();
const largestContour = lift("_largestContour(polygons)", ["_polygonSignedArea"])(signedArea);
const resampleContour = lift("_resampleContour(poly, count)", [])();
const findCuspPair = lift("_findCuspPair(points)", ["_CUSP_SPAN_DIVISOR", "_CUSP_MIN_GAP", "_CUSP_CONCAVITY"])(SPAN_DIVISOR, MIN_GAP, CONCAVITY);
const splitContourAtChord = lift("_splitContourAtChord(points, a, b)", [])();
const pieceOnSideOf = lift("_pieceOnSideOf(pieces, a, b, x, y)", [
  "_polygonSignedArea", "_polygonAreaCentroid",
])(signedArea, areaCentroid);
const centreInsideOutline = lift("_centreInsideOutline(polygons, point)", ["_pointInPolygon"])(pointInPolygon);
const splitAtCusps = lift("_splitOutlineAtCusps(polygons, activeBox, report)", [
  "_CUSP_CONCAVITY", "_CUSP_MIN_PIECE_SHARE", "_CUSP_MAX_CUTS", "_CUSP_CONTOUR_POINTS",
  "_CUSP_SPAN_DIVISOR", "_largestContour", "_resampleContour", "_findCuspPair", "_splitContourAtChord",
  "_pieceOnSideOf", "_polygonAreaCentroid",
])(CONCAVITY, MIN_PIECE_SHARE, MAX_CUTS, CONTOUR_POINTS,
  SPAN_DIVISOR, largestContour, resampleContour, findCuspPair, splitContourAtChord,
  pieceOnSideOf, areaCentroid);

function textBox(left, top, right, bottom) {
  return { left: left, top: top, right: right, bottom: bottom, width: right - left, height: bottom - top };
}

/* The union outline of two overlapping discs: the shape a double balloon is. */
function fusedDiscs(ax, ay, ar, bx, by, br, steps) {
  steps = steps || 240;
  const d = Math.hypot(bx - ax, by - ay);
  assert.ok(d < ar + br && d > Math.abs(ar - br), "the discs must actually overlap");
  const base = Math.atan2(by - ay, bx - ax);
  const half = Math.acos((d * d + ar * ar - br * br) / (2 * d * ar));
  const halfB = Math.acos((d * d + br * br - ar * ar) / (2 * d * br));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const a = base + half + ((2 * Math.PI - 2 * half) * i) / steps;
    points.push([ax + ar * Math.cos(a), ay + ar * Math.sin(a)]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = base + Math.PI + halfB + ((2 * Math.PI - 2 * halfB) * i) / steps;
    points.push([bx + br * Math.cos(a), by + br * Math.sin(a)]);
  }
  return points;
}

const twin = fusedDiscs(0, 0, 100, 150, 0, 100);

/*
 * Two texts in the same fused shape must get two different targets, each on its
 * own side of the waist, with no neighbour box anywhere in the input.
 */
const leftTarget = splitAtCusps([twin], textBox(-60, -20, 20, 20), {});
const rightTarget = splitAtCusps([twin], textBox(130, -20, 210, 20), {});
assert.ok(leftTarget && rightTarget, "a fused pair of balloons must be cut");
assert.ok(leftTarget.x < 75, "the left text must be centred in the left balloon");
assert.ok(rightTarget.x > 75, "and the right text in the right one");
assert.ok(rightTarget.x - leftTarget.x > 80, "the two targets must be a balloon apart, not the same point");

/*
 * And the whole shape's centroid, which is what the engine used to answer, sits
 * in neither balloon: it is the point both texts used to be thrown at.
 */
const merged = centroid([twin]);
assert.ok(Math.abs(merged.x - 75) < 15, "the merged centroid falls in the waist, belonging to neither text");

/*
 * Idempotency: the typesetter drops the line anywhere inside the balloon and
 * presses Align, then presses it again. The answer must not move.
 */
const dropped = splitAtCusps([twin], textBox(-90, -30, -10, 10), {});
assert.ok(Math.abs(dropped.x - leftTarget.x) < 0.001 && Math.abs(dropped.y - leftTarget.y) < 0.001,
  "moving the text inside its own balloon must not move the target");
const afterAlign = splitAtCusps([twin],
  textBox(leftTarget.x - 40, leftTarget.y - 20, leftTarget.x + 40, leftTarget.y + 20), {});
assert.ok(Math.abs(afterAlign.x - leftTarget.x) < 0.001,
  "pressing Align a second time must land on the same pixel");

/* A single balloon has no waist and must be left exactly as it was. */
const disc = [];
for (let i = 0; i < 360; i++) {
  const a = (i / 360) * Math.PI * 2;
  disc.push([200 + 150 * Math.cos(a), 200 + 120 * Math.sin(a)]);
}
const discReport = {};
assert.strictEqual(splitAtCusps([disc], textBox(150, 180, 250, 220), discReport), null,
  "an ordinary balloon must not be cut");
assert.ok(/^(noCusp|shallow)/.test(discReport.skip), "and must say why: " + discReport.skip);

/*
 * One concave corner is a bite out of the outline, not two balloons. Cutting on
 * it would move a text that has nothing wrong with it.
 */
const bitten = [];
for (let i = 0; i < 360; i++) {
  const a = (i / 360) * Math.PI * 2;
  const r = Math.abs(a - Math.PI / 2) < 0.25 ? 60 : 150;
  bitten.push([200 + r * Math.cos(a), 200 + r * Math.sin(a)]);
}
assert.strictEqual(splitAtCusps([bitten], textBox(150, 180, 250, 220), {}), null,
  "a single concave corner is a bite, not a waist");

/*
 * A cut that leaves almost the whole region on one side has separated nothing.
 * Two discs of very different sizes: the small one is below the minimum share,
 * so the region keeps its own centroid.
 */
const lopsided = fusedDiscs(0, 0, 200, 210, 0, 40);
const lopsidedReport = {};
const lopsidedTarget = splitAtCusps([lopsided], textBox(-60, -20, 20, 20), lopsidedReport);
assert.ok(lopsidedTarget === null || lopsidedReport.share >= MIN_PIECE_SHARE,
  "a sliver must never become the answer: " + JSON.stringify(lopsidedReport));

/* The report has to say how much of the region the answer came from. */
const twinReport = {};
splitAtCusps([twin], textBox(-60, -20, 20, 20), twinReport);
assert.ok(twinReport.cuts >= 1 && twinReport.cuts <= MAX_CUTS, "the number of cuts must be reported and bounded");
assert.ok(twinReport.share > 0 && twinReport.share < 1, "so must the share of the region that was kept");

/* The centre has to land inside the shape it came from. */
assert.ok(centreInsideOutline([twin], leftTarget), "the cut centre must be inside the region");

/*
 * Cost. The anchor budget allows 30 000 anchors and Align pays this on every
 * press, so the whole cut runs on a fixed number of resampled points rather than
 * on the anchors themselves.
 */
const dense = [];
for (let i = 0; i < 20000; i++) {
  const a = (i / 20000) * Math.PI * 2;
  dense.push([500 + 400 * Math.cos(a), 500 + 300 * Math.sin(a)]);
}
const denseStart = Date.now();
splitAtCusps([dense], textBox(400, 450, 600, 550), {});
const denseCost = Date.now() - denseStart;
assert.ok(denseCost < 150, "a 20 000 anchor outline must still cut in well under a frame: " + denseCost + " ms");

/* Resampling must not depend on where the tracing dropped its anchors. */
const sparse = resampleContour([[0, 0], [400, 0], [400, 400], [0, 400]], 200);
const uneven = resampleContour([[0, 0], [10, 0], [400, 0], [400, 400], [200, 400], [0, 400]], 200);
assert.ok(Math.abs(sparse.length - uneven.length) <= 2,
  "the same shape must resample to the same number of points however it was traced");
const sparseCentre = areaCentroid(sparse);
assert.ok(Math.abs(sparseCentre.x - 200) < 2 && Math.abs(sparseCentre.y - 200) < 2,
  "and must still describe the same square");

/* The largest contour is the balloon; the others are its holes. */
assert.strictEqual(largestContour([[[0, 0], [10, 0], [10, 10], [0, 10]], twin]), twin,
  "the balloon is the contour with the most area");

/* A chord too close to its own ends leaves no piece to keep. */
assert.strictEqual(splitContourAtChord(sparse, 10, 12), null,
  "a chord between neighbouring points cuts nothing");

/* ---------- the outline has to survive, and only where it is free ---------- */

const alignSplitBody = hostSource.match(
  /function _alignCurrentTextLayerToSelection\(\) \{([\s\S]*?)\n\}/
);
assert.ok(alignSplitBody, "the align entry point must exist");
assert.ok(
  /if \(outline\) \{[\s\S]*_splitOutlineAtCusps\(/.test(alignSplitBody[1]),
  "the cut must only be attempted when an outline was actually traced"
);
assert.ok(
  alignSplitBody[1].indexOf("var target = selection.centroid") <
    alignSplitBody[1].indexOf("_splitOutlineAtCusps(outline, bounds, report)"),
  "the cut must refine the centroid, never replace the fallback that a single balloon relies on"
);
assert.ok(
  /_centreInsideOutline\(outline, split\)/.test(alignSplitBody[1]),
  "a cut centre outside the region it came from must be refused"
);
assert.ok(
  /_hostState\.lastOutlineKey === _selectionBoundsKey\(selection\)/.test(alignSplitBody[1]),
  "the outline must be matched to the selection it came from: Align traces more than once"
);
assert.ok(
  alignSplitBody[1].indexOf("_hostState.lastOutline = null;") < alignSplitBody[1].indexOf("if (outline)"),
  "and must be dropped before it is used, so nothing keeps it after the call"
);

/*
 * The centring path must not read where any other layer is. This is the whole
 * reason the rule was rewritten: a target that depends on the neighbours moves
 * every time one of them is aligned, and the typesetter sees the text jump.
 */
const forbidden = ["_visibleTextInkBoxes", "_collectTextLayerIds", "_getLayerBoundsById"];
for (let f = 0; f < forbidden.length; f++) {
  assert.ok(
    alignSplitBody[1].indexOf(forbidden[f]) < 0,
    "the align path must not read the other layers' positions (" + forbidden[f] + ")"
  );
}
const splitBody = hostSource.match(/function _splitOutlineAtCusps\(polygons, activeBox, report\) \{([\s\S]*?)\n\}/);
assert.ok(splitBody, "the cut must exist");
assert.ok(
  splitBody[1].indexOf("app.activeDocument") < 0 && splitBody[1].indexOf("executeAction") < 0,
  "the cut must be arithmetic on the outline already traced: no Photoshop call"
);

/*
 * The probe that finds the balloon samples the merged image with only the layer
 * being centred hidden, so a neighbouring line dropped across the middle of this
 * one is what the wand lands on: the fill then runs out into whatever artwork
 * that glyph touches. It has to be able to try somewhere else.
 */
const wandStart = hostSource.indexOf("function _createBalloonWandSelection(");
assert.ok(wandStart >= 0, "the balloon probe must exist");
const wandBody = hostSource.slice(wandStart, hostSource.indexOf("\n}", wandStart));
assert.ok(
  /var probes = \[[\s\S]*?\]/.test(wandBody),
  "the probe must have more than one point to try"
);
assert.ok(
  (wandBody.match(/bounds\.(left|top) \+ bounds\.(width|height) \*/g) || []).length >= 8,
  "and those points must be inside the text's own box, four corners plus the middle"
);
assert.ok(
  wandBody.indexOf("layer.visible = false") >= 0 && wandBody.indexOf("layer.visible = true") >= 0,
  "the layer being centred is hidden for the probe and put back afterwards"
);

const pickStart = hostSource.indexOf("function _bestBalloonProbe(");
assert.ok(pickStart >= 0, "the probe has to be able to say that a point missed");
const pickBody = hostSource.slice(pickStart, hostSource.indexOf("\n}", pickStart));
assert.ok(
  pickBody.indexOf("_regionCoversTooMuchPage(found)") >= 0,
  "a probe that escaped the balloon must be discarded, not centred on"
);
assert.ok(
  pickBody.indexOf("found.left > bounds.xMid || found.right < bounds.xMid") >= 0,
  "and so must a region that does not even hold the text it belongs to"
);
assert.ok(
  pickBody.indexOf("if (p === 0) break;") >= 0,
  "a page with nothing lying over the line must still cost exactly one wand"
);

/*
 * The bite the lines lying over this one take out of the balloon is taken out of
 * the region too: they are hidden and the balloon is filled again. That fill is
 * only ever a candidate — where two balloons touch, the neighbours' ink is the
 * only thing narrowing the gap between them, and without it the fill takes both.
 */
assert.ok(
  wandBody.indexOf("_collectOverlappingTextLayerIds(") >= 0 &&
    wandBody.indexOf("_setLayerVisibilityByIds(textIds, false)") >= 0,
  "the lines lying over this one must be taken out of the page before the second fill"
);
assert.ok(
  wandBody.indexOf("_hostState.cleanCandidate = {") > 0,
  "and what that fill found is handed on as a candidate, not used on the spot"
);
assert.ok(
  /finally \{[\s\S]*_setLayerVisibilityByIds\(textIds, true\)/.test(wandBody),
  "a throw between the hide and the show would leave those lines invisible"
);
assert.ok(
  wandBody.lastIndexOf("_wandAt(") > wandBody.indexOf("_setLayerVisibilityByIds(textIds, true)"),
  "the region the caller reads is filled again after the page is whole"
);
assert.ok(
  wandBody.indexOf("outline: _hostState.lastOutline") >= 0,
  "the outline traced with it travels with it, or the cut runs on a region that was thrown away"
);

/*
 * The choice is made in Align, where the region the page really has has just been
 * opened and its centre is already paid for. Deciding inside the probe meant
 * opening twice and measured 20,3% over the engine it replaced, against a
 * ceiling of 15%.
 */
assert.ok(
  alignBody.indexOf("candidate.away < plainAway") >= 0,
  "whichever centre sits closer to the line being centred is the balloon it is in"
);
assert.ok(
  alignBody.indexOf("_hostState.cleanCandidate = null;") <
    alignBody.indexOf("var candidate = _hostState.cleanCandidate;"),
  "a candidate left over from the call before must never decide this one"
);
assert.ok(
  alignBody.indexOf("_hostState.lastOutlineKey = candidate.outlineKey") >= 0,
  "and taking the candidate takes its outline with it"
);
assert.ok(
  hostSource.indexOf("_getAdaptiveOpenedSelectionBounds", hostSource.indexOf("_setLayerVisibilityByIds(textIds, false)")) <
    hostSource.indexOf("_setLayerVisibilityByIds(textIds, true)"),
  "the candidate has to be opened while the page is still clean"
);

const idsStart = hostSource.indexOf("function _collectOverlappingTextLayerIds(");
assert.ok(idsStart >= 0, "finding the lines that lie over this one must exist");
const idsBody = hostSource.slice(idsStart, hostSource.indexOf("\n}", idsStart));
assert.ok(
  idsBody.indexOf("_boxOverlapShare(other, box) >= _PROBE_OVERLAP_SHARE") >= 0,
  "only the lines that cover a real part of this one, never the whole page"
);
assert.ok(
  idsBody.indexOf("container.layers") < 0 && idsBody.indexOf("_getLayerByIndex(") >= 0,
  "walked through the Action Manager: the DOM walk ran on every Align and cost about 100 s over the reference pages"
);

/*
 * Every helper the probe leans on has to be there. Rewriting the layer walk once
 * deleted this one along with the block it replaced: the clean pass threw on
 * every call for three whole measurement runs, and the numbers looked like a
 * clean bill of health because the engine had quietly stopped doing the work.
 */
for (const helper of ["_distanceFromCentroid", "_boxOverlapShare", "_collectOverlappingTextLayerIds", "_bestBalloonProbe"]) {
  assert.ok(
    hostSource.indexOf("function " + helper + "(") >= 0,
    helper + " must exist: the probe calls it and a throw there is silent"
  );
}
assert.ok(
  wandBody.indexOf("_hostState.probe.threw") >= 0,
  "and a throw in the clean pass has to be recorded, or it reads as a balloon that needed no cleaning"
);

const shareStart = hostSource.indexOf("function _boxOverlapShare(");
assert.ok(shareStart >= 0, "measuring how far two lines cover each other must exist");
const shareBody = hostSource.slice(shareStart, hostSource.indexOf("\n}", shareStart));
assert.ok(
  shareBody.indexOf("Math.min(mine") >= 0,
  "measured against the smaller box: a short line dropped across a long one covers 3% of it and all of itself"
);

console.log("balloon centroid tests passed");
