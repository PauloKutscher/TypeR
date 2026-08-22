/*
 * diagInvader.jsx — Align with a neighbouring line lying across the one being
 * centred.
 *
 * This is the page the typesetter actually has: the lines are dropped roughly
 * into place first, so one of them ends up on top of another. The balloon probe
 * samples the merged image with only the active layer hidden, so it lands on the
 * invader's glyph rather than on the balloon.
 *
 * For every layer it moves the nearest other line so that its ink covers the
 * middle of this one's box, presses Align, and records how far the result is
 * from where the professional put it. The page is closed without saving.
 */
#target photoshop

var LAB_RESULT = "";

(function () {
  var doc = app.open(new File(LAB.inFile));
  var out = { file: LAB.inFile, layers: [] };

  var layers = [];
  function walk(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var l = container.layers[i];
      if (l.typename === "LayerSet") walk(l);
      else if (l.kind === LayerKind.TEXT && l.visible) layers.push(l);
    }
  }
  walk(doc);

  // Ground truth, read before anything moves.
  var truth = [];
  for (var t = 0; t < layers.length; t++) {
    doc.activeLayer = layers[t];
    truth[t] = _getCurrentTextLayerBounds();
  }

  for (var n = 0; n < layers.length; n++) {
    var mine = truth[n];
    // The nearest other line is the one that would realistically be dropped
    // over this one.
    var pick = -1;
    var bestDistance = 0;
    for (var k = 0; k < layers.length; k++) {
      if (k === n) continue;
      var dx = truth[k].xMid - mine.xMid;
      var dy = truth[k].yMid - mine.yMid;
      var distance = dx * dx + dy * dy;
      if (pick < 0 || distance < bestDistance) {
        bestDistance = distance;
        pick = k;
      }
    }
    if (pick < 0) continue;

    var row = { index: n, invader: pick, truth: mine, after: null };

    // The control: the same Align on the page as the professional left it. Without
    // it there is no telling whether the invading line caused the error or the
    // page already had it.
    var control = doc.activeHistoryState;
    try {
      doc.activeLayer = layers[n];
      alignTextLayerToSelection({ resizeTextBox: false, padding: 0, phantomOffsetX: 0 });
      var clean = _getCurrentTextLayerBounds();
      row.cleanDx = clean.xMid - mine.xMid;
      row.cleanDy = clean.yMid - mine.yMid;
      row.cleanRegion = _hostState.lastAlignRegion || null;
      row.cleanPartition = _hostState.partition || null;
    } catch (controlError) {
      row.controlError = String(controlError);
    }
    try { doc.activeHistoryState = control; } catch (controlRewind) {}

    var history = doc.activeHistoryState;
    try {
      // Put the invader's middle exactly on this line's middle.
      doc.activeLayer = layers[pick];
      var now = _getCurrentTextLayerBounds();
      layers[pick].translate(mine.xMid - now.xMid, mine.yMid - now.yMid);

      doc.activeLayer = layers[n];
      row.result = alignTextLayerToSelection({ resizeTextBox: false, padding: 0, phantomOffsetX: 0 });
      var after = _getCurrentTextLayerBounds();
      row.after = after;
      row.region = _hostState.lastAlignRegion || null;
      row.partition = _hostState.partition || null;
      row.probe = _hostState.probe || null;
      row.dx = after.xMid - mine.xMid;
      row.dy = after.yMid - mine.yMid;
    } catch (alignError) {
      row.error = String(alignError);
    }
    try { doc.activeHistoryState = history; } catch (rewindError) {}
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
