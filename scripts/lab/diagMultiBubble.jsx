/*
 * diagMultiBubble.jsx — why does the multi-bubble counter never move on some
 * documents?
 *
 * The user reports that on a PSD whose resolution is not 72 dpi the panel never
 * stores a single selection ("as if multi-bubble were off"), so the paste only
 * ever creates the first line. The panel reaches the host through exactly one
 * call, `getSelectionChanged()`, and drops the answer silently whenever it is an
 * error, a `noChange` or a payload without `width` (utils.js:831). This script
 * prints the RAW answer for two balloons captured one after the other, with the
 * selection monitor left alone between them — the sequence the panel really
 * runs, which no previous lab script covered.
 *
 * Balloon points are found by probing a grid with the same wand the panel uses
 * and keeping regions of plausible balloon size, so the script needs no text
 * layer and works on a raw scan.
 *
 * Runs inside Photoshop with app/host.jsx already evaluated. Globals:
 *   LAB.inFile, LAB.outFile, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { inFile: LAB.inFile, probes: [], captures: [], errors: [] };
  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }
  function box(b) {
    if (!b) return null;
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  }

  var oldUnits = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
    var pageWidth = parseFloat(doc.width);
    var pageHeight = parseFloat(doc.height);
    out.page = {
      width: Math.round(pageWidth),
      height: Math.round(pageHeight),
      resolution: parseFloat(doc.resolution),
      mode: String(doc.mode),
      layers: doc.layers.length,
    };
    startSelectionMonitoring();

    // Balloon hunt: wand a grid, keep regions between 0.1% and 7% of the page
    // that do not touch the border (the page background and the artwork fail
    // both tests). Two regions far apart is all the sequence needs.
    var found = [];
    var cols = 9;
    var rows = 13;
    var pageArea = pageWidth * pageHeight;
    for (var r = 1; r < rows && found.length < 12; r++) {
      for (var c = 1; c < cols && found.length < 12; c++) {
        var x = Math.round((pageWidth * c) / cols);
        var y = Math.round((pageHeight * r) / rows);
        var bounds = null;
        try {
          _wandAt(x, y, LAB.wandTolerance || 20);
          bounds = _getCurrentSelectionBounds();
        } catch (probeError) {
          bounds = null;
        }
        if (!bounds) continue;
        var area = bounds.width * bounds.height;
        var share = area / pageArea;
        var touchesBorder = bounds.left <= 2 || bounds.top <= 2 ||
          bounds.right >= pageWidth - 2 || bounds.bottom >= pageHeight - 2;
        if (share < 0.001 || share > 0.07 || touchesBorder) continue;
        var isNew = true;
        for (var f = 0; f < found.length; f++) {
          if (Math.abs(found[f].bounds.left - bounds.left) <= 5 &&
            Math.abs(found[f].bounds.top - bounds.top) <= 5) {
            isNew = false;
            break;
          }
        }
        if (!isNew) continue;
        found.push({ x: x, y: y, bounds: box(bounds), share: share });
      }
    }
    _deselect();
    out.probes = found;

    // The real panel sequence: wand a balloon, capture, wand the next one,
    // capture — the monitor is NOT reset between balloons, because the panel
    // does not reset it either, and its dedupe/union rules are half the suspects.
    _hostState.selectionMonitor.lastBounds = null;
    _hostState.selectionMonitor.lastBoundsKey = null;
    _hostState.selectionMonitor.multiWarnBounds = null;

    var stored = [];
    var limit = Math.min(found.length, 4);
    for (var i = 0; i < limit; i++) {
      var record = { index: i, probe: found[i] };
      try {
        _wandAt(found[i].x, found[i].y, LAB.wandTolerance || 20);
        record.before = box(_getCurrentSelectionBounds());
        _hostState.centroidSkip = "";
        var started = new Date().getTime();
        var raw = getSelectionChanged();
        record.ms = new Date().getTime() - started;
        record.raw = String(raw).substring(0, 400);
        record.after = box(_getCurrentSelectionBounds());
        record.selectionSurvived = !!record.after;
        record.centroidSkip = _hostState.centroidSkip || "";

        var parsed = null;
        try { parsed = jamJSON.parse(raw); } catch (parseError) { parsed = null; }
        record.flags = parsed ? {
          cleared: !!parsed.cleared,
          noChange: !!parsed.noChange,
          multipleSelections: !!parsed.multipleSelections,
          error: parsed.error ? parsed.message : null,
          hasWidth: typeof parsed.width === "number",
        } : { unparsed: true };

        // What the panel would do with this answer (utils.js:831 +
        // previewBlock.jsx:861 + multiBubbleHistory.js:28).
        var payload = parsed && parsed.multiSelection && parsed.multiSelection.length
          ? parsed.multiSelection[0] : null;
        var panelDrops = "";
        if (!parsed || parsed.error) panelDrops = "error";
        else if (parsed.noChange) panelDrops = "noChange";
        else if (parsed.cleared) panelDrops = "cleared -> wipes the batch";
        else if (parsed.multipleSelections) panelDrops = "multipleSelections -> shift tip";
        else if (typeof parsed.width !== "number") panelDrops = "no width";
        else {
          for (var s = 0; s < stored.length; s++) {
            if (Math.abs(stored[s].top - payload.top) <= 5 &&
              Math.abs(stored[s].left - payload.left) <= 5 &&
              Math.abs(stored[s].right - payload.right) <= 5 &&
              Math.abs(stored[s].bottom - payload.bottom) <= 5) {
              panelDrops = "duplicate of stored #" + s;
              break;
            }
          }
        }
        if (!panelDrops && payload) stored.push(payload);
        record.panelDrops = panelDrops || null;
        record.storedCount = stored.length;
        record.captured = payload ? {
          left: payload.left, top: payload.top, width: payload.width, height: payload.height,
          centroidX: payload.centroidX, centroidY: payload.centroidY,
        } : null;
      } catch (captureError) {
        note("capture " + i, captureError);
        record.threw = true;
      }
      out.captures.push(record);
    }
    out.finalStoredCount = stored.length;
  } catch (openError) {
    note("open", openError);
  } finally {
    try {
      if (doc) doc.close(SaveOptions.DONOTSAVECHANGES);
    } catch (closeError) {}
    app.preferences.rulerUnits = oldUnits;
  }

  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out));
    file.close();
  } catch (writeError) {
    note("write", writeError);
  }

  LAB_RESULT = "captures=" + out.captures.length +
    " stored=" + (out.finalStoredCount || 0) +
    " probes=" + out.probes.length +
    " errors=" + out.errors.length;
})();
