/*
 * diagSequence.jsx — align a whole page without putting it back between lines.
 *
 * The centring matrix restores the page to ground truth before every layer, so
 * it never reproduces what the typesetter does: press Align on one line, then
 * the next, on a page that is already changing under them. Two things can only
 * be seen that way — whether the answer depends on the order the lines are
 * processed in, and whether a second sweep moves anything.
 *
 * Three sweeps, each from the same starting page:
 *   forward   lines aligned in document order, nothing restored between them
 *   reverse   the same lines in the opposite order
 *   twice     forward, then forward again over the already-aligned page
 *
 * Never touches psd/ or true/: the caller passes a copy under .centering-lab/.
 *
 * LAB = { inFile, outFile, wandTolerance }
 */
#target photoshop

(function () {
  var out = { file: LAB.inFile, sweeps: {}, errors: [], identity: LAB.identity || null,
    flow: LAB.noSelection ? "shortcut" : "marquee", resize: false };
  var trace = null, currentAcquisition = null;
  var originalWand = _wandAt, originalOpen = _getAdaptiveOpenedSelectionBounds;
  var originalCentroid = _openedSelectionCentroid, originalSplit = _splitOutlineAtCusps;
  var originalPosition = _positionLayerWithinSelection;
  var previousDoc = app.documents.length ? app.activeDocument : null;
  var units = app.preferences.rulerUnits;

  function imageInputs(doc) {
    var rows = [], text = collect(doc, []);
    for (var k = 0; k < text.length; k++) {
      var bounds = text[k].bounds;
      rows.push({ id: text[k].id, visible: text[k].visible, bounds: [Number(bounds[0].as("px")), Number(bounds[1].as("px")), Number(bounds[2].as("px")), Number(bounds[3].as("px"))] });
    }
    return rows;
  }

  _wandAt = function (x, y, tolerance) {
    if (trace) trace.probes.push({ x: x, y: y, tolerance: tolerance, imageInputs: imageInputs(app.activeDocument) });
    return originalWand(x, y, tolerance);
  };
  _getAdaptiveOpenedSelectionBounds = function (bounds) {
    var parent = currentAcquisition;
    currentAcquisition = { rawBounds: bounds, outlines: [] };
    if (trace) trace.acquisitions.push(currentAcquisition);
    try { return originalOpen(bounds); } finally { currentAcquisition = parent; }
  };
  _openedSelectionCentroid = function (doc, bounds) {
    var target = originalCentroid(doc, bounds);
    if (currentAcquisition) currentAcquisition.outlines.push({ bounds: bounds, polygons: _hostState.lastOutline || null, target: target || null, skip: _hostState.centroidSkip || "" });
    return target;
  };
  _splitOutlineAtCusps = function (polygons, box, report) {
    var target = originalSplit(polygons, box, report);
    if (trace) trace.partition = { polygons: polygons, box: box, execution: report.execution || null, target: target || null };
    return target;
  };
  _positionLayerWithinSelection = function (selection, bounds, phantom, target) {
    if (trace) trace.position = { before: bounds, target: target || { x: selection.xMid + (Number(phantom) || 0), y: selection.yMid } };
    return originalPosition(selection, bounds, phantom, target);
  };

  function note(where, e) { out.errors.push(where + ": " + (e && e.message ? e.message : String(e))); }

  function wandAt(x, y, tolerance) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("null"), ref);
    var pos = new ActionDescriptor();
    pos.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), x);
    pos.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), y);
    desc.putObject(charIDToTypeID("T   "), stringIDToTypeID("paint"), pos);
    desc.putInteger(stringIDToTypeID("tolerance"), tolerance || 20);
    desc.putBoolean(stringIDToTypeID("contiguous"), true);
    desc.putBoolean(stringIDToTypeID("merged"), true);
    desc.putBoolean(stringIDToTypeID("antiAlias"), true);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
  }

  function collect(container, found) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      if (layer.typename === "LayerSet") collect(layer, found);
      else if (layer.kind === LayerKind.TEXT && layer.visible) found.push(layer);
    }
    return found;
  }

  function alignOne(doc, layer) {
    var row = { name: layer.name, id: layer.id, imageInputs: imageInputs(doc) };
    doc.activeLayer = layer;
    var box = _getCurrentTextLayerBounds();
    row.before = box;
    trace = { probes: [], acquisitions: [], partition: null, position: null };
    _deselect();
    if (!LAB.noSelection) {
      try {
        layer.visible = false;
        trace.probes.push({ x: Math.round(box.xMid), y: Math.round(box.yMid), tolerance: LAB.wandTolerance || 20, imageInputs: imageInputs(doc) });
        wandAt(Math.round(box.xMid), Math.round(box.yMid), LAB.wandTolerance || 20);
      } catch (probeError) {
        note("probe", probeError);
      } finally { layer.visible = true; }
    }
    doc.activeLayer = layer;
    _hostState.partition = { skip: "notReached", cuts: 0, share: 0, concavity: "", used: false };
    _hostState.probe = null;
    row.result = alignTextLayerToSelection({ resizeTextBox: false, padding: 0, phantomOffsetX: 0 });
    row.geometry = trace;
    row.probeDecision = _hostState.probe || null;
    trace = null;
    row.cuts = _hostState.partition.cuts;
    row.used = _hostState.partition.used;
    row.skip = _hostState.partition.skip;
    var after = _getCurrentTextLayerBounds();
    row.centre = { x: after.xMid, y: after.yMid };
    return row;
  }

  function sweep(doc, layers, order, repeats) {
    var rows = [];
    for (var r = 0; r < repeats; r++) {
      for (var i = 0; i < order.length; i++) {
        var n = order[i];
        try {
          var row = alignOne(doc, layers[n]);
          row.index = n;
          row.pass = r;
          rows.push(row);
        } catch (e) {
          note("sweep[" + n + "]", e);
          rows.push({ index: n, pass: r, threw: String(e) });
        }
      }
    }
    return rows;
  }

  var doc = null;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    doc = app.open(new File(LAB.inFile));
    var layers = collect(doc, []);
    out.layers = layers.length;
    var start = doc.activeHistoryState;

    var forwardOrder = [];
    for (var i = 0; i < layers.length; i++) forwardOrder[i] = i;
    var reverseOrder = [];
    for (var j = layers.length - 1; j >= 0; j--) reverseOrder[reverseOrder.length] = j;

    out.sweeps.forward = sweep(doc, layers, forwardOrder, 1);
    doc.activeHistoryState = start;
    out.sweeps.reverse = sweep(doc, layers, reverseOrder, 1);
    doc.activeHistoryState = start;
    out.sweeps.twice = sweep(doc, layers, forwardOrder, 2);
    doc.activeHistoryState = start;

    app.preferences.rulerUnits = units;
  } catch (e) {
    note("document", e);
  } finally {
    try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
    app.preferences.rulerUnits = units;
    if (previousDoc) { try { app.activeDocument = previousDoc; } catch (e) {} }
    _wandAt = originalWand;
    _getAdaptiveOpenedSelectionBounds = originalOpen;
    _openedSelectionCentroid = originalCentroid;
    _splitOutlineAtCusps = originalSplit;
    _positionLayerWithinSelection = originalPosition;
  }

  var file = new File(LAB.outFile);
  file.encoding = "UTF-8";
  file.open("w");
  file.write(jamJSON.stringify(out, null, 1));
  file.close();
  LAB_RESULT = "layers=" + (out.layers || 0) + " errors=" + out.errors.length;
})();
