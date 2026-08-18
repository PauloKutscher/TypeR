/*
 * diagNarrow.jsx — checks one thing only: when the contiguous fill escapes the
 * balloon, does the narrowing path come back with a usable centroid?
 *
 * Deliberately does not trace the escaped region: at 0.5 px tolerance that path
 * has tens of thousands of anchors and reading it through the DOM takes minutes,
 * which is exactly why the host refuses to trace it.
 *
 * Runs inside Photoshop with app/host.jsx already evaluated. Globals:
 *   LAB.inFile, LAB.outFile, LAB.index, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { inFile: LAB.inFile, index: LAB.index, errors: [] };
  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }
  function box(b) {
    if (!b) return null;
    return { left: b.left, top: b.top, width: b.width, height: b.height, xMid: b.xMid, yMid: b.yMid };
  }
  function collect(container, acc) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      var isSet = false;
      try { isSet = layer.typename === "LayerSet"; } catch (e) {}
      if (isSet) {
        collect(layer, acc);
      } else {
        var isText = false;
        try { isText = layer.kind === LayerKind.TEXT; } catch (e) {}
        if (isText) acc.push(layer);
      }
    }
    return acc;
  }

  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
    var layers = collect(doc, []);
    var layer = layers[LAB.index];
    if (!layer) throw new Error("no text layer at index " + LAB.index);
    doc.activeLayer = layer;
    out.name = layer.name;
    try { _deselect(); } catch (e) {}

    var ink = _getCurrentTextLayerBounds();
    out.ink = box(ink);

    var wasVisible = layer.visible;
    layer.visible = false;
    _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
    layer.visible = wasVisible;

    out.wand = box(_getCurrentSelectionBounds());
    out.coversTooMuch = _regionCoversTooMuchPage(out.wand);

    var narrowed = _narrowSelectionToTextNeighbourhood();
    out.narrowed = narrowed && !narrowed.error ? box(narrowed) : null;
    out.narrowedError = narrowed ? (narrowed.error || null) : "null";
    out.narrowedCentroid = narrowed && narrowed.centroid ? narrowed.centroid : null;
    out.liveAfterNarrow = box(_getCurrentSelectionBounds());
    try { _deselect(); } catch (e) {}
  } catch (docError) {
    note("document", docError);
  }

  try { app.preferences.rulerUnits = oldUnits; } catch (e) {}
  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out, "\t"));
    file.close();
  } catch (writeError) {
    LAB_RESULT = "ERROR write: " + writeError;
  }
  if (doc) {
    try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {}
  }
  if (!LAB_RESULT) LAB_RESULT = "OK errors=" + out.errors.length;
})();
