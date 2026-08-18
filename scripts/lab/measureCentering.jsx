/*
 * measureCentering.jsx — measurement harness for TypeR balloon centering.
 *
 * Runs inside Photoshop. Expects two globals to exist before evaluation:
 *   LAB      configuration object (see keys below)
 *   the TypeR host engine already evaluated ($.evalFile of app/host.jsx)
 *
 * LAB keys:
 *   inFile   absolute path of the PSD copy to measure (never an original)
 *   outFile  absolute path of the JSON report to write
 *   resize   value forwarded to alignTextLayerToSelection.resizeTextBox
 *   padding  value forwarded to alignTextLayerToSelection.padding
 *   wandTolerance  magic wand tolerance used by the plugin (20 in production)
 *
 * The harness never saves the document and restores the history state after
 * every measured layer, so each layer starts from the ground-truth position.
 * It sets LAB_RESULT to a short status string for the COM driver.
 */

LAB_RESULT = "";

(function () {
  var report = {
    file: LAB.inFile,
    engine: "app/host.jsx",
    photoshop: app.version,
    options: {
      resize: !!LAB.resize,
      padding: LAB.padding || 0,
      wandTolerance: LAB.wandTolerance || 20,
      liveSelection: !!LAB.liveSelection,
      phantomRatio: LAB.phantomRatio || 0
    },
    doc: null,
    layers: [],
    errors: []
  };

  function note(where, err) {
    report.errors.push(where + ": " + (err && err.message ? err.message : String(err)));
  }

  // Layer bounds excluding layer effects. The plugin reads "bounds", which
  // includes effects; keeping both lets us separate a stroke/shadow shift from
  // a genuine geometry error.
  function boundsNoFx() {
    try {
      var id = stringIDToTypeID("boundsNoEffects");
      var ref = new ActionReference();
      ref.putProperty(charIDToTypeID("Prpr"), id);
      ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      var desc = executeActionGet(ref);
      if (!desc.hasKey(id)) return null;
      return _getBoundsFromDescriptor(desc.getObjectValue(id));
    } catch (e) {
      return null;
    }
  }

  function safeDeselect() {
    try { _deselect(); } catch (e) {
      try { app.activeDocument.selection.deselect(); } catch (e2) {}
    }
  }

  // Same magic wand descriptor the plugin uses, but at an arbitrary probe
  // point. Needed to sample the balloon the text actually lives in, which is
  // the reference the plugin's own single probe fails to find.
  function wandAt(x, y, tolerance) {
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putProperty(charID.Channel, charID.FrameSelect);
    desc.putReference(charID.Null, ref);
    var pos = new ActionDescriptor();
    pos.putUnitDouble(charID.Horizontal, charID.PixelUnit, x);
    pos.putUnitDouble(charID.Vertical, charID.PixelUnit, y);
    desc.putObject(charID.To, stringIDToTypeID("paint"), pos);
    desc.putInteger(stringIDToTypeID("tolerance"), tolerance || 20);
    desc.putBoolean(stringIDToTypeID("contiguous"), true);
    desc.putBoolean(stringIDToTypeID("merged"), true);
    desc.putBoolean(stringIDToTypeID("antiAlias"), true);
    executeAction(charID.Set, desc, DialogModes.NO);
  }

  // The balloon region as Photoshop itself sees it, probed from inside the
  // text ink with the glyphs hidden. This is measurement only: it gives a
  // reference region so the plugin's error can be split into "wrong region"
  // versus "wrong center rule".
  function probeTrueRegion(doc, layer, inkBox, tolerance) {
    var out = { raw: null, opened: null, probe: null, ok: false };
    if (!inkBox) return out;
    var wasVisible = layer.visible;
    try {
      layer.visible = false;
      var px = Math.round(inkBox.xMid);
      var py = Math.round(inkBox.yMid);
      out.probe = { x: px, y: py };
      wandAt(px, py, tolerance);
      out.raw = _getCurrentSelectionBounds() || null;
      if (out.raw) {
        try { out.opened = _getAdaptiveOpenedSelectionBounds(out.raw); } catch (e) { out.opened = null; }
        // The centroid the plugin itself would target, measured on the same
        // selection, so the offline lab can be compared against the host.
        try {
          out.centroid = typeof _getSelectionAreaCentroid === "function"
            ? _getSelectionAreaCentroid(out.opened || out.raw)
            : null;
        } catch (e) { out.centroid = null; }
        out.ok = true;
      }
    } catch (probeErr) {
      note("probeTrueRegion", probeErr);
    }
    safeDeselect();
    try { layer.visible = wasVisible; } catch (e2) { note("probeTrueRegion.restoreVisible", e2); }
    return out;
  }

  // Ink bounds: the pixels the glyphs really occupy, measured on a throwaway
  // rasterized duplicate. The original layer is never modified.
  function inkBounds(doc, layer) {
    var dup = null;
    var out = { bounds: null, boundsNoFx: null, ok: false };
    try {
      dup = layer.duplicate();
      doc.activeLayer = dup;
      dup.rasterize(RasterizeType.TEXTCONTENTS);
      out.bounds = _getCurrentTextLayerBounds();
      out.boundsNoFx = boundsNoFx();
      out.ok = true;
    } catch (e) {
      note("inkBounds", e);
    }
    if (dup !== null) {
      try { dup.remove(); } catch (e3) { note("inkBounds.remove", e3); }
    }
    try { doc.activeLayer = layer; } catch (e4) { note("inkBounds.restoreActive", e4); }
    return out;
  }

  function collectTextLayers(container, trail, acc) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      var isSet = false;
      try { isSet = layer.typename === "LayerSet"; } catch (e) { isSet = false; }
      if (isSet) {
        collectTextLayers(layer, trail + "/" + layer.name, acc);
        continue;
      }
      var kind = null;
      try { kind = layer.kind; } catch (e2) { kind = null; }
      if (kind === LayerKind.TEXT) {
        acc.push({ layer: layer, path: trail + "/" + layer.name });
      }
    }
    return acc;
  }

  function hasShapeLayers(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      try {
        if (layer.typename === "LayerSet") {
          if (hasShapeLayers(layer)) return true;
          continue;
        }
        if (layer.kind === LayerKind.SOLIDFILL) return true;
      } catch (e) {}
    }
    return false;
  }

  function hideAllText(container) {
    for (var i = 0; i < container.layers.length; i++) {
      var layer = container.layers[i];
      try {
        if (layer.typename === "LayerSet") { hideAllText(layer); continue; }
        if (layer.kind === LayerKind.TEXT) layer.visible = false;
      } catch (e) {}
    }
  }

  // Flatten a throwaway duplicate to 8-bit grayscale and write it as headerless
  // Photoshop RAW: width * height bytes, no image decoder needed on the Node
  // side. The measured document is never modified.
  function exportComposite(sourceDoc, outPath, hideText) {
    var dup = null;
    try {
      dup = sourceDoc.duplicate();
      if (hideText) hideAllText(dup);
      try { dup.flatten(); } catch (flatErr) { dup.mergeVisibleLayers(); }
      if (dup.mode !== DocumentMode.GRAYSCALE) dup.changeMode(ChangeMode.GRAYSCALE);
      if (dup.bitsPerChannel !== BitsPerChannelType.EIGHT) dup.bitsPerChannel = BitsPerChannelType.EIGHT;
      var opts = new RawSaveOptions();
      opts.alphaChannels = false;
      opts.spotColors = false;
      dup.saveAs(new File(outPath), opts, true, Extension.LOWERCASE);
      return outPath;
    } catch (e) {
      note("exportComposite(" + (hideText ? "noText" : "withText") + ")", e);
      return null;
    } finally {
      if (dup !== null) {
        try { dup.close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {}
      }
    }
  }

  function textInfo(layer) {
    var info = { contents: null, size: null, kind: null, justification: null, font: null, leading: null };
    try {
      var ti = layer.textItem;
      try { info.contents = ti.contents; } catch (e1) {}
      try { info.size = ti.size.value !== undefined ? ti.size.value : Number(ti.size); } catch (e2) {}
      try { info.kind = String(ti.kind); } catch (e3) {}
      try { info.justification = String(ti.justification); } catch (e4) {}
      try { info.font = ti.font; } catch (e5) {}
      try { info.leading = ti.useAutoLeading ? "auto" : Number(ti.leading); } catch (e6) {}
    } catch (e) {}
    return info;
  }

  var doc = null;
  try {
    doc = app.open(new File(LAB.inFile));
  } catch (openErr) {
    LAB_RESULT = "ERROR open: " + openErr;
    return;
  }

  var oldUnits = app.preferences.rulerUnits;
  var oldDialogs = app.displayDialogs;
  app.preferences.rulerUnits = Units.PIXELS;
  app.displayDialogs = DialogModes.NO;

  try {
    report.doc = {
      name: doc.name,
      width: Math.round(doc.width.value !== undefined ? doc.width.value : Number(doc.width)),
      height: Math.round(doc.height.value !== undefined ? doc.height.value : Number(doc.height)),
      resolution: Number(doc.resolution),
      hasShapeLayers: hasShapeLayers(doc)
    };

    var found = collectTextLayers(doc, "", []);
    for (var n = 0; n < found.length; n++) {
      var entry = found[n];
      var layer = entry.layer;
      var row = {
        index: n,
        path: entry.path,
        name: layer.name,
        visible: true,
        skipped: null,
        text: null,
        isPointText: null,
        before: {},
        region: {},
        align: {},
        after: {},
        delta: {},
        restored: null
      };

      try {
        row.visible = layer.visible;
        if (!row.visible) {
          row.skipped = "hiddenLayer";
          report.layers.push(row);
          continue;
        }

        doc.activeLayer = layer;
        safeDeselect();

        var historyBefore = doc.activeHistoryState;

        row.text = textInfo(layer);
        try { row.isPointText = _textLayerIsPointText(); } catch (e) { row.isPointText = null; }

        row.before.metric = _getCurrentTextLayerBounds();
        row.before.metricNoFx = boundsNoFx();
        var inkB = inkBounds(doc, layer);
        row.before.ink = inkB.bounds;
        row.before.inkNoFx = inkB.boundsNoFx;

        // Which region would the plugin use? Reproduce its own probes without
        // touching the plugin code. Order matters: the shape-layer lookup must
        // run while no selection exists, exactly like the align path.
        safeDeselect();
        try { row.region.shapeLayerBounds = _findShapeLayerBoundsBelowTextLayer(); } catch (e) { row.region.shapeLayerBounds = null; }

        try {
          _createMagicWandSelection(report.options.wandTolerance);
          row.region.wandRaw = _getCurrentSelectionBounds() || null;
          if (row.region.wandRaw) {
            try { row.region.openRadius = _getAdaptiveSelectionOpenRadius(row.region.wandRaw); } catch (e) { row.region.openRadius = null; }
            try { row.region.wandOpened = _getAdaptiveOpenedSelectionBounds(row.region.wandRaw); } catch (e) { row.region.wandOpened = null; }
          }
        } catch (wandErr) {
          note("wand[" + n + "]", wandErr);
        }
        safeDeselect();

        // The probe point the plugin uses, kept so the offline lab can
        // reproduce the same flood fill on the exported composite.
        if (row.before.metric) {
          row.region.pluginProbe = {
            x: Math.max(row.before.metric.left - 5, 0),
            y: Math.max(row.before.metric.yMid, 0)
          };
        }

        // Reference region: the balloon the text really sits in.
        row.region.trueRegion = probeTrueRegion(doc, layer, row.before.ink || row.before.metric, report.options.wandTolerance);

        // Restore the pre-probe state so the align runs from the ground truth.
        try {
          doc.activeHistoryState = historyBefore;
          doc.activeLayer = layer;
        } catch (e) { note("restoreBeforeAlign[" + n + "]", e); }
        safeDeselect();

        /*
         * The panel's real workflow: the typesetter has a live selection around
         * the balloon when Align is pressed, and the inline TextShapeR sends a
         * phantom offset with it. Measuring without either (the original mode of
         * this harness) missed a defect that only shows up on that path, so the
         * live-selection mode reproduces both.
         *
         * The selection is made the way the user's magic wand would make it:
         * probing inside the text ink with the glyphs hidden. The phantom offset
         * is expressed the way the panel expresses it — a fraction of the
         * balloon width — so any value of it exercises the same arithmetic.
         */
        var phantomOffsetX = 0;
        if (LAB.liveSelection) {
          var liveBox = row.before.ink || row.before.metric;
          var wasVisibleForWand = layer.visible;
          try {
            layer.visible = false;
            wandAt(Math.round(liveBox.xMid), Math.round(liveBox.yMid), report.options.wandTolerance);
          } catch (liveError) {
            note("liveSelection[" + n + "]", liveError);
          }
          try { layer.visible = wasVisibleForWand; } catch (e) { note("liveSelection.restoreVisible[" + n + "]", e); }
          row.region.liveSelection = _getCurrentSelectionBounds() || null;
          if (row.region.liveSelection && LAB.phantomRatio) {
            phantomOffsetX = LAB.phantomRatio * row.region.liveSelection.width;
          }
          row.region.phantomOffsetX = phantomOffsetX;
          try { doc.activeLayer = layer; } catch (e) {}
        }

        // The real engine, same entry point the panel calls.
        row.align.result = alignTextLayerToSelection({
          resizeTextBox: report.options.resize,
          padding: report.options.padding,
          phantomOffsetX: phantomOffsetX
        });

        row.after.metric = _getCurrentTextLayerBounds();
        row.after.metricNoFx = boundsNoFx();
        var inkA = inkBounds(doc, layer);
        row.after.ink = inkA.bounds;
        row.after.inkNoFx = inkA.boundsNoFx;

        if (row.before.metric && row.after.metric) {
          row.delta.metricX = row.after.metric.xMid - row.before.metric.xMid;
          row.delta.metricY = row.after.metric.yMid - row.before.metric.yMid;
        }
        if (row.before.ink && row.after.ink) {
          row.delta.inkX = row.after.ink.xMid - row.before.ink.xMid;
          row.delta.inkY = row.after.ink.yMid - row.before.ink.yMid;
        }

        // Back to ground truth for the next layer.
        try {
          doc.activeHistoryState = historyBefore;
          doc.activeLayer = layer;
          var check = _getCurrentTextLayerBounds();
          row.restored = !!(check && row.before.metric &&
            check.left === row.before.metric.left && check.top === row.before.metric.top);
        } catch (e) {
          row.restored = false;
          note("restoreAfterAlign[" + n + "]", e);
        }
      } catch (layerErr) {
        note("layer[" + n + "]", layerErr);
        row.skipped = row.skipped || "error";
      }

      report.layers.push(row);
    }
  } catch (docErr) {
    note("document", docErr);
  }

  // Composites for the offline lab: 8-bit grayscale, headerless raw, so Node
  // can read the pixels with no image decoder. One with everything visible
  // (reproduces what the plugin's merged wand sees) and one with every text
  // layer hidden (gives the clean balloon interiors).
  if (LAB.rawWithText || LAB.rawNoText) {
    try {
      report.raw = { width: report.doc.width, height: report.doc.height, channels: 1, depth: 8 };
      if (LAB.rawWithText) report.raw.withText = exportComposite(doc, LAB.rawWithText, false);
      if (LAB.rawNoText) report.raw.noText = exportComposite(doc, LAB.rawNoText, true);
    } catch (rawErr) {
      note("raw", rawErr);
    }
  }

  try { app.preferences.rulerUnits = oldUnits; } catch (e) {}
  try { app.displayDialogs = oldDialogs; } catch (e) {}

  try {
    var out = new File(LAB.outFile);
    out.encoding = "UTF-8";
    out.open("w");
    out.write(jamJSON.stringify(report, "\t"));
    out.close();
  } catch (writeErr) {
    LAB_RESULT = "ERROR write: " + writeErr;
  }

  try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeErr) { note("close", closeErr); }

  if (!LAB_RESULT) {
    LAB_RESULT = "OK layers=" + report.layers.length + " errors=" + report.errors.length;
  }
})();
