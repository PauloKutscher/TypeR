// Diagnostic: why does makeWorkPath fail inside TypeR's shape scan?
// Creates a temp 300x300 doc, tests work-path creation in several contexts,
// closes without saving. Returns a "key=value | ..." report string.
(function () {
  var log = [];
  var doc = null;
  var oldDialogs = null;

  function reselect() {
    doc.selection.select([[50, 50], [250, 50], [250, 250], [50, 250]]);
  }

  function clearPaths() {
    try {
      for (var i = doc.pathItems.length - 1; i >= 0; i--) doc.pathItems[i].remove();
    } catch (e) {}
  }

  function selectionState() {
    try {
      var b = doc.selection.bounds;
      return b ? "present" : "gone";
    } catch (e) {
      return "gone";
    }
  }

  function amMakeWorkPath(tolerance) {
    var desc = new ActionDescriptor();
    var pathRef = new ActionReference();
    pathRef.putClass(charIDToTypeID("Path"));
    desc.putReference(charIDToTypeID("null"), pathRef);
    var fromRef = new ActionReference();
    fromRef.putProperty(charIDToTypeID("Path"), charIDToTypeID("fsel"));
    desc.putReference(charIDToTypeID("From"), fromRef);
    desc.putUnitDouble(charIDToTypeID("Tlrn"), charIDToTypeID("#Pxl"), tolerance);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
  }

  $.global._typerDiagAmOk = false;
  $.global._typerDiagAmErr = "";
  $.global._typerDiagAm = function () {
    $.global._typerDiagAmOk = false;
    $.global._typerDiagAmErr = "";
    try {
      amMakeWorkPath(2.0);
      $.global._typerDiagAmOk = true;
    } catch (amErr) {
      $.global._typerDiagAmErr = amErr.message;
    }
  };

  try {
    oldDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
    doc = app.documents.add(UnitValue(300, "px"), UnitValue(300, "px"), 72, "TypeR Diag", NewDocumentMode.RGB);

    // T1: DOM makeWorkPath inside suspendHistory (what the panel does today)
    reselect();
    var r1 = "ok";
    try {
      doc.suspendHistory("T1", "app.activeDocument.selection.makeWorkPath(2.0)");
    } catch (e1) {
      r1 = "ERR:" + e1.message;
    }
    log.push("T1-dom-in-suspend=" + r1);
    log.push("T1-paths=" + doc.pathItems.length);
    log.push("T1-sel=" + selectionState());
    clearPaths();

    // T2: AM make inside suspendHistory
    reselect();
    var r2 = "ok";
    try {
      doc.suspendHistory("T2", "$.global._typerDiagAm()");
      if (!$.global._typerDiagAmOk) r2 = "ERR:" + ($.global._typerDiagAmErr || "unknown");
    } catch (e2) {
      r2 = "ERR:" + e2.message;
    }
    log.push("T2-am-in-suspend=" + r2);
    log.push("T2-paths=" + doc.pathItems.length);
    log.push("T2-sel=" + selectionState());
    clearPaths();

    // T3: DOM makeWorkPath with no suspendHistory at all
    reselect();
    var r3 = "ok";
    try {
      doc.selection.makeWorkPath(2.0);
    } catch (e3) {
      r3 = "ERR:" + e3.message;
    }
    log.push("T3-dom-plain=" + r3);
    log.push("T3-paths=" + doc.pathItems.length);
    log.push("T3-sel=" + selectionState());

    // T4: can we read the work path points? (only if T3 left one)
    var r4 = "none";
    try {
      var wp = null;
      for (var p = 0; p < doc.pathItems.length; p++) {
        if (doc.pathItems[p].kind === PathKind.WORKPATH) wp = doc.pathItems[p];
      }
      if (wp) {
        var sub = wp.subPathItems;
        var pts = sub.length ? sub[0].pathPoints.length : 0;
        var anchor = pts ? sub[0].pathPoints[0].anchor : null;
        r4 = "subpaths:" + sub.length + ",points:" + pts + ",anchor:" + (anchor ? anchor.join(";") : "na");
      }
    } catch (e4) {
      r4 = "ERR:" + e4.message;
    }
    log.push("T4-read=" + r4);
    clearPaths();

    // T5: history states created by a plain (unsuspended) make+delete cycle
    var statesBefore = doc.historyStates.length;
    reselect();
    try {
      doc.selection.makeWorkPath(2.0);
      var delRef = new ActionReference();
      delRef.putProperty(charIDToTypeID("Path"), charIDToTypeID("WrkP"));
      var delDesc = new ActionDescriptor();
      delDesc.putReference(charIDToTypeID("null"), delRef);
      executeAction(charIDToTypeID("Dlt "), delDesc, DialogModes.NO);
      log.push("T5-history-delta=" + (doc.historyStates.length - statesBefore));
    } catch (e5) {
      log.push("T5=ERR:" + e5.message);
    }
  } catch (outer) {
    log.push("outer=ERR:" + outer.message);
  }

  try {
    if (oldDialogs !== null) app.displayDialogs = oldDialogs;
  } catch (dlgErr) {}
  try {
    if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
  } catch (closeErr) {}
  return log.join(" | ");
})();
