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
 *   traceGeometry  capture the production outline and partition decisions
 *   scatter  "none" | "mid" | "full": how far the text layers are thrown out of
 *            place before the align, reproducing a page that has not been
 *            typeset yet (see the scatter block below)
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
      traceGeometry: !!LAB.traceGeometry,
      phantomRatio: LAB.phantomRatio || 0,
      scatter: LAB.scatter || "none"
    },
    doc: null,
    layers: [],
    errors: []
  };

  /* Bench-only wrappers: observe the production geometry without changing it. */
  var geometryTrace = null;
  var cleanLayersHidden = 0;

  function traceNumber(value) {
    return typeof value === "number" && isFinite(value) ? Math.round(value * 1000) / 1000 : null;
  }

  function tracePoint(point) {
    return point ? { x: traceNumber(point.x), y: traceNumber(point.y) } : null;
  }

  function traceBounds(bounds) {
    if (!bounds) return null;
    var out = {};
    var keys = ["left", "top", "right", "bottom", "width", "height", "xMid", "yMid"];
    for (var i = 0; i < keys.length; i++) {
      if (bounds[keys[i]] !== undefined) out[keys[i]] = traceNumber(bounds[keys[i]]);
    }
    return out;
  }

  function tracePoints(points) {
    var out = [];
    if (!points) return out;
    for (var i = 0; i < points.length; i++) {
      out[out.length] = [traceNumber(points[i][0]), traceNumber(points[i][1])];
    }
    return out;
  }

  function tracePartitionReport(value) {
    value = value || {};
    return {
      skip: value.skip || "",
      cuts: value.cuts || 0,
      share: value.share || 0,
      concavity: value.concavity || "",
      used: !!value.used
    };
  }

  function traceCuspCandidates(points) {
    var n = points.length;
    var span = Math.max(2, Math.round(n / _CUSP_SPAN_DIVISOR));
    var turn = [];
    var total = 0;
    var i;
    for (i = 0; i < n; i++) {
      var back = points[(i - span + n + n) % n];
      var here = points[i];
      var ahead = points[(i + span) % n];
      var ux = here[0] - back[0];
      var uy = here[1] - back[1];
      var vx = ahead[0] - here[0];
      var vy = ahead[1] - here[1];
      turn[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      total += turn[i];
    }
    var winding = total >= 0 ? 1 : -1;
    var concavity = [];
    for (i = 0; i < n; i++) concavity[i] = -winding * turn[i];
    var candidates = [];
    for (i = 0; i < n; i++) {
      if (concavity[i] < _CUSP_CONCAVITY) continue;
      var top = true;
      for (var k = -span; k <= span; k++) {
        if (concavity[(i + k + n + n) % n] > concavity[i]) { top = false; break; }
      }
      if (top) candidates[candidates.length] = {
        index: i,
        point: [traceNumber(points[i][0]), traceNumber(points[i][1])],
        depth: traceNumber(concavity[i])
      };
    }
    return { span: span, candidates: candidates };
  }

  function replayCurrentPartition(polygons, activeBox) {
    var contour = _largestContour(polygons);
    var points = contour ? _resampleContour(contour, _CUSP_CONTOUR_POINTS) : null;
    var replay = { contour: tracePoints(points), passes: [], piece: [], centroid: null };
    if (!points || !activeBox) return replay;
    var cx = (activeBox.left + activeBox.right) / 2;
    var cy = (activeBox.top + activeBox.bottom) / 2;
    for (var pass = 0; pass < _CUSP_MAX_CUTS; pass++) {
      var found = traceCuspCandidates(points);
      var pair = _findCuspPair(points);
      var step = { candidates: found.candidates, chord: null, share: 0, guard: "" };
      replay.passes[replay.passes.length] = step;
      if (!pair || pair.a < 0) { step.guard = pair ? "shallow" : "noCusp"; break; }
      step.chord = {
        a: pair.a,
        b: pair.b,
        from: [traceNumber(points[pair.a][0]), traceNumber(points[pair.a][1])],
        to: [traceNumber(points[pair.b][0]), traceNumber(points[pair.b][1])],
        first: traceNumber(pair.first),
        second: traceNumber(pair.second),
        length: traceNumber(pair.length)
      };
      var pieces = _splitContourAtChord(points, pair.a, pair.b);
      if (!pieces) { step.guard = "noPiece"; break; }
      var chosen = _pieceOnSideOf(pieces, points[pair.a], points[pair.b], cx, cy);
      if (!chosen) { step.guard = "noSide"; break; }
      step.share = traceNumber(chosen.share);
      if (chosen.share < _CUSP_MIN_PIECE_SHARE || chosen.share > 1 - _CUSP_MIN_PIECE_SHARE) {
        step.guard = "share";
        break;
      }
      points = chosen.points;
    }
    replay.piece = tracePoints(points);
    replay.centroid = tracePoint(_polygonAreaCentroid(points));
    return replay;
  }

  function beginGeometryTrace(pass) {
    if (LAB.traceGeometry) {
      geometryTrace = { pass: pass, outlines: [], partition: null, exceptions: [] };
      // These are reports, not inputs. Clear them so an early return such as
      // `smallSelection` cannot inherit the previous layer's target or cut.
      _hostState.lastAlignRegion = null;
      _hostState.partition = { skip: "notReached", cuts: 0, share: 0, concavity: "", used: false };
      _hostState.centroidSkip = "";
      _hostState.probe = null;
    }
  }

  function finishGeometryTrace() {
    var current = geometryTrace;
    if (!current) return null;
    var finalPartition = tracePartitionReport(_hostState.partition);
    current.source = _hostState.probe && _hostState.probe.cleaned ? "clean" : "dirty";
    current.final = {
      partition: finalPartition,
      target: _hostState.lastAlignRegion ? {
        x: traceNumber(_hostState.lastAlignRegion.targetX),
        y: traceNumber(_hostState.lastAlignRegion.targetY)
      } : null,
      centroidSkip: _hostState.centroidSkip || "",
      fallback: finalPartition.used ? "" : (finalPartition.skip || _hostState.centroidSkip || "regionCentroid")
    };
    if (current.partition) {
      current.partition.source = current.source;
      current.partition.report = finalPartition;
      current.partition.target = current.final.target;
    }
    geometryTrace = null;
    cleanLayersHidden = 0;
    return current;
  }

  if (LAB.traceGeometry) {
    var originalSetLayerVisibilityByIds = _setLayerVisibilityByIds;
    _setLayerVisibilityByIds = function (ids, visible) {
      if (geometryTrace && !visible) cleanLayersHidden++;
      try { return originalSetLayerVisibilityByIds(ids, visible); }
      finally { if (geometryTrace && visible && cleanLayersHidden) cleanLayersHidden--; }
    };

    var originalOpenedSelectionCentroid = _openedSelectionCentroid;
    _openedSelectionCentroid = function (doc, openedBounds) {
      var centre = null;
      try {
        centre = originalOpenedSelectionCentroid(doc, openedBounds);
      } catch (traceOpenError) {
        if (geometryTrace) geometryTrace.exceptions[geometryTrace.exceptions.length] = "outline:" + traceOpenError;
        throw traceOpenError;
      }
      if (geometryTrace) {
        var contour = _largestContour(_hostState.lastOutline || []);
        geometryTrace.outlines[geometryTrace.outlines.length] = {
          source: cleanLayersHidden ? "clean" : "dirty",
          bounds: traceBounds(openedBounds),
          centroid: tracePoint(centre),
          skip: _hostState.centroidSkip || "",
          key: _hostState.lastOutlineKey || "",
          contour: tracePoints(contour ? _resampleContour(contour, _CUSP_CONTOUR_POINTS) : null)
        };
      }
      return centre;
    };

    var originalSplitOutlineAtCusps = _splitOutlineAtCusps;
    _splitOutlineAtCusps = function (polygons, activeBox, partitionReport) {
      var replay = replayCurrentPartition(polygons, activeBox);
      var centre = null;
      try {
        centre = originalSplitOutlineAtCusps(polygons, activeBox, partitionReport);
      } catch (traceSplitError) {
        if (geometryTrace) geometryTrace.exceptions[geometryTrace.exceptions.length] = "partition:" + traceSplitError;
        throw traceSplitError;
      }
      replay.engineCentroid = tracePoint(centre);
      if (geometryTrace) geometryTrace.partition = replay;
      return centre;
    };
  }

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
  function probeTrueRegion(doc, layer, inkBox, tolerance, wasVisible) {
    var out = { raw: null, opened: null, probe: null, ok: false };
    if (!inkBox) return out;
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

    /*
     * Visibility as the page came off disk, restored before every layer.
     *
     * Measured on 13.psd: the text layers the engine could see went 9, 8, 7 ...
     * 1 as the harness walked the page, so every layer after the first was
     * centred with its neighbours missing. Rewinding `activeHistoryState` did
     * not bring them back — the state object the harness holds does not survive
     * the history being truncated and rewritten under it — and a layer that had
     * been hidden for a probe stayed hidden for the rest of the run.
     *
     * That is not a state any typesetter is ever in, and it is exactly the input
     * the region split depends on: it reads the ink boxes of the *visible* text
     * layers. Set it explicitly instead of trusting the rewind.
     */
    var originalVisible = [];
    for (var v = 0; v < found.length; v++) {
      try { originalVisible[v] = found[v].layer.visible; } catch (e) { originalVisible[v] = true; }
    }
    function restoreVisibility() {
      for (var k = 0; k < found.length; k++) {
        try {
          if (found[k].layer.visible !== originalVisible[k]) found[k].layer.visible = originalVisible[k];
        } catch (e) {}
      }
    }

    /*
     * Where every text layer sits on the page as it came off disk, and how far
     * each one is thrown out of place before the align.
     *
     * The reference pages are already typeset by a professional, so every
     * neighbour sits exactly on its ground truth. That is the opposite of the
     * real workflow — the typesetter drops all the lines anywhere inside their
     * balloons and only then aligns them one by one — and it silently flatters
     * any rule that reads the neighbours' positions. Scattering them is what
     * makes the bench measure the job the plugin actually has to do.
     *
     * The offsets are drawn once per page from a seed derived from the file
     * name, so a run is reproducible and every measured layer on a page sees
     * the same messy page.
     */
    function layerLeftTop(layer) {
      var b = layer.bounds;
      return { left: Number(b[0]), top: Number(b[1]) };
    }

    var originalPos = [];
    for (var op = 0; op < found.length; op++) {
      try { originalPos[op] = layerLeftTop(found[op].layer); } catch (e) { originalPos[op] = null; }
    }
    function restorePositions() {
      for (var k = 0; k < found.length; k++) {
        if (!originalPos[k]) continue;
        try {
          var now = layerLeftTop(found[k].layer);
          var dx = originalPos[k].left - now.left;
          var dy = originalPos[k].top - now.top;
          if (dx !== 0 || dy !== 0) found[k].layer.translate(dx, dy);
        } catch (e) {}
      }
    }

    var scatterMode = String(LAB.scatter || "none");
    var scatterOffset = [];
    for (var so = 0; so < found.length; so++) scatterOffset[so] = { dx: 0, dy: 0 };

    if (scatterMode !== "none") {
      // The balloon each line belongs to, so a scattered line never leaves it.
      // Probed with the layer hidden, which is the same trick probeTrueRegion
      // uses; the point only has to be inside the balloon, so the metric centre
      // is enough and no rasterized duplicate is needed.
      var scatterHistory = doc.activeHistoryState;
      var homeBox = [];
      var homeRegion = [];
      for (var hb = 0; hb < found.length; hb++) {
        homeBox[hb] = null;
        homeRegion[hb] = null;
        if (!originalVisible[hb]) continue;
        try {
          doc.activeLayer = found[hb].layer;
          homeBox[hb] = _getCurrentTextLayerBounds();
          if (!homeBox[hb]) continue;
          found[hb].layer.visible = false;
          wandAt(Math.round(homeBox[hb].xMid), Math.round(homeBox[hb].yMid), report.options.wandTolerance);
          homeRegion[hb] = _getCurrentSelectionBounds() || null;
        } catch (e) {
          note("scatterProbe[" + hb + "]", e);
        }
        safeDeselect();
        restoreVisibility();
      }
      try { doc.activeHistoryState = scatterHistory; } catch (e) {}

      // The page's name, not its path: the copies live under a different run
      // folder every time, and seeding from the path would scatter the same page
      // differently in the baseline run and the candidate run — which makes the
      // two runs unanswerable against each other.
      var seed = 2166136261;
      var stem = String(LAB.inFile);
      // ExtendScript ends a regex literal at the first unescaped slash, even
      // inside a character class, so the basename is taken by hand.
      var slash = Math.max(stem.lastIndexOf("/"), stem.lastIndexOf("\\"));
      if (slash >= 0) stem = stem.substring(slash + 1);
      for (var sc = 0; sc < stem.length; sc++) {
        seed = (seed ^ stem.charCodeAt(sc)) * 16777619;
        seed = seed - Math.floor(seed / 4294967296) * 4294967296;
      }
      function nextRandom() {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      }

      function throwWithin(low, high, span) {
        // `full` puts the line anywhere its balloon still holds it; `mid` keeps
        // it near home but well off the ground truth. Either way the balloon is
        // the fence: a line thrown into the neighbouring balloon would be a
        // different mistake than the one being measured.
        if (!(high > low)) return 0;
        if (scatterMode === "mid") {
          var wanted = (nextRandom() * 2 - 1) * span;
          return Math.max(low, Math.min(high, wanted));
        }
        return low + nextRandom() * (high - low);
      }

      /*
       * How far a line may be thrown and still be recognisably in its own
       * balloon. The balloon alone is not the fence it looks like: a region that
       * merges two balloons has one bounding box, so "anywhere inside it" would
       * drop a line into its neighbour's balloon, and then no rule on earth can
       * put it back — the ground truth says one balloon and the page says the
       * other. Half the way to the nearest other line is the honest limit, split
       * between the axes so the diagonal stays inside it too.
       */
      function roomBeside(index) {
        var mine = homeBox[index];
        var nearest = -1;
        for (var o = 0; o < found.length; o++) {
          if (o === index || !homeBox[o]) continue;
          var dx = homeBox[o].xMid - mine.xMid;
          var dy = homeBox[o].yMid - mine.yMid;
          var away = Math.sqrt(dx * dx + dy * dy);
          if (nearest < 0 || away < nearest) nearest = away;
        }
        return nearest < 0 ? 1e9 : nearest * 0.25;
      }

      // `overlap` leaves every line at home and moves one on top of the line
      // being centred instead, one line at a time, in `applyScatter` below.
      if (scatterMode !== "overlap") {
        for (var sk = 0; sk < found.length; sk++) {
          var box = homeBox[sk];
          var region = homeRegion[sk];
          if (!box || !region) continue;
          var room = roomBeside(sk);
          scatterOffset[sk] = {
            dx: throwWithin(Math.max(region.left - box.left, -room), Math.min(region.right - box.right, room), box.width * 0.30),
            dy: throwWithin(Math.max(region.top - box.top, -room), Math.min(region.bottom - box.bottom, room), box.height * 0.30)
          };
        }
      }
    }

    /*
     * The line the typesetter would realistically drop on top of this one: the
     * nearest one.
     */
    function nearestOther(index) {
      if (!homeBox[index]) return -1;
      var mine = homeBox[index];
      var pick = -1;
      var nearest = 0;
      for (var o = 0; o < found.length; o++) {
        if (o === index || !homeBox[o]) continue;
        var dx = homeBox[o].xMid - mine.xMid;
        var dy = homeBox[o].yMid - mine.yMid;
        var away = dx * dx + dy * dy;
        if (pick < 0 || away < nearest) {
          nearest = away;
          pick = o;
        }
      }
      return pick;
    }

    /*
     * `overlap` is the page the other levels cannot make.
     *
     * They fence every line inside its own balloon, deliberately: a line thrown
     * into the neighbour's balloon has no reachable ground truth, so the number
     * would mean nothing. But that fence also means they never put one line on
     * top of another, which is exactly what the typesetter does before pressing
     * Align — and it is why the bite the neighbour's ink takes out of the region
     * went unmeasured through two whole tasks.
     *
     * So the line being centred stays home, where its ground truth is, and the
     * nearest other line is moved on top of it. The error stays meaningful and
     * the page is the messy one.
     */
    function applyScatter(active) {
      if (scatterMode === "overlap") {
        var pick = nearestOther(active);
        if (pick < 0 || !homeBox[active]) return -1;
        try {
          // Everything is at home in this mode, so the home box is also where
          // the invader is standing right now.
          found[pick].layer.translate(
            homeBox[active].xMid - homeBox[pick].xMid,
            homeBox[active].yMid - homeBox[pick].yMid
          );
        } catch (e) {
          note("overlap[" + active + "]", e);
          return -1;
        }
        return pick;
      }
      for (var k = 0; k < found.length; k++) {
        var off = scatterOffset[k];
        if (!off || (off.dx === 0 && off.dy === 0)) continue;
        try { found[k].layer.translate(off.dx, off.dy); } catch (e) { note("scatter[" + k + "]", e); }
      }
      return -1;
    }

    for (var n = 0; n < found.length; n++) {
      var entry = found[n];
      var layer = entry.layer;
      restoreVisibility();
      restorePositions();
      var row = {
        index: n,
        path: entry.path,
        name: layer.name,
        visible: true,
        skipped: null,
        scatter: null,
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
        row.visible = originalVisible[n];
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
        row.region.trueRegion = probeTrueRegion(doc, layer, row.before.ink || row.before.metric, report.options.wandTolerance, row.visible);

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
        /*
         * Everything measured above is the ground truth: the page as the
         * professional left it. From here on the page is the one the typesetter
         * actually presses Align on — every line thrown somewhere inside its own
         * balloon, including this one. `row.before` stays the ground truth, so
         * the delta below is still the error and not merely the movement.
         */
        var invader = applyScatter(n);
        row.scatter = { dx: scatterOffset[n].dx, dy: scatterOffset[n].dy, mode: scatterMode };
        if (invader >= 0) row.scatter.invader = invader;

        var phantomOffsetX = 0;
        if (LAB.liveSelection) {
          var liveBox = row.before.ink || row.before.metric;
          try {
            layer.visible = false;
            wandAt(Math.round(liveBox.xMid + scatterOffset[n].dx), Math.round(liveBox.yMid + scatterOffset[n].dy), report.options.wandTolerance);
          } catch (liveError) {
            note("liveSelection[" + n + "]", liveError);
          }
          /*
           * Restore to what the layer was at the top of this iteration, not to
           * what the DOM says now. Right above this, the history was rewound to
           * undo the probe, and a layer reference read straight after that rewind
           * still reports the state from before it: `layer.visible` came back
           * false, this line "restored" it to false, and the layer stayed hidden
           * for the rest of the page. Measured on 13.psd, the visible text layers
           * went 9, 8, 7, ... 1 as the harness walked the page, so every layer
           * after the first was centred with its neighbours missing — which is
           * exactly the input the region split depends on. Hidden layers are
           * skipped before we get here, so `row.visible` is the truth.
           */
          try { layer.visible = row.visible; } catch (e) { note("liveSelection.restoreVisible[" + n + "]", e); }
          row.region.liveSelection = _getCurrentSelectionBounds() || null;
          if (row.region.liveSelection && LAB.phantomRatio) {
            phantomOffsetX = LAB.phantomRatio * row.region.liveSelection.width;
          }
          row.region.phantomOffsetX = phantomOffsetX;
          try { doc.activeLayer = layer; } catch (e) {}
        }

        // The real engine, same entry point the panel calls.
        beginGeometryTrace(1);
        row.align.result = alignTextLayerToSelection({
          resizeTextBox: report.options.resize,
          padding: report.options.padding,
          phantomOffsetX: phantomOffsetX
        });
        if (LAB.traceGeometry) row.region.geometry = finishGeometryTrace();

        // Why the engine split the region between its texts, or why it did not.
        // Without this a case that silently kept the old target is
        // indistinguishable from one the split never looked at.
        try {
          row.region.centroidSkip = _hostState.centroidSkip || "";
          if (_hostState.probe) {
            row.region.probe = _hostState.probe;
          }
          if (_hostState.lastAlignRegion) {
            row.region.engineRegion = _hostState.lastAlignRegion;
          }
          if (_hostState.partition) {
            row.region.partition = {
              skip: _hostState.partition.skip || "",
              cuts: _hostState.partition.cuts || 0,
              share: _hostState.partition.share || 0,
              concavity: _hostState.partition.concavity || "",
              used: !!_hostState.partition.used
            };
          }
        } catch (partitionReadError) {
          note("partitionTelemetry[" + n + "]", partitionReadError);
        }

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

        /*
         * Press Align a second time. A centring rule that reads the other text
         * layers cannot sit still here: the neighbours moved when they were
         * aligned, so the answer moves too, and the typesetter sees the text
         * jump every time the button is pressed. The second pass has to land on
         * the same pixel as the first.
         */
        try {
          var phantom2 = 0;
          if (LAB.liveSelection) {
            var box2 = row.after.ink || row.after.metric;
            layer.visible = false;
            wandAt(Math.round(box2.xMid), Math.round(box2.yMid), report.options.wandTolerance);
            layer.visible = row.visible;
            var live2 = _getCurrentSelectionBounds() || null;
            if (live2 && LAB.phantomRatio) phantom2 = LAB.phantomRatio * live2.width;
            doc.activeLayer = layer;
          }
          beginGeometryTrace(2);
          row.align.result2 = alignTextLayerToSelection({
            resizeTextBox: report.options.resize,
            padding: report.options.padding,
            phantomOffsetX: phantom2
          });
          if (LAB.traceGeometry) row.region.geometry2 = finishGeometryTrace();
          var inkA2 = inkBounds(doc, layer);
          row.after2 = { ink: inkA2.bounds, metric: _getCurrentTextLayerBounds() };
          if (row.after.ink && row.after2.ink) {
            row.delta.repeatX = row.after2.ink.xMid - row.after.ink.xMid;
            row.delta.repeatY = row.after2.ink.yMid - row.after.ink.yMid;
          }
        } catch (repeatErr) {
          if (LAB.traceGeometry && geometryTrace) row.region.geometry2 = finishGeometryTrace();
          note("secondAlign[" + n + "]", repeatErr);
        }

        // Back to ground truth for the next layer.
        try {
          doc.activeHistoryState = historyBefore;
          restoreVisibility();
          restorePositions();
          doc.activeLayer = layer;
          var check = _getCurrentTextLayerBounds();
          row.restored = !!(check && row.before.metric &&
            check.left === row.before.metric.left && check.top === row.before.metric.top);
        } catch (e) {
          row.restored = false;
          note("restoreAfterAlign[" + n + "]", e);
        }
      } catch (layerErr) {
        if (LAB.traceGeometry && geometryTrace) row.region.geometryError = finishGeometryTrace();
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
