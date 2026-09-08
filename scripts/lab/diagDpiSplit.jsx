/*
 * diagDpiSplit.jsx — does the region split answer the same thing on a page whose
 * resolution is not 72 dpi?
 *
 * The reference pages are all 72 dpi, so every centring matrix ever run here has
 * had the anchor unit scale sit at 1. Task 18 was a whole class of defect that
 * only existed off 72 dpi. This opens a copy, aligns every text layer, records
 * the target and the cut, then changes the document resolution *without*
 * resampling — the same pixels, a different dpi — and does it again. The two
 * lists have to agree in document pixels.
 *
 * Never touches psd/ or true/: the caller passes a copy under .centering-lab/.
 *
 * LAB = { inFile, outFile, dpi, wandTolerance }
 */
#target photoshop

(function () {
  var out = { file: LAB.inFile, dpi: LAB.dpi || 300, passes: [], errors: [] };

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

  function collectTextLayers(container, found) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      if (layer.typename === "LayerSet") collectTextLayers(layer, found);
      else if (layer.kind === LayerKind.TEXT && layer.visible) found.push(layer);
    }
    return found;
  }

  function measure(doc, label) {
    var pass = { label: label, resolution: doc.resolution, layers: [] };
    var layers = collectTextLayers(doc, []);
    for (var n = 0; n < layers.length; n++) {
      var layer = layers[n];
      var history = doc.activeHistoryState;
      var row = { index: n, name: layer.name };
      try {
        doc.activeLayer = layer;
        var box = _getCurrentTextLayerBounds();
        row.box = { x: box.xMid, y: box.yMid };
        layer.visible = false;
        wandAt(Math.round(box.xMid), Math.round(box.yMid), LAB.wandTolerance || 20);
        layer.visible = true;
        doc.activeLayer = layer;
        _hostState.partition = { skip: "notReached", cuts: 0, share: 0, concavity: "", used: false };
        _hostState.lastAlignRegion = null;
        _hostState.centroidSkip = "";
        row.result = alignTextLayerToSelection({ resizeTextBox: false, padding: 0, phantomOffsetX: 0 });
        row.partition = {
          skip: _hostState.partition.skip, cuts: _hostState.partition.cuts,
          share: _hostState.partition.share, used: _hostState.partition.used
        };
        row.centroidSkip = _hostState.centroidSkip || "";
        row.target = _hostState.lastAlignRegion
          ? { x: _hostState.lastAlignRegion.targetX, y: _hostState.lastAlignRegion.targetY }
          : null;
      } catch (e) {
        note(label + "[" + n + "]", e);
        row.threw = String(e);
      }
      try { doc.activeHistoryState = history; } catch (e) { note(label + ".restore[" + n + "]", e); }
      pass.layers.push(row);
    }
    return pass;
  }

  var doc = null;
  try {
    var units = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    doc = app.open(new File(LAB.inFile));
    out.size = { width: doc.width.value, height: doc.height.value, resolution: doc.resolution };
    out.passes.push(measure(doc, "as opened"));
    // Re-open rather than rewind. Aligning a page hides and shows every layer,
    // and a layer reference read straight after a history rewind still reports
    // the state from before it — the second pass then finds nothing visible to
    // measure. A fresh open is the only state worth comparing against anyway.
    doc.close(SaveOptions.DONOTSAVECHANGES);
    doc = app.open(new File(LAB.inFile));
    // Same pixels, different dpi: ResampleMethod.NONE keeps every pixel where it is.
    doc.resizeImage(undefined, undefined, out.dpi, ResampleMethod.NONE);
    out.passes.push(measure(doc, "at " + out.dpi + " dpi"));
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
  LAB_RESULT = "layers=" + (out.passes.length ? out.passes[0].layers.length : 0) + " errors=" + out.errors.length;
})();
