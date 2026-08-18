/*
 * diagCentroid.jsx — step-by-step trace of _getSelectionAreaCentroid on one
 * text layer, to find where the opened selection and the traced outline stop
 * agreeing.
 *
 * Runs inside Photoshop with app/host.jsx already evaluated. Globals expected:
 *   LAB.inFile   PSD copy to open (never an original)
 *   LAB.outFile  JSON report to write
 *   LAB.index    index of the text layer in document order
 *   LAB.wandTolerance
 *
 * Never saves the document.
 */

LAB_RESULT = "";

(function () {
  var out = {
    inFile: LAB.inFile,
    index: LAB.index,
    steps: {},
    errors: []
  };

  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }

  // Same bezier flattening the host does, with the step count exposed so the
  // sweep can tell a coarse polyline apart from a coarse path.
  function _flattenPath(pathItem, steps) {
    var polygons = [];
    for (var s = 0; s < pathItem.subPathItems.length; s++) {
      var points = pathItem.subPathItems[s].pathPoints;
      var count = points.length;
      if (count < 3) continue;
      var poly = [];
      for (var i = 0; i < count; i++) {
        var current = points[i];
        var next = points[(i + 1) % count];
        var a = current.anchor;
        var c1 = current.rightDirection;
        var c2 = next.leftDirection;
        var b = next.anchor;
        var straight = c1[0] === a[0] && c1[1] === a[1] && c2[0] === b[0] && c2[1] === b[1];
        var n = straight ? 1 : steps;
        for (var t = 0; t < n; t++) {
          var u = t / n;
          var v = 1 - u;
          poly.push([
            v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0],
            v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1]
          ]);
        }
      }
      if (poly.length >= 3) polygons.push(poly);
    }
    return polygons;
  }

  function collect(container, acc) {    for (var i = 0; i < container.layers.length; i++) {
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
  var oldDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
    var layers = collect(doc, []);
    out.textLayers = layers.length;
    var layer = layers[LAB.index];
    if (!layer) throw new Error("no text layer at index " + LAB.index);
    doc.activeLayer = layer;
    out.name = layer.name;
    try { _deselect(); } catch (e) {}

    var ink = _getCurrentTextLayerBounds();
    out.steps.ink = ink;

    // Same probe the plugin uses now: inside the ink, glyphs hidden.
    var wasVisible = layer.visible;
    layer.visible = false;
    _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
    layer.visible = wasVisible;

    out.steps.raw = _getCurrentSelectionBounds();
    out.steps.openRadiusFromRaw = _getAdaptiveSelectionOpenRadius(out.steps.raw);
    out.steps.opened = _getAdaptiveOpenedSelectionBounds(out.steps.raw);
    // Does the helper leave the selection opened, or restore the raw one?
    out.steps.liveAfterOpenedCall = _getCurrentSelectionBounds();

    // Manual replay of _getSelectionAreaCentroid with every intermediate value.
    var replay = {};
    replay.radius = _getAdaptiveSelectionOpenRadius(out.steps.opened);
    var temp = _createTempSelectionChannel(doc);
    replay.tempChannel = !!temp;
    try {
      _modifySelectionBounds(-replay.radius);
      replay.contracted = _getCurrentSelectionBounds() || null;
      if (replay.contracted && replay.contracted.width > 1 && replay.contracted.height > 1) {
        _modifySelectionBounds(replay.radius);
        replay.expanded = _getCurrentSelectionBounds() || null;
      } else {
        replay.restoredRawBecauseContractedEmpty = true;
        doc.selection.load(temp);
        replay.expanded = _getCurrentSelectionBounds() || null;
      }
      _makeWorkPathFromSelection(1.0);
      var wp = _findWorkPath(doc);
      replay.workPath = !!wp;
      if (wp) {
        var anchors = 0;
        for (var s = 0; s < wp.subPathItems.length; s++) anchors += wp.subPathItems[s].pathPoints.length;
        replay.anchors = anchors;
        replay.subPaths = wp.subPathItems.length;
        var polys = _readPathPolygons(wp);
        replay.polygons = polys.length;
        var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
        for (var p = 0; p < polys.length; p++) {
          for (var i = 0; i < polys[p].length; i++) {
            var pt = polys[p][i];
            if (pt[0] < minX) minX = pt[0];
            if (pt[0] > maxX) maxX = pt[0];
            if (pt[1] < minY) minY = pt[1];
            if (pt[1] > maxY) maxY = pt[1];
          }
        }
        replay.polyBbox = { left: minX, top: minY, right: maxX, bottom: maxY, width: maxX - minX, height: maxY - minY };
        var centroid = _polygonCentroid(polys);
        replay.polyCentroid = centroid;
        if (centroid && replay.expanded) {
          replay.u = (centroid.x - minX) / (maxX - minX);
          replay.v = (centroid.y - minY) / (maxY - minY);
          replay.mapped = {
            x: replay.expanded.left + replay.u * replay.expanded.width,
            y: replay.expanded.top + replay.v * replay.expanded.height
          };
        }
        try { _deleteWorkPath(); } catch (e) { try { wp.remove(); } catch (e2) {} }
      }
    } catch (replayError) {
      note("replay", replayError);
    }
    try { doc.selection.load(temp); } catch (e) {}
    try { temp.remove(); } catch (e) {}
    out.steps.replay = replay;

    // Is the traced outline itself faithful? Sweep the make-work-path tolerance
    // and the curve flattening density: a coarse outline biases the centroid.
    // A region that escaped the balloon has tens of thousands of anchors: tracing
    // it at 0.5 px and walking it through the DOM froze Photoshop for over an
    // hour. The host refuses to trace such a region; so does this diagnostic.
    var tooBigToTrace = _regionCoversTooMuchPage(out.steps.raw);
    out.steps.tooBigToTrace = tooBigToTrace;
    var sweep = [];
    var tolerances = tooBigToTrace ? [] : [0.5, 1.0, 2.0];
    for (var ti = 0; ti < tolerances.length; ti++) {
      var entry = { tolerance: tolerances[ti] };
      var temp2 = _createTempSelectionChannel(doc);
      var units2 = app.preferences.rulerUnits;
      try {
        app.preferences.rulerUnits = Units.PIXELS;
        // Same opening the centroid path uses.
        _modifySelectionBounds(-replay.radius);
        _modifySelectionBounds(replay.radius);
        var tMake = new Date().getTime();
        _makeWorkPathFromSelection(tolerances[ti]);
        entry.msMake = new Date().getTime() - tMake;
        var wp2 = _findWorkPath(doc);
        if (wp2) {
          var anchors2 = 0;
          for (var s2 = 0; s2 < wp2.subPathItems.length; s2++) anchors2 += wp2.subPathItems[s2].pathPoints.length;
          entry.anchors = anchors2;
          var tRead = new Date().getTime();
          _readPathPolygons(wp2);
          entry.msRead = new Date().getTime() - tRead;
          for (var f = 0; f < 2; f++) {
            var steps = f === 0 ? 6 : 24;
            var polys2 = _flattenPath(wp2, steps);
            var c2 = _polygonCentroid(polys2);
            var minX2 = 1e9, maxX2 = -1e9, minY2 = 1e9, maxY2 = -1e9;
            for (var pi = 0; pi < polys2.length; pi++) {
              for (var qi = 0; qi < polys2[pi].length; qi++) {
                var q = polys2[pi][qi];
                if (q[0] < minX2) minX2 = q[0];
                if (q[0] > maxX2) maxX2 = q[0];
                if (q[1] < minY2) minY2 = q[1];
                if (q[1] > maxY2) maxY2 = q[1];
              }
            }
            entry["steps" + steps] = {
              centroid: c2,
              bbox: { left: minX2, top: minY2, right: maxX2, bottom: maxY2, width: maxX2 - minX2, height: maxY2 - minY2 }
            };
          }
          try { _deleteWorkPath(); } catch (e) { try { wp2.remove(); } catch (e2) {} }
        }
      } catch (sweepError) {
        entry.error = String(sweepError.message || sweepError);
      }
      try { app.preferences.rulerUnits = units2; } catch (e) {}
      try { doc.selection.load(temp2); } catch (e) {}
      try { temp2.remove(); } catch (e) {}
      sweep.push(entry);
    }
    out.steps.sweep = sweep;

    // Where the centroid's time actually goes, step by step.
    var cost = {};
    if (tooBigToTrace) cost.skipped = "region covers too much of the page";
    var units3 = app.preferences.rulerUnits;
    if (tooBigToTrace) { out.steps.cost = cost; } else
    try {
      app.preferences.rulerUnits = Units.PIXELS;
      var t0 = new Date().getTime();
      var temp3 = _createTempSelectionChannel(doc);
      cost.tempChannel = new Date().getTime() - t0;
      t0 = new Date().getTime();
      _modifySelectionBounds(-replay.radius);
      cost.contract = new Date().getTime() - t0;
      t0 = new Date().getTime();
      _modifySelectionBounds(replay.radius);
      cost.expand = new Date().getTime() - t0;
      t0 = new Date().getTime();
      _getCurrentSelectionBounds();
      cost.readBounds = new Date().getTime() - t0;
      t0 = new Date().getTime();
      _makeWorkPathFromSelection(0.5);
      cost.makePath = new Date().getTime() - t0;
      t0 = new Date().getTime();
      var polys3 = _readPathAnchorPolygons(doc);
      cost.amRead = new Date().getTime() - t0;
      cost.anchors = 0;
      for (var pi3 = 0; polys3 && pi3 < polys3.length; pi3++) cost.anchors += polys3[pi3].length;
      t0 = new Date().getTime();
      _polygonCentroid(polys3);
      cost.centroidMath = new Date().getTime() - t0;
      t0 = new Date().getTime();
      _pathAnchorsMatchDom(_findWorkPath(doc), polys3);
      cost.domCheck = new Date().getTime() - t0;
      t0 = new Date().getTime();
      try { _deleteWorkPath(); } catch (e) {}
      cost.deletePath = new Date().getTime() - t0;
      t0 = new Date().getTime();
      try { doc.selection.load(temp3); } catch (e) {}
      cost.loadChannel = new Date().getTime() - t0;
      t0 = new Date().getTime();
      try { temp3.remove(); } catch (e) {}
      cost.removeChannel = new Date().getTime() - t0;
    } catch (costError) {
      cost.error = String(costError.message || costError);
    }
    try { app.preferences.rulerUnits = units3; } catch (e) {}
    out.steps.cost = cost;

    // The narrowing path: does it come back with a centroid?
    try {
      var narrow = {};
      try { _deselect(); } catch (e) {}
      var wasVis = layer.visible;
      layer.visible = false;
      _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
      layer.visible = wasVis;
      narrow.wand = _getCurrentSelectionBounds() || null;
      narrow.coversTooMuch = typeof _regionCoversTooMuchPage === "function"
        ? _regionCoversTooMuchPage(narrow.wand)
        : null;
      var opened = _checkSelection({ adaptiveOpen: true });
      narrow.openedError = opened && opened.error ? opened.error : null;
      narrow.openedCentroid = opened && opened.centroid ? opened.centroid : null;
      if (typeof _narrowSelectionToTextNeighbourhood === "function") {
        var narrowed = _narrowSelectionToTextNeighbourhood();
        narrow.narrowedBounds = narrowed && !narrowed.error
          ? { left: narrowed.left, top: narrowed.top, width: narrowed.width, height: narrowed.height, xMid: narrowed.xMid, yMid: narrowed.yMid }
          : null;
        narrow.narrowedError = narrowed && narrowed.error ? narrowed.error : (narrowed ? null : "null");
        narrow.narrowedCentroid = narrowed && narrowed.centroid ? narrowed.centroid : null;
      }
      try { _deselect(); } catch (e) {}
      out.steps.narrow = narrow;
    } catch (narrowError) {
      note("narrow", narrowError);
    }

    // The number the engine actually uses, on the same live selection.
    try {
      var tEngine = new Date().getTime();
      out.steps.engineCentroid = _getSelectionAreaCentroid(out.steps.opened || out.steps.raw);
      out.steps.engineCentroidMs = new Date().getTime() - tEngine;
    } catch (e) {
      note("engineCentroid", e);
    }
    out.steps.liveAfterCentroid = _getCurrentSelectionBounds() || null;
    try { _deselect(); } catch (e) {}
  } catch (docError) {
    note("document", docError);
  }

  try { app.preferences.rulerUnits = oldUnits; } catch (e) {}
  try { app.displayDialogs = oldDialogs; } catch (e) {}

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
