/*
 * diagAnchorUnits.jsx — in which unit does the Action Manager report path
 * anchors? `_readPathAnchorPolygons` assumes points and scales by
 * `resolution / 72`; on a 300 dpi page every centroid was refused with
 * `unitMismatch`, so the assumption has to be measured, not argued.
 *
 * Wands one balloon, traces it, and prints the same anchor read three ways:
 * DOM (ruler pinned to pixels), Action Manager raw, and the unit id the
 * descriptor carries.
 *
 * Globals: LAB.inFile, LAB.outFile, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { inFile: LAB.inFile, errors: [] };
  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
    out.resolution = parseFloat(doc.resolution);
    out.page = { width: Math.round(parseFloat(doc.width)), height: Math.round(parseFloat(doc.height)) };

    // Same balloon the multi-bubble diagnostic finds first on this page
    _wandAt(LAB.x, LAB.y, LAB.wandTolerance || 20);
    out.selection = (function (b) {
      return b ? { left: b.left, top: b.top, width: b.width, height: b.height } : null;
    })(_getCurrentSelectionBounds());

    _makeWorkPathFromSelection(0.5);
    var workPath = _findWorkPath(doc);
    if (!workPath) throw new Error("no work path");

    var domAnchor = workPath.subPathItems[0].pathPoints[0].anchor;
    out.domAnchor = [domAnchor[0], domAnchor[1]];

    var ref = new ActionReference();
    ref.putProperty(charID.Property, stringIDToTypeID("pathContents"));
    ref.putEnumerated(charID.Path, charID.Ordinal, charID.Target);
    var contents = executeActionGet(ref).getObjectValue(stringIDToTypeID("pathContents"));
    var components = contents.getList(stringIDToTypeID("pathComponents"));
    var subpaths = components.getObjectValue(0).getList(stringIDToTypeID("subpathListKey"));
    var points = subpaths.getObjectValue(0).getList(stringIDToTypeID("points"));
    var anchor = points.getObjectValue(0).getObjectValue(stringIDToTypeID("anchor"));
    var horizontalId = stringIDToTypeID("horizontal");
    var verticalId = stringIDToTypeID("vertical");
    out.amAnchor = [anchor.getUnitDoubleValue(horizontalId), anchor.getUnitDoubleValue(verticalId)];
    out.amUnit = typeIDToStringID(anchor.getUnitDoubleType(horizontalId));
    out.ratioDomOverAm = [out.domAnchor[0] / out.amAnchor[0], out.domAnchor[1] / out.amAnchor[1]];
    out.assumedScale = out.resolution / 72;

    try { _deleteWorkPath(); } catch (deleteError) { try { workPath.remove(); } catch (removeError) {} }
  } catch (error) {
    out.errors.push(error && error.message ? error.message : String(error));
  } finally {
    try { if (doc) doc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) {}
    app.preferences.rulerUnits = oldUnits;
  }

  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out));
    file.close();
  } catch (writeError) {}

  LAB_RESULT = "dom=" + out.domAnchor + " am=" + out.amAnchor + " unit=" + out.amUnit +
    " ratio=" + out.ratioDomOverAm + " assumed=" + out.assumedScale + " errors=" + out.errors.length;
})();
