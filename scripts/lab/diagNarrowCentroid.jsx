/*
 * diagNarrowCentroid.jsx — why does the narrowed selection come back without a
 * centroid?
 *
 * Replays, step by step and with the same numbers the host uses, what
 * `_openedSelectionCentroid` does over a selection that has just been narrowed to
 * the text's neighbourhood, reporting which guard gives up.
 *
 * Runs inside Photoshop with app/host.jsx already evaluated. Globals:
 *   LAB.inFile, LAB.outFile, LAB.index, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { index: LAB.index, steps: {}, errors: [] };
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
      if (isSet) collect(layer, acc);
      else {
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
    var layer = collect(doc, [])[LAB.index];
    if (!layer) throw new Error("no text layer at index " + LAB.index);
    doc.activeLayer = layer;
    out.name = layer.name;
    try { _deselect(); } catch (e) {}

    var ink = _getCurrentTextLayerBounds();
    var wasVisible = layer.visible;
    layer.visible = false;
    _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
    layer.visible = wasVisible;
    out.steps.wand = box(_getCurrentSelectionBounds());

    // Same neighbourhood box the host builds.
    var marginX = ink.width / 2;
    var marginY = ink.height / 2;
    var left = Math.max(0, Math.round(ink.left - marginX));
    var top = Math.max(0, Math.round(ink.top - marginY));
    var right = Math.min(Math.round(parseFloat(doc.width)), Math.round(ink.right + marginX));
    var bottom = Math.min(Math.round(parseFloat(doc.height)), Math.round(ink.bottom + marginY));
    out.steps.neighbourhood = { left: left, top: top, right: right, bottom: bottom };

    // The host holds the original selection in a channel while it intersects.
    var outerChannel = _createTempSelectionChannel(doc);
    out.steps.outerChannel = !!outerChannel;
    doc.selection.select([[left, top], [right, top], [right, bottom], [left, bottom]], SelectionType.INTERSECT, 0, false);
    out.steps.afterIntersect = box(_getCurrentSelectionBounds());

    // From here on, the steps of _openedSelectionCentroid, each guard reported.
    out.steps.workPathBeforeTrace = !!_findWorkPath(doc);
    var raw = _getCurrentSelectionBounds();
    var radius = _getAdaptiveSelectionOpenRadius(raw);
    out.steps.radius = radius;

    var innerChannel = _createTempSelectionChannel(doc);
    out.steps.innerChannel = !!innerChannel;
    out.steps.outerChannelSurvived = (function () {
      try { doc.channels.getByName(_TEMP_SELECTION_CHANNEL); return true; } catch (e) { return false; }
    })();

    if (radius > 0) {
      _modifySelectionBounds(-radius);
      var contracted = _getCurrentSelectionBounds();
      out.steps.contracted = box(contracted);
      if (contracted && contracted.width > 1 && contracted.height > 1) {
        _modifySelectionBounds(radius);
      } else {
        out.steps.contractedEmpty = true;
        try { doc.selection.load(innerChannel); } catch (e) {}
      }
    }
    var openedBounds = _getCurrentSelectionBounds();
    out.steps.openedBounds = box(openedBounds);
    out.steps.coversTooMuchPage = _regionCoversTooMuchPage(openedBounds);

    try {
      _makeWorkPathFromSelection(0.5);
      out.steps.makeWorkPath = "ok";
    } catch (makeError) {
      out.steps.makeWorkPath = "threw: " + (makeError.message || makeError);
    }
    var workPath = _findWorkPath(doc);
    out.steps.workPathFound = !!workPath;
    if (workPath) {
      var polygons = null;
      try {
        var tRead = new Date().getTime();
        polygons = _readPathAnchorPolygons(doc);
        out.steps.amReadMs = new Date().getTime() - tRead;
        out.steps.amRead = "ok";
      } catch (readError) {
        out.steps.amRead = "threw: " + (readError.message || readError);
      }
      var anchors = 0;
      if (polygons) for (var s = 0; s < polygons.length; s++) anchors += polygons[s].length;
      out.steps.polygons = polygons ? polygons.length : null;
      out.steps.anchors = anchors;
      out.steps.anchorsWithinBudget = anchors > 2 && anchors <= _MAX_BALLOON_PATH_ANCHORS;
      if (polygons && polygons.length) {
        out.steps.domCheck = _pathAnchorsMatchDom(workPath, polygons);
        try {
          out.steps.domFirstAnchor = workPath.subPathItems[0].pathPoints[0].anchor;
        } catch (e) { out.steps.domFirstAnchor = null; }
        out.steps.amFirstAnchor = polygons[0][0];
        var tMath = new Date().getTime();
        var centroid = _polygonCentroid(polygons);
        out.steps.centroidMathMs = new Date().getTime() - tMath;
        out.steps.centroid = centroid;
        if (centroid && openedBounds) {
          out.steps.insideEnvelope = centroid.x >= openedBounds.left - 1 && centroid.x <= openedBounds.right + 1 &&
            centroid.y >= openedBounds.top - 1 && centroid.y <= openedBounds.bottom + 1;
        }
      }
      try { _deleteWorkPath(); } catch (e) { try { workPath.remove(); } catch (e2) {} }
    }

    try { doc.selection.load(innerChannel); } catch (e) {}
    try { innerChannel.remove(); } catch (e) {}
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
  if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
  if (!LAB_RESULT) LAB_RESULT = "OK errors=" + out.errors.length;
})();
