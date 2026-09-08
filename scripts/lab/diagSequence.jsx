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
  var out = { file: LAB.inFile, sweeps: {}, errors: [] };

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
    var row = {};
    doc.activeLayer = layer;
    var box = _getCurrentTextLayerBounds();
    try {
      layer.visible = false;
      wandAt(Math.round(box.xMid), Math.round(box.yMid), LAB.wandTolerance || 20);
    } catch (probeError) {
      note("probe", probeError);
    }
    try { layer.visible = true; } catch (e) {}
    doc.activeLayer = layer;
    _hostState.partition = { skip: "notReached", cuts: 0, share: 0, concavity: "", used: false };
    row.result = alignTextLayerToSelection({ resizeTextBox: false, padding: 0, phantomOffsetX: 0 });
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
    var units = app.preferences.rulerUnits;
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
  }

  var file = new File(LAB.outFile);
  file.encoding = "UTF-8";
  file.open("w");
  file.write(jamJSON.stringify(out, null, 1));
  file.close();
  LAB_RESULT = "layers=" + (out.layers || 0) + " errors=" + out.errors.length;
})();
