/*
 * diagProbeText.jsx — what the balloon probe sees with, and without, the other
 * lines painted on the page.
 *
 * The align probe samples the merged image at the middle of the active text's
 * own box. Every other line is still painted there, so the region it finds is
 * the balloon minus the neighbours' ink, and where those glyphs cross the
 * balloon outline they bite into it. This dumps both regions, layer by layer,
 * so the difference can be looked at instead of guessed.
 *
 * Read-only: the document is closed without saving.
 */
#target photoshop

var LAB_RESULT = "";

(function () {
  var doc = app.open(new File(LAB.inFile));
  var out = { file: LAB.inFile, layers: [] };

  function bounds() {
    return _getCurrentSelectionBounds() || null;
  }

  var ids = [];
  _collectTextLayerIds(doc, ids, 80);

  var layers = [];
  function walk(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var l = container.layers[i];
      if (l.typename === "LayerSet") walk(l);
      else if (l.kind === LayerKind.TEXT && l.visible) layers.push(l);
    }
  }
  walk(doc);

  for (var n = 0; n < layers.length; n++) {
    var layer = layers[n];
    doc.activeLayer = layer;
    var box = _getCurrentTextLayerBounds();
    var row = { index: n, name: layer.name, box: box, withText: null, withoutText: null };

    try {
      layer.visible = false;
      _wandAt(Math.round(box.xMid), Math.round(box.yMid), LAB.wandTolerance);
      row.withText = bounds();
      layer.visible = true;
      _deselect();
    } catch (e1) {
      row.error = String(e1);
    }

    try {
      _setLayerVisibilityByIds(ids, false);
      row.activeAfterHide = String(doc.activeLayer.name);
      _wandAt(Math.round(box.xMid), Math.round(box.yMid), LAB.wandTolerance);
      row.withoutText = bounds();
      _setLayerVisibilityByIds(ids, true);
      row.activeAfterShow = String(doc.activeLayer.name);
      row.boxAfter = _getCurrentTextLayerBounds();
      _deselect();
    } catch (e2) {
      try { _setLayerVisibilityByIds(ids, true); } catch (e3) {}
      row.error2 = String(e2);
    }

    out.layers.push(row);
  }

  var file = new File(LAB.outFile);
  file.encoding = "UTF-8";
  file.open("w");
  file.write(jamJSON.stringify(out));
  file.close();

  doc.close(SaveOptions.DONOTSAVECHANGES);
  LAB_RESULT = "ok " + out.layers.length;
})();

LAB_RESULT;
