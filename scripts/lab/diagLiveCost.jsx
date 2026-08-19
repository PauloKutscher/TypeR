/*
 * diagLiveCost.jsx — where do the frozen seconds go, on the selection the user
 * is holding RIGHT NOW, in the document that is open right now?
 *
 * The multi-bubble poll calls `getSelectionChanged()`, which opens the selection
 * before any cost guard runs: a temp alpha channel, then Contract/Expand by 10%
 * of the region's shortest side, retried at half the radius whenever the
 * contraction annihilates the selection. On a wand that escaped into the artwork
 * the region is the whole page, so on a 6331x8882 smart object interior that is
 * a 633 px morphological pair on 56 megapixels, up to eight times. The outline
 * trace never even runs — `_regionCoversTooMuchPage` refuses it — so measuring
 * the trace measured nothing.
 *
 * This times each stage separately: channel, one Contract, one Expand, the whole
 * real entry point. It reproduces the freeze on purpose, because that is the
 * number we need; it does not open or close any document and it puts the
 * selection back from a temp channel.
 *
 * Usage: open the page, enter the smart object, wand the black trousers, then
 * run scripts/lab/runLive.ps1. Globals: LAB.outFile.
 */

LAB_RESULT = "";

(function () {
  var out = { stages: [], errors: [] };
  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }
  function box(b) {
    if (!b) return null;
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  }
  function stage(label, fn) {
    var started = new Date().getTime();
    var value = null;
    var failed = null;
    try {
      value = fn();
    } catch (stageError) {
      failed = stageError && stageError.message ? stageError.message : String(stageError);
    }
    var record = { label: label, ms: new Date().getTime() - started };
    if (failed) record.error = failed;
    if (value) record.value = value;
    out.stages.push(record);
    return value;
  }

  var doc = null;
  try {
    doc = app.activeDocument;
  } catch (docError) {
    note("document", docError);
  }

  if (doc) {
    var oldUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    app.displayDialogs = DialogModes.NO;

    var selection = _getCurrentSelectionBounds();
    out.documentName = doc.name;
    out.selection = box(selection);
    out.page = _getDocumentPixelSize(doc);
    if (selection && out.page) {
      out.pageShare = (selection.width * selection.height) / (out.page.width * out.page.height);
      out.coversPage = _regionCoversTooMuchPage(selection);
    }
    out.openRadius = selection ? _getAdaptiveSelectionOpenRadius(selection) : 0;

    if (!selection) {
      note("selection", "no live selection: select the region first");
    } else {
      // Stage by stage, on a copy of the user's marquee. Everything is one
      // history state and the marquee comes back from the channel at the end.
      _withSuspendedHistory("TypeR Live Cost Probe", function () {
        var tempChannel = stage("create temp channel (stores the marquee)", function () {
          return _createTempSelectionChannel(doc);
        });
        if (!tempChannel) {
          note("channel", "could not store the selection");
          return null;
        }
        try {
          var radius = out.openRadius;
          stage("contract " + radius + "px", function () {
            _modifySelectionBounds(-radius);
            return box(_getCurrentSelectionBounds());
          });
          stage("expand " + radius + "px", function () {
            _modifySelectionBounds(radius);
            return box(_getCurrentSelectionBounds());
          });
          stage("load channel back", function () {
            doc.selection.load(tempChannel);
            return box(_getCurrentSelectionBounds());
          });
        } finally {
          try { doc.selection.load(tempChannel); } catch (restoreError) {}
          try { tempChannel.remove(); } catch (removeError) {}
        }
        return null;
      });

      // The real panel entry point, end to end, on the same marquee.
      stage("getSelectionChanged() (the real poll)", function () {
        _hostState.selectionMonitor.lastBounds = null;
        _hostState.selectionMonitor.lastBoundsKey = null;
        _hostState.selectionMonitor.multiWarnBounds = null;
        _hostState.centroidSkip = "";
        var raw = getSelectionChanged();
        var parsed = null;
        try { parsed = jamJSON.parse(raw); } catch (parseError) {}
        return {
          skip: _hostState.centroidSkip || "",
          cleared: !!(parsed && parsed.cleared),
          captured: !!(parsed && parsed.multiSelection && parsed.multiSelection.length),
          centroid: !!(parsed && parsed.multiSelection && parsed.multiSelection.length &&
            parsed.multiSelection[0].centroidX !== undefined),
        };
      });

      // The inline TextShapeR shape scan runs on the same marquee, on top of the
      // poll, and has no cost guard of its own.
      stage("getCurrentSelectionShape() (TextShapeR inline)", function () {
        var raw = getCurrentSelectionShape({ samples: 21 });
        var parsed = null;
        try { parsed = jamJSON.parse(raw); } catch (parseError) {}
        return {
          scan: parsed && parsed.scan ? parsed.scan : "",
          scanError: parsed && parsed.scanError ? parsed.scanError : "",
        };
      });
    }

    try { app.preferences.rulerUnits = oldUnits; } catch (unitsError) {}
    out.selectionAfter = box(_getCurrentSelectionBounds());
    out.selectionSurvived = !!out.selectionAfter;
    out.orphanChannel = false;
    try {
      doc.channels.getByName(_TEMP_SELECTION_CHANNEL);
      out.orphanChannel = true;
    } catch (noChannel) {}
  }

  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out, "\t"));
    file.close();
  } catch (writeError) {
    note("write", writeError);
  }

  var lines = [];
  lines.push("doc=" + (out.documentName || "-") +
    " page=" + (out.page ? out.page.width + "x" + out.page.height : "-") +
    " selection=" + (out.selection ? out.selection.width + "x" + out.selection.height : "none") +
    " share=" + (out.pageShare !== undefined ? (out.pageShare * 100).toFixed(1) + "%" : "-") +
    " coversPage=" + out.coversPage +
    " openRadius=" + out.openRadius + "px");
  for (var i = 0; i < out.stages.length; i++) {
    var s = out.stages[i];
    var extra = "";
    if (s.value && s.value.width !== undefined) extra = " -> " + s.value.width + "x" + s.value.height;
    else if (s.value && s.value.skip !== undefined) extra = " skip=" + (s.value.skip || "-") +
      " captured=" + s.value.captured + " centroid=" + s.value.centroid + " cleared=" + s.value.cleared;
    else if (s.value && s.value.scan !== undefined) extra = " scan=" + s.value.scan +
      (s.value.scanError ? " (" + s.value.scanError + ")" : "");
    else if (s.value === null || s.value === undefined) extra = " -> none";
    lines.push(s.label + " = " + s.ms + "ms" + extra + (s.error ? " ERROR " + s.error : ""));
  }
  lines.push("selectionSurvived=" + out.selectionSurvived + " orphanChannel=" + out.orphanChannel);
  LAB_RESULT = lines.join("\n") + (out.errors.length ? "\nerrors: " + out.errors.join(" ; ") : "");
})();
LAB_RESULT;
