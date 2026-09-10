/*
 * diagMeasureBox.jsx — corpus for the measuring box used while applying text to
 * a box-text layer.
 *
 * _setActiveLayerText drops the text into an oversized box so Photoshop cannot
 * soft wrap it, reads the real extent, then shrinks the box around it. The box
 * is 2x the page's longest side on each side — 7680 x 7680 px on a 2700 x 3840
 * page — and the type engine's cost scales with that area: 4 s to 45 s per
 * apply on the reference pages, against 389 ms for the same apply on a point
 * layer, which skips the pass.
 *
 * Shrinking that box may only ship if it changes nothing. What must not change
 * is where the text ends up broken and how big it ends up: this walks every
 * text layer of every page, applies several texts to each, and records the
 * rendered line breaks, the ink bounds and the resulting box. Run it before and
 * after the change and diff the two files.
 *
 * Nothing is saved. Globals: LAB.pages, LAB.outFile.
 */

LAB_RESULT = "";

(function () {
  var out = { env: {}, cases: [], errors: [] };

  function note(where, error) {
    out.errors.push(where + ": " + (error && error.message ? error.message : String(error)));
  }

  function ms() {
    return new Date().getTime();
  }

  function round(value) {
    return Math.round(Number(value) * 100) / 100;
  }

  function boxOf(bounds) {
    if (!bounds) return null;
    return [round(bounds.left), round(bounds.top), round(bounds.right), round(bounds.bottom)];
  }

  // What the layer actually renders, automatic wraps included. Box text only
  // shows its wraps once converted, so measure on a throwaway copy and undo.
  function renderedText() {
    var text = "";
    try {
      var duplicated = app.activeDocument.activeLayer.duplicate();
      app.activeDocument.activeLayer = duplicated;
      if (!_textLayerIsPointText()) _changeToPointText();
      text = _getTextKeyById(_getActiveLayerId()) || "";
      duplicated.remove();
    } catch (renderError) {
      note("rendered", renderError);
    }
    return text;
  }

  function snapshot(label, layerId, page) {
    var record = { page: page, layerId: layerId, label: label };
    try {
      var params = jamText.getLayerText();
      var shape = params && params.layerText && params.layerText.textShape && params.layerText.textShape[0];
      record.box = boxOf(shape && shape.bounds);
      record.textType = _textLayerIsPointText() ? "point" : "paragraph";
      var ink = _getCurrentTextLayerBounds();
      record.ink = ink ? [round(ink.left), round(ink.top), round(ink.width), round(ink.height)] : null;
      record.rendered = renderedText();
    } catch (snapshotError) {
      note("snapshot " + label, snapshotError);
    }
    return record;
  }

  var pages = LAB.pages || [];

  // One short, one long single line that has to be measured before it can be
  // broken, one already broken by hand, and one long enough to defeat any
  // estimate and force the fallback
  var TEXTS = [
    { label: "curto", text: "Ok." },
    { label: "linhaLonga", text: "Procurar os fragmentos da pedra magica e perigoso demais, pois voce pode acabar encontrando Hakari!" },
    { label: "quebradoAMao", text: "Procurar os fragmentos\nda pedra magica e\nperigoso demais." },
    { label: "muitoLongo", text: new Array(12).join("palavra comprida sem quebra nenhuma ") },
    // The other branch: with a style the body size comes from the style, not
    // from the layer, so the estimated box is sized off a different number
    { label: "comStyle", text: "Procurar os fragmentos da pedra magica e perigoso demais.", useStyle: true },
    { label: "comStyleLongo", text: new Array(8).join("frase que nao quebra sozinha "), useStyle: true }
  ];

  try {
    out.env.photoshop = app.version;
  } catch (envError) {
    note("env", envError);
  }

  for (var pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    var doc = null;
    try {
      doc = app.open(new File(pages[pageIndex]));
    } catch (openError) {
      note("open " + pages[pageIndex], openError);
      continue;
    }
    var entries = [];
    try {
      _collectTrainingTextLayers(app.activeDocument, entries, "", true);
    } catch (collectError) {
      note("collect", collectError);
    }
    var used = Math.min(entries.length, LAB.layersPerPage || 3);
    for (var index = 0; index < used; index++) {
      var layerId = entries[index].layerId;
      for (var t = 0; t < TEXTS.length; t++) {
        try {
          _selectLayerById(layerId);
        } catch (selectError) {
          note("select", selectError);
          continue;
        }
        // The panel always sends { textProps, stroke }; the layer's own props
        // are a valid one and keep the case reproducible across runs
        var caseStyle = undefined;
        if (TEXTS[t].useStyle) {
          try {
            caseStyle = { textProps: jamText.getLayerText(), stroke: null };
          } catch (styleError) {
            note("style", styleError);
          }
        }
        var startedAt = ms();
        try {
          setActiveLayerText({
            text: TEXTS[t].text,
            style: caseStyle,
            direction: null,
            richTextRuns: null
          });
        } catch (applyError) {
          note("apply", applyError);
        }
        var elapsed = ms() - startedAt;
        try {
          _selectLayerById(layerId);
        } catch (reselectError) {}
        var record = snapshot(TEXTS[t].label, layerId, pageIndex + 1);
        record.ms = elapsed;
        record.result = _hostState.setActiveLayerText.result || "";
        out.cases.push(record);
        // Every text starts from the layer as the page shipped it
        try {
          app.activeDocument.activeHistoryState = app.activeDocument.historyStates[0];
        } catch (undoError) {
          note("undo", undoError);
        }
      }
    }
    try { doc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) { note("close", closeError); }
  }

  try {
    var file = new File(LAB.outFile);
    file.encoding = "UTF-8";
    file.open("w");
    file.write(jamJSON.stringify(out));
    file.close();
    LAB_RESULT = "cases=" + out.cases.length + " errors=" + out.errors.length;
  } catch (writeError) {
    LAB_RESULT = "writeFailed: " + writeError;
  }
})();
