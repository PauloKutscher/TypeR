/*
 * diagCapture.jsx — checks one thing only: does a marquee survive the
 * multi-bubble capture, whatever its size?
 *
 * `getSelectionChanged()` is the real panel entry point: it opens the selection,
 * traces the balloon outline for the centroid, and `Make Work Path` consumes the
 * selection while doing it. A typesetter with multi-bubble on keeps working in
 * Photoshop (cleaning SFX, selecting large areas), so losing the marquee is not
 * an acceptable side effect of reading it — and the panel reads an empty document
 * as "the user deselected", which also wipes the stored batch.
 *
 * Each case makes a selection, calls the real entry point, and reports whether a
 * selection is still live afterwards, why the centroid was refused, and how long
 * it took. Rectangles are sized as a fraction of the page so the same script is
 * meaningful on any raw size; the wand case covers the irregular real balloon.
 *
 * Runs inside Photoshop with app/host.jsx already evaluated. Globals:
 *   LAB.inFile, LAB.outFile, LAB.index, LAB.wandTolerance
 */

LAB_RESULT = "";

(function () {
  var out = { inFile: LAB.inFile, cases: [], sequences: [], errors: [] };
  function note(where, err) {
    out.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }
  function box(b) {
    if (!b) return null;
    return { left: b.left, top: b.top, width: b.width, height: b.height };
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
    out.page = { width: Math.round(parseFloat(doc.width)), height: Math.round(parseFloat(doc.height)) };
    startSelectionMonitoring();

    // Every case starts from a clean monitor: a selection that contains the
    // previous one is reported as a Shift-add union, and that path never reaches
    // the capture we are testing.
    function runCase(name, makeSelection) {
      var record = { name: name };
      try {
        _deselect();
        _hostState.selectionMonitor.lastBounds = null;
        _hostState.selectionMonitor.lastBoundsKey = null;
        _hostState.selectionMonitor.multiWarnBounds = null;
        _hostState.centroidSkip = "";
        makeSelection();
        record.before = box(_getCurrentSelectionBounds());
        var started = new Date().getTime();
        var raw = getSelectionChanged();
        record.ms = new Date().getTime() - started;
        var parsed = jamJSON.parse(raw);
        record.after = box(_getCurrentSelectionBounds());
        record.selectionSurvived = !!record.after;
        record.centroidSkip = _hostState.centroidSkip || "";
        record.captured = parsed && parsed.multiSelection && parsed.multiSelection.length
          ? {
            width: parsed.multiSelection[0].width,
            height: parsed.multiSelection[0].height,
            centroidX: parsed.multiSelection[0].centroidX,
            centroidY: parsed.multiSelection[0].centroidY,
          }
          : null;
        record.flags = {
          cleared: !!(parsed && parsed.cleared),
          noChange: !!(parsed && parsed.noChange),
          multipleSelections: !!(parsed && parsed.multipleSelections),
          error: parsed && parsed.error ? parsed.message : null,
        };
        // What the panel does on the next poll: an empty document reads back as a
        // user deselect and clears the whole stored batch.
        record.nextPollWouldClear = !record.after;
      } catch (caseError) {
        note(name, caseError);
        record.threw = true;
      }
      out.cases.push(record);
    }

    function rectangleOfPageShare(share) {
      var pageWidth = parseFloat(doc.width);
      var pageHeight = parseFloat(doc.height);
      var side = Math.sqrt(share);
      var width = Math.round(pageWidth * side);
      var height = Math.round(pageHeight * side);
      var left = Math.round((pageWidth - width) / 2);
      var top = Math.round((pageHeight - height) / 2);
      doc.selection.select([
        [left, top], [left + width, top], [left + width, top + height], [left, top + height],
      ], SelectionType.REPLACE, 0, false);
    }

    function irregularSelection(share) {
      // A hand-drawn lasso is neither smooth nor rectangular: this zig-zags the
      // outline so the traced path has anchors in proportion to its size.
      var pageWidth = parseFloat(doc.width);
      var pageHeight = parseFloat(doc.height);
      var side = Math.sqrt(share);
      var width = Math.round(pageWidth * side);
      var height = Math.round(pageHeight * side);
      var left = Math.round((pageWidth - width) / 2);
      var top = Math.round((pageHeight - height) / 2);
      var steps = 40;
      var points = [];
      for (var i = 0; i <= steps; i++) {
        points.push([left + Math.round((width * i) / steps), top + (i % 2 ? 0 : Math.round(height * 0.08))]);
      }
      for (var j = 0; j <= steps; j++) {
        points.push([left + width - Math.round((width * j) / steps), top + height - (j % 2 ? 0 : Math.round(height * 0.08))]);
      }
      doc.selection.select(points, SelectionType.REPLACE, 0, false);
    }

    runCase("rect 2% of page", function () { rectangleOfPageShare(0.02); });
    runCase("rect 10% of page", function () { rectangleOfPageShare(0.10); });
    runCase("rect 20% of page", function () { rectangleOfPageShare(0.20); });
    runCase("rect 24% of page", function () { rectangleOfPageShare(0.24); });
    runCase("rect 35% of page", function () { rectangleOfPageShare(0.35); });
    runCase("rect 60% of page", function () { rectangleOfPageShare(0.60); });
    runCase("feathered rect 20%", function () {
      var pageWidth = parseFloat(doc.width);
      var pageHeight = parseFloat(doc.height);
      var width = Math.round(pageWidth * 0.45);
      var height = Math.round(pageHeight * 0.45);
      var left = Math.round((pageWidth - width) / 2);
      var top = Math.round((pageHeight - height) / 2);
      doc.selection.select([
        [left, top], [left + width, top], [left + width, top + height], [left, top + height],
      ], SelectionType.REPLACE, 5, false);
    });
    runCase("lasso-like 6%", function () { irregularSelection(0.06); });
    runCase("lasso-like 20%", function () { irregularSelection(0.20); });
    runCase("wand on page background", function () { _wandAt(5, 5, LAB.wandTolerance || 20); });

    // The realistic balloon: an irregular wand region around a real text layer,
    // which is what the typesetter actually captures in multi-bubble mode.
    var layers = collect(doc, []);
    var layer = layers[LAB.index || 0];
    if (layer) {
      doc.activeLayer = layer;
      out.layerName = layer.name;
      runCase("wand on balloon", function () {
        var ink = _getCurrentTextLayerBounds();
        var wasVisible = layer.visible;
        layer.visible = false;
        _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
        layer.visible = wasVisible;
      });
    }

    // The panel does not call the capture once on a clean monitor: it polls five
    // times a second, and the inline TextShapeR asks for the selection shape on
    // top of that. Both consume the marquee to trace it, so the sequence is what
    // has to be safe, not the single call.
    function runSequence(name, makeSelection) {
      var record = { name: name, steps: [] };
      try {
        _deselect();
        _hostState.selectionMonitor.lastBounds = null;
        _hostState.selectionMonitor.lastBoundsKey = null;
        _hostState.selectionMonitor.multiWarnBounds = null;
        makeSelection();
        record.before = box(_getCurrentSelectionBounds());
        function step(label, fn) {
          _hostState.centroidSkip = "";
          var started = new Date().getTime();
          var raw = null;
          try { raw = fn(); } catch (stepError) { note(name + "/" + label, stepError); }
          var parsed = null;
          try { parsed = jamJSON.parse(raw); } catch (parseError) {}
          var live = _getCurrentSelectionBounds();
          record.steps.push({
            label: label,
            ms: new Date().getTime() - started,
            survived: !!live,
            bounds: box(live),
            skip: _hostState.centroidSkip || "",
            scan: parsed && parsed.scan ? parsed.scan : null,
            scanError: parsed && parsed.scanError ? parsed.scanError : null,
            flags: parsed ? {
              cleared: !!parsed.cleared,
              noChange: !!parsed.noChange,
              multipleSelections: !!parsed.multipleSelections,
              captured: !!(parsed.multiSelection && parsed.multiSelection.length),
            } : null,
          });
        }
        step("capture 1", function () { return getSelectionChanged(); });
        step("capture 2", function () { return getSelectionChanged(); });
        step("shape scan", function () { return getCurrentSelectionShape({ samples: 17 }); });
        step("capture 3", function () { return getSelectionChanged(); });
        record.pathScanFails = _hostState.pathScanFails || 0;
        record.lastPathScanError = _hostState.lastPathScanError || "";
      } catch (sequenceError) {
        note(name, sequenceError);
      }
      out.sequences.push(record);
    }

    runSequence("seq rect 10%", function () { rectangleOfPageShare(0.10); });
    runSequence("seq rect 20%", function () { rectangleOfPageShare(0.20); });
    runSequence("seq rect 35%", function () { rectangleOfPageShare(0.35); });
    runSequence("seq lasso-like 20%", function () { irregularSelection(0.20); });
    runSequence("seq wand on page background", function () { _wandAt(5, 5, LAB.wandTolerance || 20); });

    // A big bounding box with a thin body: a diagonal stroke and a frame, the two
    // shapes cleaning work produces all the time. The opening radius comes from
    // the bounding box (10% of its shortest side), so a body thinner than that is
    // annihilated by the contraction and the opened pass never gets a candidate.
    function diagonalBand(share, thickness) {
      var pageWidth = parseFloat(doc.width);
      var pageHeight = parseFloat(doc.height);
      var side = Math.sqrt(share);
      var width = Math.round(pageWidth * side);
      var height = Math.round(pageHeight * side);
      var left = Math.round((pageWidth - width) / 2);
      var top = Math.round((pageHeight - height) / 2);
      doc.selection.select([
        [left, top], [left + width, top + height],
        [left + width, top + height + thickness], [left, top + thickness],
      ], SelectionType.REPLACE, 0, false);
    }

    function frameSelection(share, thickness) {
      var pageWidth = parseFloat(doc.width);
      var pageHeight = parseFloat(doc.height);
      var side = Math.sqrt(share);
      var width = Math.round(pageWidth * side);
      var height = Math.round(pageHeight * side);
      var left = Math.round((pageWidth - width) / 2);
      var top = Math.round((pageHeight - height) / 2);
      doc.selection.select([
        [left, top], [left + width, top], [left + width, top + height], [left, top + height],
      ], SelectionType.REPLACE, 0, false);
      doc.selection.select([
        [left + thickness, top + thickness], [left + width - thickness, top + thickness],
        [left + width - thickness, top + height - thickness], [left + thickness, top + height - thickness],
      ], SelectionType.DIMINISH, 0, false);
    }

    runCase("thin diagonal, 20% bbox", function () { diagonalBand(0.20, 40); });
    runCase("thin frame, 20% bbox", function () { frameSelection(0.20, 30); });
    runSequence("seq thin diagonal, 20% bbox", function () { diagonalBand(0.20, 40); });
    runSequence("seq thin frame, 20% bbox", function () { frameSelection(0.20, 30); });

    // The guard that refuses a traced outline, forced. On a bigger raw a large or
    // noisy selection is what blows the anchor budget; here the budget is lowered
    // instead, so the refusal path is exercised on any page. What matters is that
    // the marquee survives a refused centroid, whatever made it refuse.
    var savedBudget = _MAX_BALLOON_PATH_ANCHORS;
    try {
      _MAX_BALLOON_PATH_ANCHORS = 3;
      runCase("budget refuses outline, rect 10%", function () { rectangleOfPageShare(0.10); });
      runSequence("seq budget refuses outline, rect 10%", function () { rectangleOfPageShare(0.10); });
      runCase("budget refuses outline, wand on balloon", function () {
        if (!layer) return;
        doc.activeLayer = layer;
        var ink = _getCurrentTextLayerBounds();
        var wasVisible = layer.visible;
        layer.visible = false;
        _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
        layer.visible = wasVisible;
      });
    } finally {
      _MAX_BALLOON_PATH_ANCHORS = savedBudget;
    }

    // Rulers in centimetres: `doc.width` then reports ~21 instead of ~2700, and
    // every guard that compares a pixel region against the page area collapses.
    // The panel never changes the user's rulers, so this is whatever the user left
    // them on. Only the wand case is meaningful here: `_wandAt` addresses the
    // document in explicit pixels, while `doc.selection.select` takes ruler units,
    // so a synthetic rectangle would come out microscopic and trip no guard.
    var labUnits = app.preferences.rulerUnits;
    try {
      app.preferences.rulerUnits = Units.CM;
      runCase("cm rulers: wand on balloon", function () {
        if (!layer) return;
        doc.activeLayer = layer;
        var ink = _getCurrentTextLayerBounds();
        var wasVisible = layer.visible;
        layer.visible = false;
        _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
        layer.visible = wasVisible;
      });
    } finally {
      app.preferences.rulerUnits = labUnits;
    }

    // A bigger raw: same balloons, twice the pixels. Page share is unchanged, so
    // this is the case where absolute selection size, anchor counts and modify
    // radii grow while every relative guard stays put.
    try {
      doc.resizeImage(
        UnitValue(parseFloat(doc.width) * 2, "px"),
        UnitValue(parseFloat(doc.height) * 2, "px"),
        parseFloat(doc.resolution),
        ResampleMethod.BICUBIC
      );
      out.doubledPage = { width: Math.round(parseFloat(doc.width)), height: Math.round(parseFloat(doc.height)) };
      runCase("2x page: rect 20%", function () { rectangleOfPageShare(0.20); });
      runCase("2x page: lasso-like 20%", function () { irregularSelection(0.20); });
      if (layer) {
        doc.activeLayer = layer;
        runCase("2x page: wand on balloon", function () {
          var ink = _getCurrentTextLayerBounds();
          var wasVisible = layer.visible;
          layer.visible = false;
          _wandAt(Math.round(ink.xMid), Math.round(ink.yMid), LAB.wandTolerance || 20);
          layer.visible = wasVisible;
        });
      }
    } catch (resizeError) {
      note("resize", resizeError);
    }

    try { _deselect(); } catch (e) {}
    stopSelectionMonitoring();
  } catch (docError) {
    note("document", docError);
  }

  try { app.preferences.rulerUnits = oldUnits; } catch (e) {}
  if (doc) {
    try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { note("close", closeError); }
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
  for (var c = 0; c < out.cases.length; c++) {
    var item = out.cases[c];
    lines.push(item.name +
      " | survived=" + item.selectionSurvived +
      " | skip=" + (item.centroidSkip || "-") +
      " | centroid=" + (item.captured && item.captured.centroidX !== undefined ? "yes" : "no") +
      " | " + item.ms + "ms");
  }
  for (var s = 0; s < out.sequences.length; s++) {
    var seq = out.sequences[s];
    var parts = [];
    for (var t = 0; t < (seq.steps || []).length; t++) {
      var st = seq.steps[t];
      parts.push(st.label + "=" + (st.survived ? "alive" : "GONE") +
        (st.skip ? "(" + st.skip + ")" : "") +
        (st.scanError ? "(" + st.scanError + ")" : "") +
        " " + st.ms + "ms");
    }
    lines.push(seq.name + " | " + parts.join(" | "));
  }
  LAB_RESULT = lines.join("\n") + (out.errors.length ? "\nerrors: " + out.errors.join(" ; ") : "");
})();
LAB_RESULT;
