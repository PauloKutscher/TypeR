/*
 * diagShaperDrift.jsx — does the TextShapeR bubble scan get slower the longer
 * the session runs?
 *
 * The report is "TypeR starts fast and slows down as you go through the pages,
 * and it does not happen with TextShapeR off". Everything TextShapeR-only that
 * touches Photoshop goes through _withTemporaryHistory: it borrows one history
 * state per scan, rewinds onto it and deletes it. That is bounded per scan, but
 * the snapshot it writes is not free, and once the document's history is full
 * every scan also moves app.preferences.numberOfHistoryStates twice.
 *
 * Two modes, because the first one alone lies:
 *
 *   pages   — open page after page, scan every text layer, leave them open.
 *             Measures drift across documents. Its blind spot is that a
 *             freshly opened PSD has two history states and never grows one,
 *             so it cannot see anything that scales with history depth.
 *
 *   session — one page, worked the way a typesetter works it: scan, then push
 *             the history to capacity with real edits, then scan again, then
 *             keep scanning. Measures drift against history depth and against
 *             the number of scans already paid on the same document.
 *
 * Nothing is saved. Globals: LAB.pages, LAB.outFile, LAB.mode,
 * LAB.layersPerPage, LAB.keepOpen, LAB.rounds, LAB.scansPerRound, LAB.edits.
 */

LAB_RESULT = "";

(function () {
  var out = { env: {}, samples: [], pages: [], errors: [] };

  function note(where, error) {
    out.errors.push(where + ": " + (error && error.message ? error.message : String(error)));
  }

  function ms() {
    return new Date().getTime();
  }

  function historyDepth() {
    try {
      return app.activeDocument.historyStates.length;
    } catch (error) {
      return -1;
    }
  }

  // How long the plain history read alone costs, which is what
  // _withTemporaryHistory pays before any pixel is touched
  function timeHistoryRead() {
    var startedAt = ms();
    try {
      var count = app.activeDocument.historyStates.length;
      if (count < 0) return -1;
    } catch (error) {
      return -1;
    }
    return ms() - startedAt;
  }

  function textLayerIds() {
    var entries = [];
    try {
      _collectTrainingTextLayers(app.activeDocument, entries, "", true);
    } catch (error) {
      note("collect", error);
      return [];
    }
    var ids = [];
    for (var index = 0; index < entries.length; index++) ids.push(entries[index].layerId);
    return ids;
  }

  var order = 0;

  // One timed scan on the layer that is already selected
  function measure(tag, page) {
    var sample = {
      order: ++order,
      tag: tag,
      page: page,
      documentsOpen: app.documents.length,
      historyBefore: historyDepth(),
      historyReadMs: timeHistoryRead()
    };
    var readAt = ms();
    try {
      getActiveLayerText();
    } catch (readError) {
      note("read", readError);
    }
    sample.readMs = ms() - readAt;

    var scanAt = ms();
    var scanned = "";
    try {
      scanned = getActiveLayerBubbleShape({ samples: 21, tolerance: 20 });
    } catch (scanError) {
      note("scan", scanError);
    }
    sample.scanMs = ms() - scanAt;
    sample.historyAfter = historyDepth();
    try {
      var parsed = jamJSON.parse(scanned || "{}");
      sample.scanError = parsed.error || null;
      sample.rows = parsed.rows ? parsed.rows.length : 0;
    } catch (parseError) {
      sample.scanError = "unparsed";
    }
    try { sample.freeMemoryMB = _freeMemoryMB(); } catch (memoryError) {}
    out.samples.push(sample);
  }

  // Real edits, so the history states hold what a typesetter's states hold
  function pushHistory(count) {
    for (var index = 0; index < count; index++) {
      try {
        _moveLayer(index % 2 === 0 ? 1 : -1, 0);
      } catch (moveError) {
        note("push", moveError);
        return;
      }
    }
  }

  try {
    out.env.photoshop = app.version;
    out.env.mode = LAB.mode || "pages";
    out.env.historyPref = app.preferences.numberOfHistoryStates;
    out.env.openDocumentsAtStart = app.documents.length;
    try { out.env.freeMemoryMBAtStart = _freeMemoryMB(); } catch (memoryError) {}
  } catch (envError) {
    note("env", envError);
  }

  var pages = LAB.pages || [];
  var opened = [];

  // Which part of getActiveLayerText() is the one that drifts. The panel calls
  // it on every poll and every Photoshop event while TextShapeR is on, so a few
  // tenths of a millisecond added per call is the whole complaint.
  function measureRead(cycle, page) {
    var sample = { order: ++order, tag: "cycle" + cycle, page: page, documentsOpen: app.documents.length };
    function part(name, fn) {
      var startedAt = ms();
      try { fn(); } catch (partError) { note(name, partError); }
      sample[name] = ms() - startedAt;
    }
    part("isTextLayer", function () { _layerIsTextLayer(); });
    part("layerId", function () {
      var layerIdProp = stringIDToTypeID("layerID");
      var idRef = new ActionReference();
      idRef.putProperty(charID.Property, layerIdProp);
      idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      executeActionGet(idRef).getInteger(layerIdProp);
    });
    part("bounds", function () { _getCurrentTextLayerBounds(); });
    part("stroke", function () { _getLayerStroke(); });
    part("pointText", function () { _textLayerIsPointText(); });
    var textProps = null;
    part("jamGetLayerText", function () { textProps = jamText.getLayerText(); });
    part("stringify", function () { jamJSON.stringify({ textProps: textProps }); });
    part("whole", function () { getActiveLayerText(); });
    out.samples.push(sample);
  }

  if ((LAB.mode || "pages") === "read") {
    var readRepeat = LAB.repeat || 6;
    var readCycles = pages.length * readRepeat;
    for (var readCycle = 0; readCycle < readCycles; readCycle++) {
      var readDoc = null;
      try {
        readDoc = app.open(new File(pages[readCycle % pages.length]));
      } catch (openError) {
        note("open", openError);
        continue;
      }
      var readIds = textLayerIds();
      for (var readIndex = 0; readIndex < Math.min(readIds.length, LAB.layersPerPage || 4); readIndex++) {
        try { _selectLayerById(readIds[readIndex]); } catch (selectError) { continue; }
        measureRead(readCycle + 1, (readCycle % pages.length) + 1);
      }
      try { readDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { note("close", closeError); }
    }
  } else if ((LAB.mode || "pages") === "session") {
    var rounds = LAB.rounds || 6;
    var scansPerRound = LAB.scansPerRound || 6;
    var edits = LAB.edits || 20;
    var doc = null;
    try {
      doc = app.open(new File(pages[0]));
      opened.push(doc);
    } catch (openError) {
      note("open", openError);
    }
    if (doc) {
      var ids = textLayerIds();
      out.pages.push({ page: 1, textLayers: ids.length, width: doc.width.as("px"), height: doc.height.as("px") });
      for (var round = 0; round < rounds && ids.length; round++) {
        for (var scan = 0; scan < scansPerRound; scan++) {
          try {
            _selectLayerById(ids[scan % ids.length]);
          } catch (selectError) {
            note("select", selectError);
            continue;
          }
          measure("round" + round, 1);
        }
        // Between rounds the typesetter works: every edit is a history state,
        // and once they fill the preference the scan starts moving it too
        try {
          _selectLayerById(ids[0]);
        } catch (selectError) {
          note("selectForEdit", selectError);
        }
        pushHistory(edits);
      }
    }
  } else {
    var layersPerPage = LAB.layersPerPage || 8;
    // A soak: walk the same pile of pages over and over, opening and closing
    // each one, because that is the shape of a real shift and the drift the
    // typesetter reports needs hours of it before it shows.
    var repeat = LAB.repeat || 1;
    var cycles = pages.length * repeat;
    for (var cycle = 0; cycle < cycles; cycle++) {
      var pageIndex = cycle % pages.length;
      var pageDoc = null;
      var openedAt = ms();
      try {
        pageDoc = app.open(new File(pages[pageIndex]));
      } catch (openError) {
        note("open " + pages[pageIndex], openError);
        continue;
      }
      opened.push(pageDoc);
      var pageRecord = {
        page: pageIndex + 1,
        cycle: cycle + 1,
        openMs: ms() - openedAt,
        documentsOpen: app.documents.length,
        width: pageDoc.width.as("px"),
        height: pageDoc.height.as("px")
      };
      try { pageRecord.freeMemoryMB = _freeMemoryMB(); } catch (memoryError) {}

      var pageIds = textLayerIds();
      pageRecord.textLayers = pageIds.length;
      out.pages.push(pageRecord);

      // A page the typesetter has worked carries a full history of real edits,
      // and that is what the scan has to rewind past. A freshly opened PSD has
      // two states and hides anything that scales with history depth.
      if (LAB.editsPerPage && pageIds.length) {
        try {
          _selectLayerById(pageIds[0]);
          pushHistory(LAB.editsPerPage);
        } catch (editError) {
          note("editPage", editError);
        }
      }
      var used = Math.min(pageIds.length, layersPerPage);
      for (var index = 0; index < used; index++) {
        try {
          _selectLayerById(pageIds[index]);
        } catch (selectError) {
          note("select " + pageIds[index], selectError);
          continue;
        }
        measure("cycle" + (cycle + 1), pageIndex + 1);
      }

      if (!LAB.keepOpen) {
        try { pageDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { note("close", closeError); }
        opened.pop();
      }
    }
  }

  // Only ever close what this run opened: a document the user already had open
  // is never this script's to close, saved or not.
  for (var openIndex = 0; openIndex < opened.length; openIndex++) {
    try { opened[openIndex].close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { note("closeAll", closeError); }
  }

  try { out.env.freeMemoryMBAtEnd = _freeMemoryMB(); } catch (memoryError) {}
  out.env.historyPrefAtEnd = app.preferences.numberOfHistoryStates;

  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out));
    file.close();
    LAB_RESULT = "samples=" + out.samples.length + " errors=" + out.errors.length;
  } catch (writeError) {
    LAB_RESULT = "writeFailed: " + writeError;
  }
})();
