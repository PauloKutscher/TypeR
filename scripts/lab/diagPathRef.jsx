/*
 * diagPathRef.jsx — the Action Manager read of a freshly made work path came back
 * empty in one case. This compares reading `pathContents` from the *targeted*
 * path against reading it from the work path's own index, on the same outline,
 * plus what the DOM sees.
 *
 * Globals: LAB.inFile, LAB.outFile, LAB.index, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { index: LAB.index, errors: [] };
  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
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
  function countFromDescriptor(ref) {
    var contents = executeActionGet(ref).getObjectValue(stringIDToTypeID("pathContents"));
    var components = contents.getList(stringIDToTypeID("pathComponents"));
    var subpathsId = stringIDToTypeID("subpathListKey");
    var pointsId = stringIDToTypeID("points");
    var subpaths = 0;
    var points = 0;
    for (var c = 0; c < components.count; c++) {
      var list = components.getObjectValue(c).getList(subpathsId);
      subpaths += list.count;
      for (var s = 0; s < list.count; s++) points += list.getObjectValue(s).getList(pointsId).count;
    }
    return { components: components.count, subpaths: subpaths, points: points };
  }

  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
    var layer = collect(doc, [])[LAB.index];
    doc.activeLayer = layer;
    try { _deselect(); } catch (e) {}

    var ink = _getCurrentTextLayerBounds();
    var wasVisible = layer.visible;
    layer.visible = false;
    _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
    layer.visible = wasVisible;

    // Narrow exactly like the host does, then open exactly like the host does.
    var marginX = ink.width / 2;
    var marginY = ink.height / 2;
    var left = Math.max(0, Math.round(ink.left - marginX));
    var top = Math.max(0, Math.round(ink.top - marginY));
    var right = Math.min(Math.round(parseFloat(doc.width)), Math.round(ink.right + marginX));
    var bottom = Math.min(Math.round(parseFloat(doc.height)), Math.round(ink.bottom + marginY));
    doc.selection.select([[left, top], [right, top], [right, bottom], [left, bottom]], SelectionType.INTERSECT, 0, false);

    var channel = _createTempSelectionChannel(doc);
    var radius = _getAdaptiveSelectionOpenRadius(_getCurrentSelectionBounds());
    out.radius = radius;
    var attempt = radius;
    var opened = null;
    while (attempt >= 1 && !opened) {
      if (attempt !== radius) { try { doc.selection.load(channel); } catch (e) { break; } }
      try {
        _modifySelectionBounds(-attempt);
        var contracted = _getCurrentSelectionBounds();
        if (contracted && contracted.width > 1 && contracted.height > 1) {
          _modifySelectionBounds(attempt);
          var candidate = _getCurrentSelectionBounds();
          if (candidate && candidate.width * candidate.height >= 200) opened = candidate;
        }
      } catch (e) {}
      if (!opened) attempt = Math.floor(attempt / 2);
    }
    out.acceptedRadius = attempt;
    out.opened = opened ? { left: opened.left, top: opened.top, width: opened.width, height: opened.height } : null;

    _makeWorkPathFromSelection(0.5);

    // Reading by target enumeration, which is what the host does.
    var byTarget = new ActionReference();
    byTarget.putProperty(charID.Property, stringIDToTypeID("pathContents"));
    byTarget.putEnumerated(charID.Path, charID.Ordinal, charID.Target);
    try { out.byTarget = countFromDescriptor(byTarget); } catch (e) { out.byTarget = "threw: " + (e.message || e); }

    // Reading by the work path's index in the paths panel.
    var workIndex = 0;
    var domSubPaths = null;
    var domPoints = null;
    try {
      for (var i = 0; i < doc.pathItems.length; i++) {
        if (doc.pathItems[i].kind === PathKind.WORKPATH) {
          workIndex = i + 1;
          domSubPaths = doc.pathItems[i].subPathItems.length;
          break;
        }
      }
    } catch (e) { note("workIndex", e); }
    out.workIndex = workIndex;
    out.domSubPaths = domSubPaths;

    if (workIndex) {
      var byIndex = new ActionReference();
      byIndex.putProperty(charID.Property, stringIDToTypeID("pathContents"));
      byIndex.putIndex(charID.Path, workIndex);
      try { out.byIndex = countFromDescriptor(byIndex); } catch (e) { out.byIndex = "threw: " + (e.message || e); }
    }

    try { _deleteWorkPath(); } catch (e) {}
    try { doc.selection.load(channel); } catch (e) {}
    try { channel.remove(); } catch (e) {}
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
  } catch (writeError) { LAB_RESULT = "ERROR write: " + writeError; }
  if (doc) { try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (e) {} }
  if (!LAB_RESULT) LAB_RESULT = "OK errors=" + out.errors.length;
})();
