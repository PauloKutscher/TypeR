/* globals app, documents, activeDocument, ScriptUI, DialogModes, LayerKind, ActionReference, ActionDescriptor, ActionList, executeAction, executeActionGet, charIDToTypeID, stringIDToTypeID, jamEngine, jamJSON, jamText */

var charID = {
  AdjustmentLayer: 1097099891, // 'AdjL'
  Back: 1113678699, // 'Back'
  Background: 1113811815, // 'Bckg'
  Bottom: 1114926957, // 'Btom'
  By: 1115234336, // 'By  '
  Channel: 1130917484, // 'Chnl'
  Contract: 1131312227, // 'Cntc'
  Delete: 1147958304, // 'Dlt '
  Document: 1147366766, // 'Dcmn'
  Expand: 1165521006, // 'Expn'
  FrameSelect: 1718838636, // 'fsel'
  From: 1181904749, // 'From'
  Hide: 1214521376, // 'Hd  '
  Horizontal: 1215461998, // 'Hrzn'
  Layer: 1283027488, // 'Lyr '
  LayerID: 1283027529, // 'LyrI'
  Left: 1281713780, // 'Left'
  Make: 1298866208, // 'Mk  '
  Move: 1836021349, // 'move'
  None: 1315925605, // 'None'
  Null: 1853189228, // 'null'
  Offset: 1332114292, // 'Ofst'
  Ordinal: 1332896878, // 'Ordn'
  Path: 1348564072, // 'Path'
  PixelUnit: 592476268, // '#Pxl'
  Point: 1349415968, // 'Pnt '
  Property: 1349677170, // 'Prpr'
  Right: 1382508660, // 'Rght'
  Select: 1936483188, // 'slct'
  SelectionClass: 1668506988, // 'csel'
  Set: 1936028772, // 'setd'
  Show: 1399355168, // 'Shw '
  Size: 1400512544, // 'Sz  '
  Target: 1416783732, // 'Trgt'
  Text: 1417180192, // 'Txt '
  TextLayer: 1417170034, // 'TxLr'
  TextShapeType: 1413830740, // 'TEXT'
  TextStyle: 1417180243, // 'TxtS'
  TextStyleRange: 1417180276, // 'Txtt'
  To: 1411391520, // 'T   '
  Tolerance: 1416393326, // 'Tlrn'
  Top: 1416589344, // 'Top '
  Vertical: 1450341475, // 'Vrtc'
  Visible: 1450402412, // 'Vsbl'
  WorkPath: 1467116368, // 'WrkP'
};

var _SAFE_PARAGRAPH_PROPS = [
  "align",
  "alignment",
  "firstLineIndent",
  "startIndent",
  "endIndent",
  "spaceBefore",
  "spaceAfter",
  "autoLeadingPercentage",
  "leadingType",
  "hyphenate",
  "hyphenateWordSize",
  "hyphenatePreLength",
  "hyphenatePostLength",
  "hyphenateLimit",
  "hyphenationZone",
  "hyphenateCapitalized",
  "hangingRoman",
  "burasagari",
  "textEveryLineComposer",
  "textComposerEngine",
];

var _DEFAULT_SELECTION_SCALE = 0.9;
var _MIN_TEXTBOX_WIDTH = 10;
var _TEMP_SELECTION_CHANNEL = "__TyperSelectionTemp__";
var _SELECTION_OPEN_RATIO = 0.1;
var _MIN_SELECTION_OPEN_RADIUS = 4;
// Ceiling for that ratio. Contract/Expand cost grows with the radius AND with the
// page: measured on a 6331x8882 smart object interior, one Contract at 629 px took
// 2 708 ms and annihilated the selection, so the retry loop halved the radius and
// spent 5 982 ms in a single poll. Across the 65 reference cases every region
// under a quarter of the page opens with a radius of 85 px or less (median 52), so
// this ceiling changes nothing that was ever measured — it only stops the radius
// from following a region that escaped the balloon onto a high-resolution page.
var _MAX_SELECTION_OPEN_RADIUS = 96;

var _hostState = {
  fallbackTextSize: 20,
  setActiveLayerText: {
    data: null,
    result: "",
  },
  setSelectedTextLayers: {
    data: null,
    result: "",
  },
  setTextShapeRText: {
    data: null,
    result: "",
  },
  getRenderedTextLines: {
    result: "",
  },
  getAllRenderedTextLines: {
    result: "",
    scanBubbles: false,
  },
  createTextLayerInSelection: {
    data: null,
    result: "",
    point: false,
    padding: 0,
  },
  alignTextLayerToSelection: {
    result: "",
    resize: false,
    padding: 0,
    phantomOffsetX: 0,
    placements: {},
  },
  alignTextLayersToDoubleBubble: {
    result: "",
    resize: false,
    padding: 0,
    entries: null,
  },
  changeActiveLayerTextSize: {
    value: 0,
    result: "",
  },
  selectionMonitor: {
    lastBoundsKey: null,
    lastBounds: null,
    multiWarnBounds: null,
    callback: null,
  },
  createTextLayersInStoredSelections: {
    data: null,
    result: "",
    point: false,
    padding: 0,
    selections: [],
  },
  hiddenCleaningLayerIdsByDocument: {},
  documentSession: String(new Date().getTime()) + ":" + String(Math.random()),
  lastOpenedDocId: null,
  suspendedRun: null,
  pathScanFails: 0,
  pathScanBackoffAt: 0,
  lastPathScanReader: "",
};

// How long the fast path-based shape scan stays disabled after 3 failures
var _PATH_SCAN_RETRY_MS = 3 * 60 * 1000;

// A balloon never covers this much of the page: past it, the contiguous fill
// escaped through a gap in an outline and swallowed artwork. Measured on the
// reference pages, real balloons stay under 10% of the page.
var _MAX_BALLOON_PAGE_SHARE = 0.25;

// Anchor budget for tracing a balloon outline, sized for the Action Manager read
// that replaced the DOM one. Measured: 10 740 anchors over 2 059 subpaths cost
// 111 ms to read and 29 ms to integrate, so roughly 13 µs per anchor; this cap
// keeps the worst case near 400 ms. The old cap of 4 000 came from the DOM read
// at 5.7 ms per anchor and, left in place, it silently threw away good centroids:
// a selection narrowed around escaped artwork traces into thousands of specks and
// still yields a centroid 10 px from where the typesetter put the text.
var _MAX_BALLOON_PATH_ANCHORS = 30000;

// How sharp a concave corner has to be, in radians of turn, before it counts as
// the place two balloons were drawn over each other.
//
// Two overlapping convex shapes always meet at exactly two of these cusps, and
// the chord between them is the line the artist would have drawn if the balloons
// had been closed separately. That is the whole rule: nothing here reads where
// the other text layers are, so pressing Align twice lands on the same pixel and
// a page whose lines have merely been dumped inside their balloons measures the
// same as a page already typeset.
//
// Swept over the 93 reference layers on the page the host really sees — every
// other text painted, the active one hidden, the region opened: below 0.45 the
// cut starts firing on single balloons (2 of 55 at 0.2), and above 0.9 it stops
// finding four of the real ones. Between them the numbers are flat, so the
// middle of the plateau is the value.

// Where two balloons meet, only one of the two corners has to be a real corner.
//
// Two round balloons overlapping deeply, or a junction whose other side runs off
// the panel, leave one deep cusp and one shallow bend: measured on the reported
// page, 1.40 against 0.34 and 1.48 against 0.15. The stock rule needs both above
// 0.6, finds one corner, and every line in the merged region gets the merged
// centroid — which is the "round balloon centred badly" the typesetter reports.
//
// Swept over the 107 layers of the corpus, requiring one corner above
// `_CUSP_CONCAVITY` and its partner only above this: 4 layers improve (86 to 7,
// 78 to 7, 46 to 12 and 17 to 1 px against the position the typesetter had
// chosen), none get worse, and the 95th percentile of the whole corpus goes from
// 62 px to 39 px.

// How short the chord has to be before a cut that leaves almost everything on
// one side is read as a waist rather than a bump being shaved. Stricter than
// `_CUSP_MAX_NECK` because it is allowed to overrule the piece-share window, and
// measured on the outlines the host traced: at 0.55 a region on 0018-0019 starts
// being cut in the wrong place (13 px to 81 px), at 0.45 that one is refused
// again and every balloon this exception was for still separates — the top and
// middle of the reported chain at 5 px and 7 px, and two more regions at 10 px
// and 5 px that used to keep the merged centroid at 67 px and 55 px.

// A waist is short next to the shape it splits, and that is what keeps the
// assisted pair above from cutting a single balloon in half: the chord may not
// be longer than this fraction of the piece's own size (the square root of its
// area). Measured, the real waists in the corpus sit at 0.23 and 0.32 while a
// chord across a single balloon lands near 0.9; at 0.55 the one single balloon
// that the assisted pair used to cut (0 px error, then 14 px) is refused again,
// and every improvement above survives.

// How much two lines have to cover each other before the balloon is worth probing
// again with the other one hidden.
//
// Refilling the balloon costs an opening, and the opening is the expensive half
// of the path. Two lines whose boxes merely graze each other take no bite worth
// the price: measured over the reference pages, the check accepted the clean
// region in 1 of the 10 layers that had any overlap at all and paid for the other
// nine. What the typesetter actually creates — a line dropped across another —
// covers most of the box, and that is what this keeps.
var _PROBE_OVERLAP_SHARE = 0.25;



// A cut that leaves almost everything on one side did not separate anything: it
// shaved a bump off. Measured, widening this window past 0.15 buys no accuracy
// and starts cutting single balloons.

// Up to three cuts per region: a region of four balloons needs three chords to
// leave one balloon on its own.
//
// The number is measured, not assumed. On the region the engine really sees —
// every other line painted, the active one hidden, the opening applied — over
// 275 samples of single-text regions and 60 of four-text ones, going from one
// chord to three takes the median |dX| of the four-balloon regions from 34 px to
// 14 px and touches nothing else: single balloons stay at 2/11 px and are still
// cut zero times, and two-balloon regions do not move at all. A fourth and a
// fifth chord change nothing, because by then there is nothing left to separate.
//
// Cutting more than once was tried before with the chord taken between the two
// *deepest* cusps, and measured badly: that chord does not have to separate the
// balloons two and two, so the second one slices through a balloon instead of
// between two, and every four-balloon case where it took a real bite came out
// worse than not cutting at all. The narrowest-waist rule below is what makes
// the extra cuts safe.

// The traced contour is resampled to this many evenly spaced points before the
// turn angles are measured, so the answer does not depend on where `Make Work
// Path` happened to drop its anchors, and the turn is measured across a span of
// a 24th of the contour: short enough to be a corner, long enough to ignore the
// jitter the tracing leaves behind.

// The two cusps have to be on opposite sides of the shape. Anything closer along
// the contour is one corner measured twice.

// How many admissible pairs a region may be offered before it keeps the merged
// centroid, and only while it has no cut yet.
//
// "The shortest chord between admissible corners" and "the shortest chord whose
// piece survives the guards" are not the same pair. When the first one's piece
// fails — the chord leaves nothing on the text's side, or shaves a bump — the
// pass used to end, and a region that plainly holds two balloons kept the centre
// of both. Measured over the 392 traced regions of the reference pages, offering
// the next pair recovers four of them (115 to 27, 108 to 11, 60 to 7 and 203 to
// 57 px) and moves nothing else.
//
// Only while there is no cut yet, and that half is measured too: letting a later
// pass hunt for another chord took three regions of the four-balloon page from
// 16, 21 and 54 px to 106, 80 and 70 px. A region with a cut already has a
// balloon-shaped answer; a region with none has the merged blob, which is the
// answer this exists to avoid.
//
// The budget is not a tuning knob: 2, 3, 4, 6 and 10 give byte-identical results
// over the corpus, because the pair that works is the first or second one.


// Older CEP hosts can expose the pre-suspension history until Photoshop
// refreshes. Selecting the saved state through Action Manager also publishes
// that pending history, without repainting the whole document. Refresh is a
// fallback for hosts where this does not publish the expected state.
function _suspendedHistoryIndex(doc, name, previousIndex, restored) {
  var index = doc.historyStates.length - 1;
  if ((index < 0 || doc.historyStates[index].name !== name) && previousIndex >= 0) {
    try {
      var reference = new ActionReference();
      reference.putIndex(stringIDToTypeID("historyState"), previousIndex + 1);
      var descriptor = new ActionDescriptor();
      descriptor.putReference(charID.Null, reference);
      executeAction(charID.Select, descriptor, DialogModes.NO);
      index = doc.historyStates.length - 1;
      if (restored && index >= 0 && doc.historyStates[index].name === name) restored.selected = true;
    } catch (selectError) {}
  }
  if (index < 0 || doc.historyStates[index].name !== name) {
    app.refresh();
    index = doc.historyStates.length - 1;
  }
  return index >= 0 && doc.historyStates[index].name === name ? index : -1;
}

// Shape detection reads pixels through temporary channels, paths and selections.
// Grouping those operations still retains a full scan in Photoshop history.
// Roll back and delete only that new state, never the user's undo/redo states.
function _withTemporaryHistory(name, fn, options) {
  var doc = app.activeDocument;
  var scanName = name;
  var historyLimit = null;
  var previousHistoryIndex = null;
  var reservedHistorySlot = false;
  // The smart paste reads right before a paste: that paste discards the redo
  // branch anyway, so its reads may run after an Undo (discardRedo)
  var discardRedo = !!(options && options.discardRedo);
  try {
    var count = doc.historyStates.length;
    previousHistoryIndex = _getActiveHistoryIndex();
    // Starting a new operation after Undo would discard the redo branch.
    var historyBusy = _hostState.temporaryHistoryFailed || count < (discardRedo ? 1 : 2);
    if (!discardRedo && previousHistoryIndex !== count - 1) historyBusy = true;
    if (historyBusy) {
      return { error: "historyBusy" };
    }
    // A no-op or failed suspension must never match an existing user state.
    if (doc.historyStates[count - 1].name === scanName) scanName += " (temporary)";
    // Reserve room only when needed, then restore the preference in finally.
    // Otherwise the scan itself could evict a real undo state at capacity.
    historyLimit = app.preferences.numberOfHistoryStates;
    if (!(historyLimit > 0)) return { error: "historyBusy" };
    if (count >= historyLimit) {
      reservedHistorySlot = true;
      app.preferences.numberOfHistoryStates = count + 1;
      if (app.preferences.numberOfHistoryStates <= count) throw new Error("historyCapacity");
    }
  } catch (historyError) {
    if (reservedHistorySlot) {
      try { app.preferences.numberOfHistoryStates = historyLimit; } catch (limitError) {}
    }
    return { error: "historyBusy" };
  }

  var result = null;
  // The rewind below restores the layer selection this state was recorded
  // with — the balloon the typesetter was on before, not the one he just
  // clicked. Remember his selection so the scan can hand it back.
  var selectedIds = [];
  try {
    selectedIds = _getSelectedLayerIds();
  } catch (selectionError) {}
  var previousRun = _hostState.suspendedRun;
  _hostState.suspendedRun = function () {
    try {
      result = fn();
    } catch (scanError) {
      result = null;
    }
  };
  try {
    // Never retry unsuspended: one failed scan could otherwise leave dozens
    // of history entries and evict the user's work before cleanup runs.
    doc.suspendHistory(scanName, "_hostState.suspendedRun()");
  } catch (suspendError) {
    result = null;
  } finally {
    _hostState.suspendedRun = previousRun;
    try {
      var restored = { selected: false };
      var scanIndex = _suspendedHistoryIndex(doc, scanName, previousHistoryIndex, restored);
      if (scanIndex > 0) {
        // The Action Manager fallback already restored this exact state.
        // Setting it again adds another synchronous Photoshop operation.
        if (!restored.selected || scanIndex - 1 !== previousHistoryIndex) doc.activeHistoryState = doc.historyStates[scanIndex - 1];
        var reference = new ActionReference();
        reference.putIndex(stringIDToTypeID("historyState"), scanIndex + 1);
        var descriptor = new ActionDescriptor();
        descriptor.putReference(charID.Null, reference);
        executeAction(charID.Delete, descriptor, DialogModes.NO);
        if (selectedIds.length) _selectLayersById(selectedIds);
      }
    } catch (restoreError) {
      // A host that cannot clean up must not accumulate more scan states.
      _hostState.temporaryHistoryFailed = true;
      result = { error: "historyBusy" };
    } finally {
      if (reservedHistorySlot) {
        try {
          app.preferences.numberOfHistoryStates = historyLimit;
        } catch (limitError) {
          _hostState.temporaryHistoryFailed = true;
          result = { error: "historyBusy" };
        }
      }
    }
  }
  return result;
}

function _clone(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (obj instanceof Array) {
    var arr = [];
    for (var i = 0; i < obj.length; i++) {
      arr[i] = _clone(obj[i]);
    }
    return arr;
  }
  var result = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) {
      result[key] = _clone(obj[key]);
    }
  }
  return result;
}

function _normalizeTextKey(text) {
  return String(text || "").replace(/\r\n/g, "\r").replace(/\n/g, "\r");
}

function _getHostDefaultStyle() {
  return {
    layerText: {
      textGridding: "none",
      orientation: "horizontal",
      antiAlias: "antiAliasSmooth",
      textStyleRange: [
        {
          from: 0,
          to: 100,
          textStyle: {
            fontPostScriptName: "Tahoma",
            fontName: "Tahoma",
            fontStyleName: "Regular",
            fontScript: 0,
            fontTechnology: 1,
            fontAvailable: true,
            size: 14,
            impliedFontSize: 14,
            horizontalScale: 100,
            verticalScale: 100,
            autoLeading: true,
            tracking: 0,
            baselineShift: 0,
            impliedBaselineShift: 0,
            autoKern: "metricsKern",
            fontCaps: "normal",
            digitSet: "defaultDigits",
            diacXOffset: 0,
            markYDistFromBaseline: 100,
            otbaseline: "normal",
            ligature: true,
            altligature: false,
            connectionForms: false,
            contextualLigatures: true,
            baselineDirection: "withStream",
            color: { red: 0, green: 0, blue: 0 }
          }
        }
      ],
      paragraphStyleRange: [
        {
          from: 0,
          to: 100,
          paragraphStyle: {
            burasagari: "burasagariNone",
            singleWordJustification: "justifyAll",
            justificationMethodType: "justifMethodAutomatic",
            textEveryLineComposer: false,
            alignment: "center",
            hangingRoman: true,
            hyphenate: true
          }
        }
      ]
    },
    typeUnit: "pixelsUnit"
  };
}

function _getHostDefaultStroke() {
  return {
    enabled: false,
    size: 0,
    opacity: 100,
    position: "outer",
    color: { r: 255, g: 255, b: 255 }
  };
}

function _ensureStyle(style) {
  var normalized = style ? _clone(style) : {};
  if (!normalized.textProps || !normalized.textProps.layerText) {
    normalized.textProps = _getHostDefaultStyle();
  }
  if (typeof normalized.stroke === "undefined") {
    normalized.stroke = _getHostDefaultStroke();
  }
  return normalized;
}

function _overrideStyleTextSize(style, size) {
  if (!style || !(size > 0)) return style;
  var ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges.length) return style;
  for (var i = 0; i < ranges.length; i++) {
    if (!ranges[i] || !ranges[i].textStyle) continue;
    ranges[i].textStyle.size = size;
    if (ranges[i].textStyle.impliedFontSize != null) {
      ranges[i].textStyle.impliedFontSize = size;
    }
  }
  return style;
}

function _isPunctuationOnlyText(text) {
  return typeof text === "string" && /^[!?.,;:'"()\[\]~\-\u00A1\u00AB\u00BB\u00BF\u060C\u061B\u061F\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u203C\u203D\u2047\u2048\u2049\u3001\u3002\u301C\uFF01\uFF1F\uFF5E]+$/.test(text.replace(/[\s\u00A0\u202F]+/g, ""));
}

// Style option: a line made only of punctuation ("?!", "!!") is set larger.
// Returns a copy, since one style can serve several selected layers
function _scaleStyleForPunctuationOnlyText(style, text) {
  if (!style) return style;
  var scale = parseFloat(style.punctuationOnlyScale);
  if (!(scale > 1) || !_isPunctuationOnlyText(text)) return style;
  var scaled = _clone(style);
  var ranges = scaled.textProps && scaled.textProps.layerText && scaled.textProps.layerText.textStyleRange;
  if (!ranges) return scaled;
  var fields = ["size", "impliedFontSize", "leading", "impliedLeading"];
  for (var i = 0; i < ranges.length; i++) {
    var textStyle = ranges[i] && ranges[i].textStyle;
    if (!textStyle) continue;
    for (var j = 0; j < fields.length; j++) {
      if (typeof textStyle[fields[j]] === "number") textStyle[fields[j]] *= scale;
    }
  }
  return scaled;
}

// The enlarged text must not wrap or lose a mark in a box sized for the selection
function _punctuationOnlyBoxDimensions(dimensions, data) {
  if (data.textSizeOverride > 0 || !data.style) return dimensions;
  var scale = parseFloat(data.style.punctuationOnlyScale);
  if (!(scale > 1) || !_isPunctuationOnlyText(data.text)) return dimensions;
  return { width: dimensions.width * scale, height: dimensions.height * scale };
}

function _resolveStyleSizeForDocument(style) {
  if (!style || style.autoSizeByPageWidth !== true || !documents.length) return style;
  var presets = style.sizePresets;
  if (!presets || presets.length < 2) return style;

  var pageWidth;
  try {
    pageWidth = activeDocument.width && activeDocument.width.as
      ? activeDocument.width.as("px")
      : parseFloat(activeDocument.width);
  } catch (widthError) {
    return style;
  }
  if (isNaN(pageWidth) || pageWidth <= 0) return style;

  var defaultIndex = parseInt(style.sizePresetDefaultIndex, 10);
  if (isNaN(defaultIndex) || defaultIndex < 0 || defaultIndex >= presets.length) defaultIndex = 0;
  var selectedSize = parseFloat(presets[defaultIndex]);
  var selectedThreshold = -1;
  var minWidths = style.sizePresetMinWidths || [];
  for (var i = 0; i < presets.length; i++) {
    if (i === defaultIndex) continue;
    var threshold = parseFloat(minWidths[i]);
    var presetSize = parseFloat(presets[i]);
    if (!isNaN(threshold) && threshold > 0 && !isNaN(presetSize) && presetSize > 0 &&
        pageWidth >= threshold && threshold > selectedThreshold) {
      selectedThreshold = threshold;
      selectedSize = presetSize;
    }
  }
  if (isNaN(selectedSize) || selectedSize <= 0) return style;

  var ranges = style.textProps && style.textProps.layerText && style.textProps.layerText.textStyleRange;
  if (!ranges || !ranges[0] || !ranges[0].textStyle) return style;
  ranges[0].textStyle.size = selectedSize;
  if (ranges[0].textStyle.impliedFontSize != null) {
    ranges[0].textStyle.impliedFontSize = selectedSize;
  }
  return style;
}

function _changeToPointText() {
  try {
    if (app.activeDocument && app.activeDocument.activeLayer && app.activeDocument.activeLayer.textItem) {
      app.activeDocument.activeLayer.textItem.kind = TextType.POINTTEXT;
      return;
    }
  } catch (e) {}
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextShapeType);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.TextShapeType, charID.Point);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

// _changeToPointText prefers the DOM, which only ever converts the active
// layer. Reading a page converts every text layer at once, and that needs the
// ActionManager form: it applies to the whole selection, each layer on its own.
function _changeSelectionToPointText() {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextShapeType);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.TextShapeType, charID.Point);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

// One Select carrying every identifier, instead of one Select per layer
function _selectLayersAtOnce(layerIds) {
  var reference = new ActionReference();
  for (var index = 0; index < layerIds.length; index++) {
    reference.putIdentifier(charID.Layer, layerIds[index]);
  }
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putBoolean(stringIDToTypeID("makeVisible"), false);
  executeAction(charID.Select, descriptor, DialogModes.NO);
}

// A layer's text read straight off its identifier: no selection, no event, and
// none of the cost that made a long import crawl
function _getTextKeyById(layerId) {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.Text);
  reference.putIdentifier(charID.Layer, layerId);
  return executeActionGet(reference).getObjectValue(charID.Text).getString(charID.Text);
}

function _changeToBoxText() {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextShapeType);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.TextShapeType, stringIDToTypeID("box"));
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _layerIsTextLayer() {
  var layer = _getCurrent(charID.Layer, charID.Text);
  return layer.hasKey(charID.Text);
}

function _getActiveLayerId() {
  var layerIdProp = stringIDToTypeID("layerID");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, layerIdProp);
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  return executeActionGet(reference).getInteger(layerIdProp);
}

function _duplicateActiveLayer() {
  var reference = new ActionReference();
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(stringIDToTypeID("duplicate"), descriptor, DialogModes.NO);
}

function _deleteActiveLayer() {
  var reference = new ActionReference();
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(charID.Delete, descriptor, DialogModes.NO);
}

function _selectLayerById(layerId) {
  var reference = new ActionReference();
  reference.putIdentifier(charID.Layer, layerId);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  executeAction(charID.Select, descriptor, DialogModes.NO);
}

// A history state carries the layer selection it was recorded with, so
// stepping the document back to one restores that selection over whatever the
// typesetter has selected now. Anything that rewinds history has to put the
// current selection back; this is what it needs to remember first.
function _getSelectedLayerIds() {
  var ids = [];
  var targetLayers = stringIDToTypeID("targetLayers");
  var layerIdProp = stringIDToTypeID("layerID");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (!doc.hasKey(targetLayers)) {
    try { ids.push(_getActiveLayerId()); } catch (activeError) {}
    return ids;
  }
  var list = doc.getList(targetLayers);
  var backgroundRef = new ActionReference();
  backgroundRef.putProperty(charID.Property, charID.Background);
  backgroundRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
  var offset = executeActionGet(backgroundRef).getBoolean(charID.Background) ? 0 : 1;
  for (var index = 0; index < list.count; index++) {
    try {
      var idRef = new ActionReference();
      idRef.putProperty(charID.Property, layerIdProp);
      idRef.putIndex(charID.Layer, list.getReference(index).getIndex() + offset);
      ids.push(executeActionGet(idRef).getInteger(layerIdProp));
    } catch (idError) {}
  }
  return ids;
}

function _selectLayersById(layerIds) {
  if (!layerIds || !layerIds.length) return;
  for (var i = 0; i < layerIds.length; i++) {
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, layerIds[i]);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charID.Null, reference);
    descriptor.putBoolean(stringIDToTypeID("makeVisible"), false);
    if (i > 0) {
      descriptor.putEnumerated(
        stringIDToTypeID("selectionModifier"),
        stringIDToTypeID("selectionModifierType"),
        stringIDToTypeID("addToSelection")
      );
    }
    executeAction(charID.Select, descriptor, DialogModes.NO);
  }
}

function _textLayerIsPointText() {
  var textKey = _getCurrent(charID.Layer, charID.Text).getObjectValue(charID.Text);
  var textType = textKey.getList(stringIDToTypeID("textShape")).getObjectValue(0).getEnumerationValue(charID.TextShapeType);
  return textType === charID.Point;
}

function _resolveStylePointText(style, fallbackPointText) {
  if (style && style.textType === "point") return true;
  if (style && style.textType === "paragraph") return false;
  return !!fallbackPointText;
}

function _getTextLayerSize() {
  // jamText.getLayerText() reads the whole text descriptor and converts it to
  // JS objects: 240-690 ms on a page-sized document, for one number. The bubble
  // scan calls this on every layer, and it was two thirds of the scan's cost.
  // The Action Manager answers the same size from the same textKey descriptor
  // in 1-2 ms, measured identical on every layer of the reference page.
  try {
    var reference = new ActionReference();
    reference.putProperty(charID.Property, stringIDToTypeID("textKey"));
    reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    var textKey = executeActionGet(reference).getObjectValue(stringIDToTypeID("textKey"));
    var ranges = textKey.getList(stringIDToTypeID("textStyleRange"));
    if (ranges.count) {
      var textStyle = ranges.getObjectValue(0).getObjectValue(stringIDToTypeID("textStyle"));
      var sizeId = stringIDToTypeID("size");
      var size = 0;
      try {
        size = textStyle.getUnitDoubleValue(sizeId);
      } catch (unitError) {
        size = textStyle.getDouble(sizeId);
      }
      if (size > 0) return size;
    }
  } catch (actionError) {}
  try {
    var textParams = jamText.getLayerText();
    if (textParams && textParams.layerText &&
        textParams.layerText.textStyleRange &&
        textParams.layerText.textStyleRange[0] &&
        textParams.layerText.textStyleRange[0].textStyle &&
        textParams.layerText.textStyleRange[0].textStyle.size) {
      return textParams.layerText.textStyleRange[0].textStyle.size;
    }
  } catch (e) {}
  return _hostState.fallbackTextSize || 20;
}

function _convertPixelToPoint(value) {
  return (parseInt(value) / activeDocument.resolution) * 72;
}

function _convertPixelToPointExact(value) {
  return (value / activeDocument.resolution) * 72;
}

// Span (in points) for the temporary measuring box used while re-flowing
// box text. The type engine's cost scales with the box's PIXEL size, and an
// oversized box makes Photoshop pop its "Processing text" progress dialog
// on every relayout — so derive the span from the document size and cap it
// in pixels instead of using a huge fixed point value.
/*
 * Span the measuring box really needs for this text, in the same unit as the
 * body size.
 *
 * The box above is 2x the page's longest side on each side, and the type engine
 * charges for its area: 7680 x 7680 px on a 2700 x 3840 page, measured at 4 s to
 * 45 s per apply against 389 ms for the same apply on a point layer, which skips
 * the pass. Nothing needs that much room. The box only has to be wider than the
 * longest line the text can render as, and taller than the block: no glyph is
 * wider than its em, so the longest authored line bounds the width, and the line
 * count bounds the height. Both are multiplied out generously — the point is to
 * leave the page-sized box behind, not to fit tightly — and the caller checks
 * that the text stayed clear of both edges before trusting what it measured.
 */
function _getMeasureBoxSpanForText(text, textSize) {
  var size = Number(textSize);
  if (!(size > 0)) return null;
  var lines = String(text == null ? "" : text).replace(/\r\n?/g, "\n").split("\n");
  var widest = 0;
  for (var index = 0; index < lines.length; index++) {
    if (lines[index].length > widest) widest = lines[index].length;
  }
  if (!widest) widest = 1;
  return {
    width: widest * size * 1.5 + size * 4,
    height: lines.length * size * 3 + size * 4
  };
}

function _getMeasureBoxSpanPoints() {
  var spanPx = 20000;
  try {
    var oldUnits = app.preferences.rulerUnits;
    app.preferences.rulerUnits = Units.PIXELS;
    var docSpanPx = 2 * Math.max(parseFloat(activeDocument.width), parseFloat(activeDocument.height));
    app.preferences.rulerUnits = oldUnits;
    if (docSpanPx > 0 && docSpanPx < spanPx) spanPx = docSpanPx;
  } catch (spanError) {}
  return _convertPixelToPointExact(spanPx);
}

function _createCurrent(target, id) {
  var reference = new ActionReference();
  if (id > 0) reference.putProperty(charID.Property, id);
  reference.putEnumerated(target, charID.Ordinal, charID.Target);
  return reference;
}

function _getCurrent(target, id) {
  return executeActionGet(_createCurrent(target, id));
}

function _getCurrentDocumentId() {
  var documentId = stringIDToTypeID("documentID");
  return _getCurrent(charID.Document, documentId).getInteger(documentId);
}

function _documentHasBackgroundLayer() {
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.Background);
  reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
  return executeActionGet(reference).getBoolean(charID.Background);
}

function _getLayerByIndex(index) {
  var reference = new ActionReference();
  reference.putIndex(charID.Layer, index);
  return executeActionGet(reference);
}

function _layerExistsById(id) {
  try {
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, id);
    executeActionGet(reference);
    return true;
  } catch (e) {
    return false;
  }
}

function _setLayerVisibilityByIds(ids, visible) {
  if (!ids || !ids.length) return 0;
  var references = new ActionList();
  var added = 0;
  for (var i = 0; i < ids.length; i++) {
    // A cleaning layer may have been deleted while hidden. Typesetterer
    // silently skipped those stale IDs when restoring them.
    if (visible && !_layerExistsById(ids[i])) continue;
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, ids[i]);
    references.putReference(reference);
    added++;
  }
  if (!added) return 0;
  var descriptor = new ActionDescriptor();
  descriptor.putList(charID.Null, references);
  executeAction(visible ? charID.Show : charID.Hide, descriptor, DialogModes.NO);
  return added;
}

function _collectVisibleCleaningLayerIds() {
  var numberOfLayers = stringIDToTypeID("numberOfLayers");
  var layerSection = stringIDToTypeID("layerSection");
  var layerSectionStart = stringIDToTypeID("layerSectionStart");
  var layerSectionEnd = stringIDToTypeID("layerSectionEnd");
  var index = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
  // Preserve the real background, or the bottom-most layer when the document
  // has no formal background layer, exactly as Typesetterer did.
  var stopIndex = _documentHasBackgroundLayer() ? 0 : 1;
  var parentVisibility = [];
  var ids = [];

  while (index > stopIndex) {
    var layer = _getLayerByIndex(index);
    var section = layer.getEnumerationValue(layerSection);
    if (section === layerSectionStart) {
      parentVisibility.push(layer.getBoolean(charID.Visible));
    } else if (section === layerSectionEnd) {
      parentVisibility.pop();
    } else {
      var parentsVisible = true;
      for (var i = 0; i < parentVisibility.length; i++) {
        parentsVisible = parentsVisible && parentVisibility[i];
      }
      if (
        parentsVisible &&
        !layer.hasKey(charID.Text) &&
        !layer.getBoolean(charID.Background) &&
        layer.getBoolean(charID.Visible) &&
        !layer.hasKey(charID.AdjustmentLayer)
      ) {
        ids.push(layer.getInteger(charID.LayerID));
      }
    }
    index--;
  }
  return ids;
}

function toggleCleaningLayers() {
  if (!documents.length) return "doc";
  var documentKey = String(_getCurrentDocumentId());
  var hiddenByDocument = _hostState.hiddenCleaningLayerIdsByDocument;
  if (hiddenByDocument.hasOwnProperty(documentKey)) {
    var idsToRestore = hiddenByDocument[documentKey];
    _setLayerVisibilityByIds(idsToRestore, true);
    delete hiddenByDocument[documentKey];
    return "shown:" + idsToRestore.length;
  }
  var idsToHide = _collectVisibleCleaningLayerIds();
  _setLayerVisibilityByIds(idsToHide, false);
  hiddenByDocument[documentKey] = idsToHide;
  return "hidden:" + idsToHide.length;
}

function _deselect() {
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putEnumerated(charID.To, charID.Ordinal, charID.None);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _getBoundsFromDescriptor(bounds) {
  var top = bounds.getInteger(charID.Top);
  var left = bounds.getInteger(charID.Left);
  var right = bounds.getInteger(charID.Right);
  var bottom = bounds.getInteger(charID.Bottom);
  return {
    top: top,
    left: left,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function _getCurrentSelectionBounds() {
  var doc = _getCurrent(charID.Document, charID.FrameSelect);
  if (doc.hasKey(charID.FrameSelect)) {
    var bounds = doc.getObjectValue(charID.FrameSelect);
    return _getBoundsFromDescriptor(bounds);
  }
}

function _getCurrentTextLayerBounds() {
  var boundsTypeId = stringIDToTypeID("bounds");
  var bounds = _getCurrent(charID.Layer, boundsTypeId).getObjectValue(boundsTypeId);
  return _getBoundsFromDescriptor(bounds);
}

function _modifySelectionBounds(amount) {
  if (amount == 0) return;
  var size = new ActionDescriptor();
  size.putUnitDouble(charID.By, charID.PixelUnit, Math.abs(amount));
  executeAction(amount > 0 ? charID.Expand : charID.Contract, size, DialogModes.NO);
}


function _getAdjustedSelectionBounds(bounds, amount) {
  if (!bounds || amount === 0) return bounds;

  var doc;
  try {
    doc = app.activeDocument;
  } catch (error) {
    doc = null;
  }

  if (!doc || !doc.selection) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }

  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }

  var adjusted = null;
  try {
    _modifySelectionBounds(amount);
    adjusted = _getCurrentSelectionBounds();
  } catch (error2) {
    adjusted = null;
  } finally {
    try {
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
  }

  if (!adjusted) {
    return _getAdjustedSelectionBoundsFallback(bounds, amount);
  }
  return adjusted;
}

/*
 * The marquee left behind in the temp channel by an interrupted capture, loaded
 * back and the channel dropped, or null when there is nothing to recover. The
 * channel only ever exists while one of our own readers is running, so an orphan
 * one is unambiguous evidence of an abort.
 */
function _recoverSelectionFromTempChannel() {
  try {
    var doc = app.activeDocument;
    if (!doc) return null;
    var channel = doc.channels.getByName(_TEMP_SELECTION_CHANNEL);
    if (!channel) return null;
    var recovered = null;
    try {
      doc.selection.load(channel);
      recovered = _getCurrentSelectionBounds();
    } catch (loadError) {
      recovered = null;
    }
    try { channel.remove(); } catch (removeError) {}
    return recovered || null;
  } catch (missingChannel) {
    return null;
  }
}

function _createTempSelectionChannel(doc) {
  var channel = null;
  try {
    channel = doc.channels.getByName(_TEMP_SELECTION_CHANNEL);
    channel.remove();
  } catch (e) {}

  try {
    channel = doc.channels.add();
    channel.name = _TEMP_SELECTION_CHANNEL;
    doc.selection.store(channel);
    return channel;
  } catch (error) {
    if (channel) {
      try {
        channel.remove();
      } catch (removeError) {}
    }
    return null;
  }
}

function _getAdjustedSelectionBoundsFallback(bounds, amount) {
  if (!bounds || amount === 0) return bounds;
  var delta = Math.abs(amount);
  if (amount < 0) {
    if (bounds.width <= delta * 2 || bounds.height <= delta * 2) {
      return null;
    }
    var contracted = {
      top: bounds.top + delta,
      left: bounds.left + delta,
      right: bounds.right - delta,
      bottom: bounds.bottom - delta,
    };
    contracted.width = contracted.right - contracted.left;
    contracted.height = contracted.bottom - contracted.top;
    contracted.xMid = (contracted.left + contracted.right) / 2;
    contracted.yMid = (contracted.top + contracted.bottom) / 2;
    return contracted;
  } else {
    var expanded = {
      top: Math.max(bounds.top - delta, 0),
      left: Math.max(bounds.left - delta, 0),
      right: bounds.right + delta,
      bottom: bounds.bottom + delta,
    };
    expanded.width = expanded.right - expanded.left;
    expanded.height = expanded.bottom - expanded.top;
    expanded.xMid = (expanded.left + expanded.right) / 2;
    expanded.yMid = (expanded.top + expanded.bottom) / 2;
    return expanded;
  }
}

function _clampAdjustAmount(bounds, amount) {
  if (!bounds || amount >= 0) return amount;
  // Avoid over-contracting small selections: keep at least 2px margin per side
  var maxContract = Math.floor(Math.min(bounds.width, bounds.height) / 2 - 1);
  if (maxContract <= 0) return 0;
  return -Math.min(Math.abs(amount), maxContract);
}

function _getAdaptiveSelectionOpenRadius(bounds) {
  if (!bounds) return 0;
  var shortestSide = Math.min(bounds.width, bounds.height);
  var maxRadius = Math.floor(shortestSide / 2 - 1);
  if (maxRadius <= 0) return 0;
  var radius = Math.max(_MIN_SELECTION_OPEN_RADIUS, Math.round(shortestSide * _SELECTION_OPEN_RATIO));
  return Math.min(radius, maxRadius, _MAX_SELECTION_OPEN_RADIUS);
}

// Morphological opening of the selection (contract then expand by the same
// radius): cuts the bubble's tail. It wipes everything thinner than the radius,
// and a marquee taken around a text has holes on its letters: the strip between
// the text and the outline goes, and the bounds shrink towards the far side of
// the bubble. `holes` lists the text boxes to fill for the measure.
function _getAdaptiveOpenedSelectionBounds(bounds, holes) {
  if (!bounds) return bounds;

  // A region covering a quarter of the page is a fill that escaped the balloon,
  // and `_openedSelectionCentroid` already refuses to trace it. Refusing after
  // the opening meant paying for the opening anyway, and the opening is the
  // expensive half: measured on a wand that swallowed 97,6% of a 6331x8882 smart
  // object interior, one poll cost 5 982 ms — a temp channel of 56 megapixels
  // plus Contract/Expand at 629 px, retried at halved radii because the
  // contraction annihilated the selection. Multi-bubble polls this on every
  // selection change and every 1,5 s, so Photoshop spent six seconds of every one
  // and a half working on a region whose outline was going to be thrown away.
  // The raw bounds are what multi-bubble stores for these regions anyway, and
  // Align narrows them to the text's neighbourhood right after.
  if (_regionCoversTooMuchPage(bounds)) {
    _hostState.centroidSkip = "coversPage";
    return bounds;
  }

  var radius = _getAdaptiveSelectionOpenRadius(bounds);
  if (radius <= 0) return bounds;

  var doc;
  try {
    doc = app.activeDocument;
  } catch (error) {
    doc = null;
  }

  if (!doc || !doc.selection) {
    return bounds;
  }

  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return bounds;
  }

  var opened = null;
  var attemptRadius = radius;
  try {
    while (attemptRadius >= 1 && !opened) {
      if (attemptRadius !== radius) {
        try {
          doc.selection.load(tempChannel);
        } catch (retryRestoreError) {
          break;
        }
      }

      var candidate = null;
      _fillSelectionHoles(holes, bounds);
      try {
        _modifySelectionBounds(-attemptRadius);
        var contracted = _getCurrentSelectionBounds();
        if (contracted && contracted.width > 1 && contracted.height > 1) {
          _modifySelectionBounds(attemptRadius);
          candidate = _getCurrentSelectionBounds();
        }
      } catch (openError) {
        candidate = null;
      }

      if (candidate && candidate.width * candidate.height >= 200) {
        // The balloon outline only exists while this opened selection is live,
        // and `Make Work Path` consumes the selection — the finally below
        // restores the caller's selection from the channel either way, so the
        // centroid rides along for free instead of paying for a second channel
        // and a second contract/expand pair.
        candidate.centroid = _openedSelectionCentroid(doc, candidate);
        opened = candidate;
      } else {
        attemptRadius = Math.floor(attemptRadius / 2);
      }
    }
  } finally {
    try {
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    // Second chance on the unopened selection. A fill that escaped the balloon and
    // was then narrowed to the text is a mesh of thin white slivers around the
    // artwork: opening it either wipes it out entirely or leaves a selection whose
    // 50% threshold no longer closes any contour, and `Make Work Path` then
    // returns an empty path (measured: 0 subpaths after a 9 px opening, 2 059
    // subpaths and 10 740 anchors on the same selection unopened). The raw
    // outline's centroid landed 10 px from where the typesetter had put the text,
    // while giving up on it fell back to the bounding-box centre and let the
    // phantom offset back in, costing 405 px.
    var target = opened || bounds;
    if (target && !target.centroid && _centroidRetryWorthIt(opened ? _hostState.centroidSkip : "")) {
      try {
        target.centroid = _openedSelectionCentroid(doc, _getCurrentSelectionBounds() || target);
      } catch (rawCentroidError) {}
    }
    // `Make Work Path` consumes the selection, and the retry above runs it on the
    // caller's own marquee. Multi-bubble polls this helper for every new
    // selection, so a marquee the user had just drawn was silently dropped
    // whenever the centroid was refused — and the next poll then read the empty
    // document as "the user deselected" and wiped the whole stored batch.
    // Checked rather than assumed: the load above can fail too, and no reader of
    // these bounds has ever been allowed to cost the user their selection.
    try {
      if (!_getCurrentSelectionBounds()) {
        doc.selection.load(tempChannel);
      }
    } catch (finalRestoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
  }

  return opened || bounds;
}

/*
 * Is a second trace on the unopened selection worth the cost? Everything gets
 * the retry except the refusals the unopened selection cannot possibly fix,
 * because it is larger, not smaller: a region already too big to trace, an
 * outline already over the anchor budget, and a work path that belongs to the
 * user. Skipping those is not an optimisation for its own sake — each trace runs
 * `Make Work Path` on the marquee the user is still holding, and a large
 * selection blows the budget on both passes, so retrying it paid twice for the
 * same refusal.
 */
function _centroidRetryWorthIt(skip) {
  if (!skip) return true;
  // Only the empty trace is worth repeating — that is the case the retry was
  // added for (Task 14: 0 subpaths after the opening, 2 059 on the same selection
  // unopened). Every other refusal already paid for a full trace on the way to
  // being refused, and the unopened selection is larger, not smaller, so the
  // second trace bought the same refusal twice on the marquee the user is still
  // holding.
  if (skip.indexOf("anchors:") === 0) return Number(skip.substring(8)) <= 2;
  return false;
}

// The part of each box inside `bounds`: a text beside the marquee fills nothing
function _fillSelectionHoles(holes, bounds) {
  for (var i = 0; holes && i < holes.length; i++) {
    var inside = _rectOverlap(holes[i], bounds);
    if (!inside) continue;
    try {
      _addRectToSelection(inside);
    } catch (fillError) {}
  }
}

function _selectionBoundsKey(bounds) {
  if (!bounds) return "";
  return bounds.xMid + "_" + bounds.yMid + "_" + bounds.width + "_" + bounds.height;
}

function _calculateSelectionDimensions(selection, padding) {
  if (!selection) return { width: 0, height: 0 };
  var width = selection.width * _DEFAULT_SELECTION_SCALE;
  if (padding > 0) {
    width = Math.max(width - padding * 2, _MIN_TEXTBOX_WIDTH);
  }
  return {
    width: width,
    height: selection.height,
  };
}

function _resizeTextBoxToContent(width, currentBounds) {
  var textParams = jamText.getLayerText();
  var textSize = textParams.layerText.textStyleRange[0].textStyle.size;
  _setTextBoxSize(width, currentBounds.height + textSize + 2);
}

/*
 * The single place where all three paths (Paste, Align, multi-bubble) move a
 * text layer. `target` is the centre the layer should land on; when it is
 * missing the selection's bounding-box centre is used, which is the historical
 * behaviour.
 *
 * `phantomOffsetX` is TextShapeR's horizontal correction for a balloon cut by
 * the panel edge, and it was calibrated against the bounding-box centre: it
 * shifts the layer by a fraction of the balloon width to compensate for the half
 * of the balloon that is not visible. A centroid target already carries that
 * asymmetry, so applying both corrected the same thing twice and threw the text
 * far to the left, out of the balloon. The offset therefore only applies when
 * there is no target on that axis.
 */
function _positionLayerWithinSelection(selection, bounds, phantomOffsetX, target) {
  if (!selection || !bounds) return;
  var hasTargetX = !!(target && isFinite(target.x));
  var targetX = hasTargetX ? target.x : selection.xMid;
  var targetY = target && isFinite(target.y) ? target.y : selection.yMid;
  var offsetX = targetX - bounds.xMid + (hasTargetX ? 0 : (Number(phantomOffsetX) || 0));
  var offsetY = targetY - bounds.yMid;
  _moveLayer(offsetX, offsetY);
}

function _wandAt(x, y, tolerance) {
  _checkWandPointOnCanvas(x, y);
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

/*
 * Probe the balloon from inside the text instead of five pixels to its left.
 * The wand samples the merged image, so the glyphs are hidden first: otherwise
 * a probe on a letter would select the letter. Sampling next to the text failed
 * whenever the text nearly filled the balloon, because the probe landed outside
 * and the fill grabbed the panel instead.
 */
/*
 * Which of these points lands in the balloon. Returns its index, or -1 when none
 * of them does.
 */
function _bestBalloonProbe(probes, bounds, tolerance) {
  var best = { probe: -1, area: 0 };
  for (var p = 0; p < probes.length; p++) {
    var found = null;
    try {
      _wandAt(Math.round(probes[p][0]), Math.round(probes[p][1]), tolerance);
      found = _getCurrentSelectionBounds() || null;
    } catch (probeError) {
      found = null;
    }
    if (!found || found.width * found.height < 200) continue;
    if (_regionCoversTooMuchPage(found)) continue;
    var area = found.width * found.height;
    // The balloon holds the text it belongs to. A glyph the fill mistook for a
    // region does not, and neither does a strip of panel beside the balloon.
    if (found.left > bounds.xMid || found.right < bounds.xMid) continue;
    if (found.top > bounds.yMid || found.bottom < bounds.yMid) continue;
    if (area > best.area) {
      best.area = area;
      best.probe = p;
    }
    // The middle of the text box is the probe that has always been used, and on
    // a page with nothing lying over this line it already found the balloon.
    // Stopping here keeps that page at exactly one wand.
    if (p === 0) break;
  }
  return best;
}

/*
 * How far a region's centre sits from the line being centred. -1 when there is
 * no centre to measure.
 */
function _distanceFromCentroid(region, bounds) {
  if (!region) return -1;
  var centre = region.centroid || { x: region.xMid, y: region.yMid };
  if (!isFinite(centre.x) || !isFinite(centre.y)) return -1;
  var dx = centre.x - bounds.xMid;
  var dy = centre.y - bounds.yMid;
  return Math.sqrt(dx * dx + dy * dy);
}

/*
 * How much two boxes cover each other, as a fraction of the one they cover most.
 *
 * Of the smaller one, in practice. A short line dropped across a long one covers
 * only a few per cent of it — 3% measured on 0029 — while the long one covers
 * almost all of the short one, and the bite it takes out of the balloon is just
 * as bad either way round.
 */
function _boxOverlapShare(other, box) {
  var width = Math.min(other.right, box.right) - Math.max(other.left, box.left);
  var height = Math.min(other.bottom, box.bottom) - Math.max(other.top, box.top);
  if (width <= 0 || height <= 0) return 0;
  var overlap = width * height;
  var mine = box.width * box.height;
  var theirs = other.width * other.height;
  var smallest = Math.min(mine > 0 ? mine : theirs, theirs > 0 ? theirs : mine);
  return smallest > 0 ? overlap / smallest : 0;
}

/*
 * The visible text layers lying across `box`, by id.
 *
 * Walked through the Action Manager rather than the DOM, and reading one
 * descriptor per layer instead of one round trip per property. The DOM version
 * of this — `container.layers`, `.typename`, `.kind`, `.visible`, then the
 * bounds — ran on every Align whether or not anything overlapped, and measured
 * about 100 s across the 14 reference pages: more than the balloon refill it was
 * there to decide, which fires on two layers in ninety-eight.
 */
function _collectOverlappingTextLayerIds(box, ids, limit) {
  var numberOfLayers = stringIDToTypeID("numberOfLayers");
  var layerSection = stringIDToTypeID("layerSection");
  var layerSectionStart = stringIDToTypeID("layerSectionStart");
  var layerSectionEnd = stringIDToTypeID("layerSectionEnd");
  var boundsId = stringIDToTypeID("bounds");
  var index = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
  var stopIndex = _documentHasBackgroundLayer() ? 0 : 1;
  var parentVisibility = [];

  while (index > stopIndex && ids.length < limit) {
    var layer = _getLayerByIndex(index);
    var section = layer.getEnumerationValue(layerSection);
    if (section === layerSectionStart) {
      parentVisibility.push(layer.getBoolean(charID.Visible));
    } else if (section === layerSectionEnd) {
      parentVisibility.pop();
    } else if (layer.hasKey(charID.Text) && layer.getBoolean(charID.Visible)) {
      var parentsVisible = true;
      for (var i = 0; i < parentVisibility.length; i++) {
        parentsVisible = parentsVisible && parentVisibility[i];
      }
      if (parentsVisible && layer.hasKey(boundsId)) {
        var other = _getBoundsFromDescriptor(layer.getObjectValue(boundsId));
        if (_boxOverlapShare(other, box) >= _PROBE_OVERLAP_SHARE) {
          ids.push(layer.getInteger(charID.LayerID));
        }
      }
    }
    index--;
  }
}

function _createBalloonWandSelection(tolerance) {
  var layer = null;
  var wasVisible = true;
  var bounds = null;
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {
    return;
  }
  if (!bounds) return;

  // Probe the balloon from several points inside the text box, not only its
  // middle.
  //
  // The wand samples the merged image, and only the layer being centred is
  // hidden. A neighbouring line dropped across the middle of this one — which is
  // what the typesetter has after throwing the lines roughly into place — is
  // still painted there, so the probe lands on a glyph, the fill runs out into
  // whatever artwork that glyph touches, and the text ends up nowhere near the
  // balloon.
  //
  // Hiding every text layer instead was measured and is much worse: where two
  // balloons touch, the neighbours' ink is what stops the wand crossing from one
  // into the other, and without it the region becomes both balloons at once —
  // the 95th percentile of |dX| in the shared regions went from 70 px to 207 px,
  // with whole lines landing in the wrong balloon. Hiding only the lines that
  // overlap this one has the same failure in miniature, and it makes the answer
  // move when the neighbours move, which is exactly what the geometry rewrite
  // was for.
  //
  // Extra probes cost nothing: the page is composed once, and each retry is one
  // more wand on the image already in memory. On a page where nothing overlaps,
  // every probe finds the same balloon and the result is what it always was.
  var probes = [
    [bounds.xMid, bounds.yMid],
    [bounds.left + bounds.width * 0.25, bounds.top + bounds.height * 0.25],
    [bounds.left + bounds.width * 0.75, bounds.top + bounds.height * 0.25],
    [bounds.left + bounds.width * 0.25, bounds.top + bounds.height * 0.75],
    [bounds.left + bounds.width * 0.75, bounds.top + bounds.height * 0.75]
  ];

  try {
    layer = app.activeDocument.activeLayer;
    wasVisible = layer.visible;
  } catch (layerError) {
    layer = null;
  }
  try {
    if (layer && wasVisible) layer.visible = false;
  } catch (hideError) {}

  // Why the probe ended up where it did, and whether the bite had to be given
  // back. Without it a balloon the first point found looks the same as one that
  // needed repairing.
  _hostState.probe = { chosen: -1, hidden: 0, cleaned: false, refused: false };
  _hostState.cleanCandidate = null;

  var found = _bestBalloonProbe(probes, bounds, tolerance);
  _hostState.probe.chosen = found.probe;

  // The caller reads the live selection, so the chosen point has to be the last
  // one probed. With no winner at all the middle is probed again, which is
  // exactly the selection this used to hand back.
  var last = found.probe >= 0 ? found.probe : 0;
  try {
    if (last !== probes.length - 1) {
      _wandAt(Math.round(probes[last][0]), Math.round(probes[last][1]), tolerance);
    }
  } catch (reselectError) {}

  // Take the bite out of the region that the lines lying over this one left in it.
  //
  // The wand samples the merged image with only this layer hidden, so every other
  // line is painted: where their ink crosses the balloon it is missing from the
  // region, and the centre of what is left is not the centre of the balloon.
  // Measured on the reference pages with one neighbour dropped over the middle of
  // each line, that bite moved the answer 174 px, 188 px and 411 px on three of
  // the six lines of 0029 and 237 px, 356 px and 501 px on 11, while the same
  // pages centre every line inside 25 px with nothing lying over them.
  //
  // Hiding those lines and flooding the balloon again is what fixes it. Adding
  // their ink back to the region instead was measured twice and is worse both
  // ways: a whole line's ink pulls the region towards the balloon that line is
  // really in (the median error of the shared regions went from 13 px to 29 px),
  // and cutting it to this line's own box gives back too little.
  //
  // The balloon found this way is only a candidate: it is opened here, and the
  // caller decides between it and the one the page really has. The caller is
  // where the dirty region gets opened anyway, so comparing there costs one
  // opening instead of two — measured, doing both here put the page 20,3% over
  // the engine it replaced, against a ceiling of 15%.
  var textIds = [];
  try {
    _collectOverlappingTextLayerIds(bounds, textIds, 80);
  } catch (collectError) {
    textIds = [];
  }

  _hostState.probe.hidden = textIds.length;
  if (!textIds.length) {
    try {
      if (layer && wasVisible) layer.visible = true;
    } catch (showNoneError) {}
    return;
  }

  try {
    _setLayerVisibilityByIds(textIds, false);
    var clean = _bestBalloonProbe(probes, bounds, tolerance);
    if (clean.probe >= 0) {
      var cleanOpened = _getAdaptiveOpenedSelectionBounds(_getCurrentSelectionBounds());
      if (cleanOpened && cleanOpened.centroid) {
        _hostState.cleanCandidate = {
          region: cleanOpened,
          away: _distanceFromCentroid(cleanOpened, bounds),
          probe: clean.probe,
          // The outline traced during that opening, which the cut needs and
          // which the caller's own opening is about to overwrite.
          outline: _hostState.lastOutline,
          outlineKey: _hostState.lastOutlineKey
        };
        _hostState.probe.chosen = clean.probe;
      }
    }
  } catch (cleanError) {
    _hostState.probe.threw = String(cleanError && cleanError.message ? cleanError.message : cleanError);
    _hostState.cleanCandidate = null;
  } finally {
    // A throw between the two would leave those lines invisible, which reads as
    // the plugin having deleted the typesetter's work.
    try { _setLayerVisibilityByIds(textIds, true); } catch (showAllError) {}
  }

  // The opening left the selection opened rather than filled, and the caller
  // reads the live selection, so the region has to be taken again.
  try {
    _wandAt(Math.round(probes[last][0]), Math.round(probes[last][1]), tolerance);
  } catch (restoreError) {}

  try {
    if (layer && wasVisible) layer.visible = true;
  } catch (showError) {}
}

function _moveLayer(offsetX, offsetY) {
  var amount = new ActionDescriptor();
  amount.putUnitDouble(charID.Horizontal, charID.PixelUnit, offsetX);
  amount.putUnitDouble(charID.Vertical, charID.PixelUnit, offsetY);
  var target = new ActionDescriptor();
  target.putReference(charID.Null, _createCurrent(charID.Layer));
  target.putObject(charID.To, charID.Offset, amount);
  executeAction(charID.Move, target, DialogModes.NO);
}

/* ========================================================= */
/* ===== bubble detection: auto-centre and double bubble ==== */
/* ========================================================= */
// Auto-centre after a paste (off / single / multi) and "centre double
// bubble". uxp-src/host/photoshop.js mirrors this section function for
// function; scripts/testUxpHost.js compares the pure helpers.
// Every wand probe replaces the live selection: the callers park the user's
// selection in a channel first (_saveSelectionState) and put it back after.
// The optional double-bubble wand mode may override
// _getAdaptiveOpenedSelectionBounds and answer {error}: _openedBubble checks
// every answer and falls back on the probed bubble itself.

var _AUTO_CENTER_MODES = { single: true, multi: true };
var _BUBBLE_WAND_TOLERANCE = 20;
var _MAX_BUBBLE_RATIO = 40;
var _MIN_BUBBLE_AREA = 200;
// A probe that lands on a glyph straddling the text centre selects that
// glyph: a bubble covers at least half the area of its text
var _MIN_BUBBLE_TEXT_COVER = 0.5;
var _MIN_DISPLAYED_TEXT_SIZE = 1;
var _SAVED_SELECTION_CHANNEL = "__TyperSavedSelection__";

/* ----------------------- pure helpers ----------------------- */

function _rectFrom(left, top, right, bottom) {
  left = Number(left);
  top = Number(top);
  right = Number(right);
  bottom = Number(bottom);
  if (!isFinite(left) || !isFinite(top) || !isFinite(right) || !isFinite(bottom)) return null;
  if (right <= left || bottom <= top) return null;
  return {
    top: top,
    left: left,
    right: right,
    bottom: bottom,
    width: right - left,
    height: bottom - top,
    xMid: (left + right) / 2,
    yMid: (top + bottom) / 2,
  };
}

function _unionRect(rects) {
  if (!rects || !rects.length) return null;
  var left = rects[0].left, top = rects[0].top, right = rects[0].right, bottom = rects[0].bottom;
  for (var i = 1; i < rects.length; i++) {
    if (rects[i].left < left) left = rects[i].left;
    if (rects[i].top < top) top = rects[i].top;
    if (rects[i].right > right) right = rects[i].right;
    if (rects[i].bottom > bottom) bottom = rects[i].bottom;
  }
  return _rectFrom(left, top, right, bottom);
}

function _sameRect(a, b) {
  return !!(a && b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom);
}

// A bubble is neither a speck nor most of the page
function _usableBubble(rect, docSize) {
  if (!rect) return null;
  var area = rect.width * rect.height;
  if (docSize && docSize.width && docSize.height && area > docSize.width * docSize.height * 0.45) return null;
  if (area < _MIN_BUBBLE_AREA) return null;
  return rect;
}

function _rectOverlap(a, b) {
  if (!a || !b) return null;
  return _rectFrom(Math.max(a.left, b.left), Math.max(a.top, b.top), Math.min(a.right, b.right), Math.min(a.bottom, b.bottom));
}

function _containsPoint(rect, x, y, tolerance) {
  var t = tolerance || 0;
  return x >= rect.left - t && x <= rect.right + t && y >= rect.top - t && y <= rect.bottom + t;
}

function _containsBox(rect, box, tolerance) {
  var t = tolerance === undefined ? 2 : tolerance;
  return box.left >= rect.left - t && box.right <= rect.right + t && box.top >= rect.top - t && box.bottom <= rect.bottom + t;
}

// A wand probe can leak into a neighbouring bubble, a merged double bubble or
// the page background: a candidate is the bubble of a text only when it holds
// the text centre, is not absurdly larger than the text and holds no centre
// that must stay out (the other half of a double bubble).
function _bubbleCandidateValid(rect, box, docSize, exclude, sizePixels) {
  if (!_usableBubble(rect, docSize) || !box) return false;
  if (!_containsPoint(rect, box.xMid, box.yMid, 1)) return false;
  if (rect.width * rect.height < box.width * box.height * _MIN_BUBBLE_TEXT_COVER) return false;
  var pad = 4 * (sizePixels > 0 ? sizePixels : 20);
  var reference = (box.width + pad) * (box.height + pad);
  if (rect.width * rect.height > reference * _MAX_BUBBLE_RATIO) return false;
  var others = exclude || [];
  for (var i = 0; i < others.length; i++) {
    if (_containsPoint(rect, others[i].xMid, others[i].yMid)) return false;
  }
  return true;
}

// Left, right, above, below the text, then its centre
function _probePoints(box, margin) {
  return [
    [box.left - margin, box.yMid],
    [box.right + margin, box.yMid],
    [box.xMid, box.top - margin],
    [box.xMid, box.bottom + margin],
    [box.xMid, box.yMid],
  ];
}

function _probeMargin(size) {
  var value = Number(size);
  if (!isFinite(value) || !value) value = 20;
  return Math.max(5, Math.min(40, Math.round(value * 0.25)));
}

// A candidate holding the whole text wins at once; otherwise the smallest
function _pickBubble(current, candidate, box) {
  if (current && current.whole) return current;
  if (_containsBox(candidate, box)) {
    candidate.whole = true;
    return candidate;
  }
  return !current || candidate.width * candidate.height < current.width * current.height ? candidate : current;
}

function _copyProbe(found, x, y) {
  var copy = _rectFrom(found.left, found.top, found.right, found.bottom);
  copy.probeX = x;
  copy.probeY = y;
  return copy;
}

function _sortByKey(entries, key) {
  // Insertion sort: stable, and clearer than a comparator over a few items
  for (var i = 1; i < entries.length; i++) {
    var current = entries[i];
    var j = i - 1;
    while (j >= 0 && entries[j][key] > current[key]) {
      entries[j + 1] = entries[j];
      j--;
    }
    entries[j + 1] = current;
  }
  return entries;
}

function _separatedOrder(boxes, lo, hi) {
  var order = [];
  for (var i = 0; i < boxes.length; i++) {
    order.push({ box: boxes[i], index: i, sum: boxes[i][lo] + boxes[i][hi] });
  }
  _sortByKey(order, "sum");
  for (var k = 1; k < order.length; k++) {
    if (order[k].box[lo] < order[k - 1].box[hi]) return null;
  }
  return order;
}

function _cutLimits(rect, boxes, order, lo, hi, loValue, hiValue) {
  var limits = [];
  for (var i = 0; i < boxes.length; i++) limits.push([rect[lo], rect[hi]]);
  for (var k = 1; k < order.length; k++) {
    var cut = (loValue(order[k - 1]) + hiValue(order[k])) / 2;
    limits[order[k - 1].index][1] = cut;
    limits[order[k].index][0] = cut;
  }
  return limits;
}

function _boxRight(entry) {
  return entry.box.right;
}

function _boxLeft(entry) {
  return entry.box.left;
}

function _boxBottom(entry) {
  return entry.box.bottom;
}

function _boxTop(entry) {
  return entry.box.top;
}

function _entryCentre(entry) {
  return entry.centre;
}

// Cuts a merged bubble into one part per text, only along the axes where the
// texts are apart, in the middle of the gap between neighbouring texts.
// Overlapping texts are cut between their centres, on the axis they are
// furthest apart. Parts come back in the order of `boxes`.
function _splitBubble(rect, boxes) {
  var parts = [];
  var i;
  var byX = _separatedOrder(boxes, "left", "right");
  var byY = _separatedOrder(boxes, "top", "bottom");
  if (!byX && !byY) {
    var minX = boxes[0].xMid, maxX = boxes[0].xMid, minY = boxes[0].yMid, maxY = boxes[0].yMid;
    for (i = 1; i < boxes.length; i++) {
      minX = Math.min(minX, boxes[i].xMid);
      maxX = Math.max(maxX, boxes[i].xMid);
      minY = Math.min(minY, boxes[i].yMid);
      maxY = Math.max(maxY, boxes[i].yMid);
    }
    var horizontal = maxX - minX >= maxY - minY;
    var mid = horizontal ? "xMid" : "yMid";
    var centres = [];
    for (i = 0; i < boxes.length; i++) centres.push({ box: boxes[i], index: i, centre: boxes[i][mid] });
    _sortByKey(centres, "centre");
    var limits = horizontal
      ? _cutLimits(rect, boxes, centres, "left", "right", _entryCentre, _entryCentre)
      : _cutLimits(rect, boxes, centres, "top", "bottom", _entryCentre, _entryCentre);
    for (i = 0; i < boxes.length; i++) {
      parts.push((horizontal
        ? _rectFrom(limits[i][0], rect.top, limits[i][1], rect.bottom)
        : _rectFrom(rect.left, limits[i][0], rect.right, limits[i][1])) || rect);
    }
    return parts;
  }
  var xs = byX ? _cutLimits(rect, boxes, byX, "left", "right", _boxRight, _boxLeft) : null;
  var ys = byY ? _cutLimits(rect, boxes, byY, "top", "bottom", _boxBottom, _boxTop) : null;
  for (i = 0; i < boxes.length; i++) {
    var left = xs ? xs[i][0] : rect.left;
    var right = xs ? xs[i][1] : rect.right;
    var top = ys ? ys[i][0] : rect.top;
    var bottom = ys ? ys[i][1] : rect.bottom;
    parts.push(_rectFrom(left, top, right, bottom) || rect);
  }
  return parts;
}

function _idInList(id, ids) {
  for (var i = 0; i < ids.length; i++) {
    if (ids[i] === id) return true;
  }
  return false;
}

function _autoCenterEnabled(data) {
  return !!(data && _AUTO_CENTER_MODES[data.autoCenter] === true);
}

// "Centre double bubble" needs at least two layers, all of them text
function _doubleBubbleEntriesValid(entries) {
  if (!entries || entries.length < 2) return false;
  for (var i = 0; i < entries.length; i++) {
    if (!entries[i] || !entries[i].text) return false;
  }
  return true;
}

function _transformScale(layerText) {
  var t = layerText && layerText.transform;
  if (!t) return 1;
  var xx = Number(t.xx) || 0, xy = Number(t.xy) || 0, yx = Number(t.yx) || 0, yy = Number(t.yy) || 0;
  var sx = Math.sqrt(xx * xx + xy * xy);
  var sy = Math.sqrt(yx * yx + yy * yy);
  var scale = sy || sx;
  return isFinite(scale) && scale > 0 ? scale : 1;
}

function _typeValueToPixels(value, unit, resolution) {
  if (unit === "pixelsUnit") return value;
  if (unit === "millimetersUnit") return value * resolution / 25.4;
  return value * resolution / 72;
}

function _typeValueToPoints(value, unit, resolution) {
  if (unit === "pixelsUnit") return value * 72 / (resolution || 72);
  if (unit === "millimetersUnit") return value * 72 / 25.4;
  return value;
}

function _pointsToTypeUnit(value, unit, resolution) {
  if (unit === "pixelsUnit") return value * (resolution || 72) / 72;
  if (unit === "millimetersUnit") return value * 25.4 / 72;
  return value;
}

// The size Photoshop shows is the stored size times the layer transform
function _displayedTextSize(textParams, resolution) {
  var result = { value: NaN, unit: "pointsUnit", pixels: NaN };
  var layerText = textParams && textParams.layerText;
  var range = layerText && layerText.textStyleRange && layerText.textStyleRange[0];
  var style = range && range.textStyle;
  if (!style) return result;
  result.unit = textParams.typeUnit || "pointsUnit";
  var base = Number(style.size);
  var implied = Number(style.impliedFontSize);
  // No nested ternary here: once minified ExtendScript misreads it
  var value = NaN;
  if (isFinite(implied) && implied > 0) {
    value = implied;
  } else if (isFinite(base)) {
    value = base * _transformScale(layerText);
  }
  if (!isFinite(value) || value <= 0) return result;
  result.value = value;
  result.pixels = _typeValueToPixels(value, result.unit, resolution || 72);
  return result;
}

// Photoshop reads `size`, `leading` and `baselineShift` before the layer
// transform but takes a written value as a displayed one: a stored value
// written back on a scaled layer would change the text by the transform.
function _displayedStyleValue(style, key, impliedKey, scale) {
  var implied = style[impliedKey];
  if (implied !== undefined && implied !== null && isFinite(Number(implied))) return Number(implied);
  return Number(style[key]) * scale;
}

// A box frame scaled with its text. Point text has no frame: null.
function _scaleTextShape(shape, ratio) {
  if (!shape || shape.textType !== "box" || !shape.bounds) return null;
  var scaled = _clone(shape);
  var keys = ["top", "left", "right", "bottom"];
  for (var i = 0; i < keys.length; i++) {
    var value = Number(scaled.bounds[keys[i]]);
    if (isFinite(value)) scaled.bounds[keys[i]] = value * ratio;
  }
  return scaled;
}

// Size +/-: the step applies to the displayed size (stored size x layer
// transform), so a scaled layer moves by what the user sees; the stored size
// changes by the same ratio. The fast path is only safe when every run has
// the same size, and a fixed leading only scales when it is shared too.
// `frame` is the box frame before the change: the caller scales it by the
// ratio Photoshop really applied (see _fitFrameToTextSize).
function _textResizePlan(textParams, delta, resolution) {
  var layerText = textParams && textParams.layerText;
  var ranges = layerText && layerText.textStyleRange;
  if (!ranges || !ranges.length) return null;
  var sized = [];
  for (var i = 0; i < ranges.length; i++) {
    if (ranges[i] && ranges[i].textStyle && Number(ranges[i].textStyle.size) > 0) sized.push(ranges[i].textStyle);
  }
  if (!sized.length) return null;
  var first = sized[0];
  var base = Number(first.size);
  var shown = _displayedTextSize(textParams, resolution).value;
  if (!(base > 0) || !(shown > 0) || !isFinite(delta)) return null;
  var nextShown = Math.max(_MIN_DISPLAYED_TEXT_SIZE, shown + delta);
  var uniform = true;
  var scaleLeading = !first.autoLeading && first.leading !== undefined && first.leading !== null;
  for (var k = 0; k < sized.length; k++) {
    if (Number(sized[k].size) !== base) uniform = false;
    if (sized[k].autoLeading || sized[k].leading === undefined || Number(sized[k].leading) !== Number(first.leading)) scaleLeading = false;
  }
  var shape = layerText.textShape && layerText.textShape[0];
  var ratio = nextShown / shown;
  return {
    ratio: ratio,
    nextShown: nextShown,
    base: base,
    unit: textParams.typeUnit || "pointsUnit",
    uniform: uniform,
    scaleLeading: scaleLeading,
    nextLeading: scaleLeading ? _displayedStyleValue(first, "leading", "impliedLeading", _transformScale(layerText)) * ratio : NaN,
    frame: shape && shape.textType === "box" && shape.bounds ? _clone(shape) : null,
  };
}

// Photoshop may round the size it stores: the frame follows the size it
// really applied, read back before and after the change. Frame and size then
// keep the same proportion whatever the series of +/- presses.
function _appliedSizeRatio(before, after, fallback) {
  if (before && after && before.unit === after.unit && before.value > 0 && after.value > 0) {
    return after.value / before.value;
  }
  return fallback;
}

var _KNOWN_TYPE_UNITS = { pointsUnit: true, pixelsUnit: true, millimetersUnit: true };

// TextShapeR only changes line breaks: the size, leading and auto-leading the
// layer has right now win over the snapshot (which may be stale or in another
// unit).
function _keepLiveTextSize(newTextParams, liveParams, resolution) {
  var liveRange = liveParams && liveParams.layerText && liveParams.layerText.textStyleRange && liveParams.layerText.textStyleRange[0];
  var live = liveRange && liveRange.textStyle;
  var ranges = newTextParams && newTextParams.layerText && newTextParams.layerText.textStyleRange;
  if (!live || !ranges) return newTextParams;
  var liveUnit = liveParams.typeUnit;
  var targetUnit = newTextParams.typeUnit;
  var convert = false;
  if (!targetUnit && liveUnit) {
    newTextParams.typeUnit = liveUnit;
  } else if (liveUnit && targetUnit && liveUnit !== targetUnit) {
    if (!_KNOWN_TYPE_UNITS[liveUnit] || !_KNOWN_TYPE_UNITS[targetUnit]) return newTextParams;
    convert = true;
  }
  var keys = ["size", "leading", "autoLeading"];
  for (var i = 0; i < ranges.length; i++) {
    var style = ranges[i] && ranges[i].textStyle;
    if (!style) continue;
    for (var k = 0; k < keys.length; k++) {
      var value = live[keys[k]];
      if (value === undefined) continue;
      if (convert && keys[k] !== "autoLeading") {
        value = _pointsToTypeUnit(_typeValueToPoints(Number(value), liveUnit, resolution), targetUnit, resolution);
      }
      style[keys[k]] = _clone(value);
    }
    if (live.autoLeading === true) delete style.leading;
    delete style.impliedFontSize;
    delete style.impliedLeading;
  }
  return newTextParams;
}


/* --------------------- Photoshop helpers --------------------- */


function _getDocumentResolution() {
  try {
    var resolution = Number(app.activeDocument.resolution);
    if (resolution > 0) return resolution;
  } catch (resolutionError) {}
  return 72;
}

// Photoshop 27.11 on Windows crashes on a wand click past the right or
// bottom edge of the canvas (macOS only throws "the selected area is empty"):
// such a click throws here instead of reaching Photoshop. Two tests: the
// minified build drops the parentheses of `(a && b) || (c && d)`, which
// ExtendScript then reads as `((a && b) || c) && d`.
function _checkWandPointOnCanvas(x, y) {
  var size = _getDocumentPixelSize();
  if (size.width > 0 && x >= size.width) throw new Error("wand point off canvas");
  if (size.height > 0 && y >= size.height) throw new Error("wand point off canvas");
}

function _magicWandAt(x, y, tolerance) {
  var wandX = Math.max(x, 0);
  var wandY = Math.max(y, 0);
  _checkWandPointOnCanvas(wandX, wandY);
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, ref);
  var pos = new ActionDescriptor();
  pos.putUnitDouble(charID.Horizontal, charID.PixelUnit, wandX);
  pos.putUnitDouble(charID.Vertical, charID.PixelUnit, wandY);
  desc.putObject(charID.To, stringIDToTypeID("paint"), pos);
  desc.putInteger(stringIDToTypeID("tolerance"), tolerance || _BUBBLE_WAND_TOLERANCE);
  desc.putBoolean(stringIDToTypeID("contiguous"), true);
  desc.putBoolean(stringIDToTypeID("merged"), true);
  desc.putBoolean(stringIDToTypeID("antiAlias"), true);
  executeAction(charID.Set, desc, DialogModes.NO);
}

function _liveSelectionBounds() {
  try {
    var bounds = _getCurrentSelectionBounds();
    return bounds ? _rectFrom(bounds.left, bounds.top, bounds.right, bounds.bottom) : null;
  } catch (selectionError) {
    return null;
  }
}

function _intersectSelectionWithRect(rect) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, ref);
  var area = new ActionDescriptor();
  area.putUnitDouble(charID.Top, charID.PixelUnit, rect.top);
  area.putUnitDouble(charID.Left, charID.PixelUnit, rect.left);
  area.putUnitDouble(charID.Bottom, charID.PixelUnit, rect.bottom);
  area.putUnitDouble(charID.Right, charID.PixelUnit, rect.right);
  desc.putObject(charID.To, stringIDToTypeID("rectangle"), area);
  executeAction(stringIDToTypeID("intersectWith"), desc, DialogModes.NO);
}

function _addRectToSelection(rect) {
  var desc = new ActionDescriptor();
  var ref = new ActionReference();
  ref.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, ref);
  var area = new ActionDescriptor();
  area.putUnitDouble(charID.Top, charID.PixelUnit, rect.top);
  area.putUnitDouble(charID.Left, charID.PixelUnit, rect.left);
  area.putUnitDouble(charID.Bottom, charID.PixelUnit, rect.bottom);
  area.putUnitDouble(charID.Right, charID.PixelUnit, rect.right);
  desc.putObject(charID.To, stringIDToTypeID("rectangle"), area);
  executeAction(stringIDToTypeID("addTo"), desc, DialogModes.NO);
}

function _channelExists(name) {
  try {
    var reference = new ActionReference();
    reference.putName(charID.Channel, name);
    executeActionGet(reference);
    return true;
  } catch (missingError) {
    return false;
  }
}

function _deleteChannelByName(name) {
  if (!_channelExists(name)) return;
  try {
    var reference = new ActionReference();
    reference.putName(charID.Channel, name);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charID.Null, reference);
    executeAction(charID.Delete, descriptor, DialogModes.NO);
  } catch (deleteError) {}
}

// Select > Save Selection: an alpha channel that does not become the target
// channel, so the wand keeps sampling the image
function _storeSelectionChannel(name) {
  _deleteChannelByName(name);
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putString(stringIDToTypeID("name"), name);
  executeAction(stringIDToTypeID("duplicate"), descriptor, DialogModes.NO);
}

function _loadSelectionChannel(name) {
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  var source = new ActionReference();
  source.putName(charID.Channel, name);
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  descriptor.putReference(charID.To, source);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

function _saveSelectionState() {
  var saved = { had: false, stored: false };
  try {
    saved.had = !!_getCurrentSelectionBounds();
  } catch (readError) {
    saved.had = false;
  }
  if (saved.had) {
    try {
      _storeSelectionChannel(_SAVED_SELECTION_CHANNEL);
      saved.stored = true;
    } catch (storeError) {
      _deleteChannelByName(_SAVED_SELECTION_CHANNEL);
    }
  }
  return saved;
}

// The user's selection comes back as it was (none stays none). With
// `consumed`, the selection was used like Align uses it: it is dropped.
function _restoreSelectionState(saved, consumed) {
  var restored = false;
  if (saved && saved.stored) {
    if (!consumed) {
      try {
        _loadSelectionChannel(_SAVED_SELECTION_CHANNEL);
        restored = true;
      } catch (loadError) {}
    }
    _deleteChannelByName(_SAVED_SELECTION_CHANNEL);
  }
  if (!restored) {
    try {
      _deselect();
    } catch (deselectError) {}
  }
}

// Bounds without the layer style (a stroke would widen the box), falling back
// on the plain bounds where Photoshop has no such key
function _layerBoxFromDescriptor(descriptor) {
  var keys = ["boundsNoEffects", "bounds"];
  for (var i = 0; i < keys.length; i++) {
    var key = stringIDToTypeID(keys[i]);
    if (descriptor && descriptor.hasKey && descriptor.hasKey(key)) {
      var b = _getBoundsFromDescriptor(descriptor.getObjectValue(key));
      return _rectFrom(b.left, b.top, b.right, b.bottom);
    }
  }
  return null;
}

function _currentLayerBox() {
  var key = stringIDToTypeID("boundsNoEffects");
  try {
    var descriptor = _getCurrent(charID.Layer, key);
    if (descriptor.hasKey(key)) return _layerBoxFromDescriptor(descriptor);
  } catch (noEffectsError) {}
  var b = _getCurrentTextLayerBounds();
  return b ? _rectFrom(b.left, b.top, b.right, b.bottom) : null;
}

function _currentDisplayedTextPixels() {
  try {
    return _displayedTextSize(jamText.getLayerText(), _getDocumentResolution()).pixels;
  } catch (sizeError) {
    return NaN;
  }
}

function _safeActiveLayerId() {
  try {
    return _getActiveLayerId();
  } catch (idError) {
    return null;
  }
}

// Five wand probes around the text. `best` is the bubble (left as the live
// marquee); `loose` is what the probes chose with nothing excluded, i.e. the
// merged double bubble, and has to be wanded again before use.
function _probeBubble(box, sizePixels, exclude, docSize) {
  var found = { best: null, loose: null };
  if (!box) return found;
  var others = exclude || [];
  var points = _probePoints(box, _probeMargin(isFinite(sizePixels) ? sizePixels : 20));
  for (var i = 0; i < points.length; i++) {
    try {
      _magicWandAt(points[i][0], points[i][1], _BUBBLE_WAND_TOLERANCE);
      var live = _liveSelectionBounds();
      if (!live || !_bubbleCandidateValid(live, box, docSize, [], sizePixels)) continue;
      found.loose = _pickBubble(found.loose, _copyProbe(live, points[i][0], points[i][1]), box);
      var excluded = false;
      for (var j = 0; j < others.length; j++) {
        if (_containsPoint(live, others[j].xMid, others[j].yMid)) {
          excluded = true;
          break;
        }
      }
      if (excluded) continue;
      found.best = _pickBubble(found.best, _copyProbe(live, points[i][0], points[i][1]), box);
      if (found.best.whole) break;
    } catch (wandError) {}
  }
  if (found.best && !_sameRect(found.best, _liveSelectionBounds())) {
    try {
      _magicWandAt(found.best.probeX, found.best.probeY, _BUBBLE_WAND_TOLERANCE);
    } catch (rearmError) {}
  }
  return found;
}

// Opens the live marquee, which must be `rect` (cuts a tail): the text is
// centred on the opened bounds. `holes` are the texts in the marquee, `box`
// alone by default. Any answer that is not a plausible part of `rect` holding
// the text keeps `rect`.
function _openedBubble(rect, box, holes) {
  var opened = null;
  try {
    opened = _getAdaptiveOpenedSelectionBounds(rect, holes || (box ? [box] : null));
  } catch (openError) {
    opened = null;
  }
  if (!opened || opened.error) return rect;
  var candidate = _rectFrom(opened.left, opened.top, opened.right, opened.bottom);
  if (!candidate || candidate.width * candidate.height < _MIN_BUBBLE_AREA) return rect;
  if (!_containsBox(rect, candidate, 2)) return rect;
  if (box && !_containsPoint(candidate, box.xMid, box.yMid, 1)) return rect;
  return candidate;
}

// The bounding rectangle of a wand marquee can hold a text that sits outside
// the shape (an L-shaped merge, a neighbouring panel): the marquee itself must
// run under the text, i.e. keep most of its box once intersected with it.
// Leaves the live selection changed.
function _wandCoversBox(probe, box) {
  try {
    _magicWandAt(probe.probeX, probe.probeY, _BUBBLE_WAND_TOLERANCE);
    _intersectSelectionWithRect(box);
    var inside = _liveSelectionBounds();
    return !!(inside && inside.width >= box.width * 0.5 && inside.height >= box.height * 0.5);
  } catch (coverError) {
    return false;
  }
}

// A round lobe is narrower than the merged shape across the cut: the wand
// marquee intersected with the cut gives its real extent. Any failure keeps
// the rectangular cut.
function _tightLobe(probe, lobe, box, docSize) {
  if (!lobe || !probe) return null;
  try {
    _magicWandAt(probe.probeX, probe.probeY, _BUBBLE_WAND_TOLERANCE);
    _intersectSelectionWithRect(lobe);
    var tight = _liveSelectionBounds();
    if (tight && _usableBubble(tight, docSize) && _containsPoint(tight, box.xMid, box.yMid, 1)) return tight;
  } catch (lobeError) {}
  return null;
}

function _layerLockedByDescriptor(layer) {
  try {
    var lockingKey = stringIDToTypeID("layerLocking");
    if (!layer.hasKey(lockingKey)) return false;
    var locking = layer.getObjectValue(lockingKey);
    var keys = ["protectAll", "protectPosition"];
    for (var i = 0; i < keys.length; i++) {
      var key = stringIDToTypeID(keys[i]);
      if (locking.hasKey(key) && locking.getBoolean(key)) return true;
    }
  } catch (lockError) {}
  return false;
}

// Visible text layers other than `skipIds`, with their bounds. A hidden one
// (or one in a hidden group) is ignored; a locked one (or one in a locked
// group) still counts as the other half of a bubble but is never moved.
function _textNeighbours(skipIds) {
  var found = [];
  try {
    var numberOfLayers = stringIDToTypeID("numberOfLayers");
    var layerSection = stringIDToTypeID("layerSection");
    var layerSectionStart = stringIDToTypeID("layerSectionStart");
    var layerSectionEnd = stringIDToTypeID("layerSectionEnd");
    var index = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
    var parents = [];
    for (; index >= 1; index--) {
      try {
        var layer = _getLayerByIndex(index);
        var section = layer.getEnumerationValue(layerSection);
        if (section === layerSectionStart) {
          parents.push({ visible: layer.getBoolean(charID.Visible), locked: _layerLockedByDescriptor(layer) });
          continue;
        }
        if (section === layerSectionEnd) {
          parents.pop();
          continue;
        }
        var shown = layer.getBoolean(charID.Visible);
        var locked = _layerLockedByDescriptor(layer);
        for (var i = 0; i < parents.length; i++) {
          shown = shown && parents[i].visible;
          locked = locked || parents[i].locked;
        }
        if (!shown || !layer.hasKey(charID.Text)) continue;
        var id = layer.getInteger(charID.LayerID);
        if (_idInList(id, skipIds)) continue;
        var box = _layerBoxFromDescriptor(layer);
        if (box) found.push({ id: id, box: box, neighbour: true, locked: locked, rect: null });
      } catch (layerError) {}
    }
  } catch (walkError) {}
  return found;
}

// Runs fn on the page without its lettering, as the wand must read it: a text
// in the bubble leaves holes in the marquee and, touching the outline, cuts the
// bubble in two.
function _withoutLettering(fn) {
  var ids = [];
  var shown = _textNeighbours([]);
  for (var i = 0; i < shown.length; i++) ids.push(shown[i].id);
  try {
    _setLayerVisibilityByIds(ids, false);
  } catch (hideError) {}
  try {
    return fn();
  } finally {
    try {
      _setLayerVisibilityByIds(ids, true);
    } catch (showError) {}
  }
}

// Centres the active text layer on `rect`, fitting a box frame to it first
// when asked. Point text has no frame: it is only moved. False when the text
// has no visible pixels to centre.
function _placeLayerInRect(rect, resize, padding) {
  if (resize && !_textLayerIsPointText()) {
    var width = _calculateSelectionDimensions(rect, padding).width;
    // Laid out in a frame taller than the bubble so no line is hidden, then
    // the frame hugs the text: box text sits at the top of its frame, so a
    // frame taller than the text would stick out of the bubble
    _setTextBoxSize(width, rect.height * 3);
    var measured = _currentLayerBox();
    if (measured) {
      var size = _currentDisplayedTextPixels();
      if (!(size > 0)) size = 20;
      _setTextBoxSize(width, measured.height + size + 2);
    }
  }
  var current = _currentLayerBox();
  if (!current) return false;
  var offsetX = rect.xMid - current.xMid;
  var offsetY = rect.yMid - current.yMid;
  if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
  return true;
}

// Finds the bubble of each new text and centres it. "single": the bubble
// around the text, only when it holds no other text (pasted with it or
// already on the page, if visible): a text in one lobe of a double bubble
// keeps its paste position. "multi": a shared bubble is cut between its
// texts, and that neighbour is moved into its part unless it is locked; its
// frame is left as the user set it.
function _autoCenterLayers(created, data) {
  var mode = data.autoCenter;
  var resize = !!data.resizeTextBox;
  var padding = data.padding || 0;
  var docSize = _getDocumentPixelSize();
  var items = [];
  var i, j;
  for (i = 0; i < created.length; i++) {
    try {
      _selectLayerById(created[i]);
      var box = _currentLayerBox();
      if (box) items.push({ id: created[i], box: box, sizePixels: _currentDisplayedTextPixels(), rect: null, merged: null });
    } catch (readError) {}
  }
  if (!items.length) return;
  var neighbours = _textNeighbours(created);
  for (i = 0; i < items.length; i++) {
    var exclude = [];
    for (j = 0; j < items.length; j++) if (j !== i) exclude.push(items[j].box);
    for (j = 0; j < neighbours.length; j++) exclude.push(neighbours[j].box);
    try {
      var probed = _probeBubble(items[i].box, items[i].sizePixels, exclude, docSize);
      if (probed.best) items[i].rect = _openedBubble(probed.best, items[i].box);
      else items[i].merged = probed.loose;
    } catch (probeError) {}
  }
  var moves = [];
  if (mode === "multi") {
    for (i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.rect || !item.merged) continue;
      var merged = item.merged;
      var candidates = [];
      for (j = 0; j < items.length; j++) if (j !== i && !items[j].rect) candidates.push(items[j]);
      for (j = 0; j < neighbours.length; j++) if (!neighbours[j].rect) candidates.push(neighbours[j]);
      var group = [item];
      for (j = 0; j < candidates.length; j++) {
        var other = candidates[j];
        if (_containsPoint(merged, other.box.xMid, other.box.yMid, 1) && _wandCoversBox(merged, other.box)) group.push(other);
      }
      try {
        _magicWandAt(merged.probeX, merged.probeY, _BUBBLE_WAND_TOLERANCE);
      } catch (rearmError) {
        continue;
      }
      var groupBoxes = [];
      for (j = 0; j < group.length; j++) groupBoxes.push(group[j].box);
      var rect = _openedBubble(merged, item.box, groupBoxes);
      if (group.length === 1) {
        item.rect = rect;
        continue;
      }
      var lobes = _splitBubble(rect, groupBoxes);
      for (j = 0; j < group.length; j++) {
        group[j].rect = _tightLobe(merged, lobes[j], group[j].box, docSize) || lobes[j];
        if (group[j].neighbour && !group[j].locked) moves.push(group[j]);
      }
    }
  }
  try {
    _deselect();
  } catch (deselectError) {}
  var targets = items.concat(moves);
  for (i = 0; i < targets.length; i++) {
    if (!targets[i].rect) continue;
    try {
      _selectLayerById(targets[i].id);
      if (targets[i].neighbour) _placeLayerInRect(targets[i].rect, false, 0);
      else _placeLayerInRect(targets[i].rect, resize, padding);
    } catch (placeError) {}
  }
}

// Centring right after a paste, inside the paste's own history state. A text
// whose bubble is not found keeps its paste position, one failure never stops
// the rest, and the selection and active layer end as the paste left them.
function _autoCenterCreated(ids, data) {
  if (!_autoCenterEnabled(data)) return;
  var created = [];
  for (var i = 0; i < (ids || []).length; i++) {
    if (ids[i] !== null && ids[i] !== undefined) created.push(ids[i]);
  }
  if (!created.length) return;
  var active = _safeActiveLayerId();
  var saved = _saveSelectionState();
  try {
    _autoCenterLayers(created, data);
  } catch (autoCenterError) {}
  _restoreSelectionState(saved, false);
  try {
    _selectLayerById(active !== null ? active : created[created.length - 1]);
  } catch (reselectError) {}
}

// Selected layers as {id, text}; the active layer when nothing is reported
function _targetLayerEntries() {
  var entries = [];
  var targetLayers = stringIDToTypeID("targetLayers");
  var layerIdProp = stringIDToTypeID("layerID");
  var indexes = [];
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    var list = doc.getList(targetLayers);
    var offset = _documentHasBackgroundLayer() ? 0 : 1;
    for (var i = 0; i < list.count; i++) indexes.push(list.getReference(i).getIndex() + offset);
  } else {
    indexes.push(-1);
  }
  for (var j = 0; j < indexes.length; j++) {
    var textRef = new ActionReference();
    textRef.putProperty(charID.Property, charID.Text);
    var idRef = new ActionReference();
    idRef.putProperty(charID.Property, layerIdProp);
    if (indexes[j] === -1) {
      textRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    } else {
      textRef.putIndex(charID.Layer, indexes[j]);
      idRef.putIndex(charID.Layer, indexes[j]);
    }
    var isText = false;
    try {
      isText = executeActionGet(textRef).hasKey(charID.Text);
    } catch (textError) {
      isText = false;
    }
    entries.push({ id: executeActionGet(idRef).getInteger(layerIdProp), text: isText });
  }
  return entries;
}

// Double (or chained) bubble: one selected text per lobe. A user selection
// holding every text centre is the whole bubble (and is used up, as Align
// uses it); otherwise each text gets its own probe that must not reach
// another text's centre, and when the lobes are merged that shape is cut
// between the texts. Answers an error code for the panel, "" when done.
function _splitDoubleBubble(entries, resize, padding) {
  var outcome = { result: "", consumed: false };
  var docSize = _getDocumentPixelSize();
  var user = _usableBubble(_liveSelectionBounds(), docSize);
  var items = [];
  var i, j;
  for (i = 0; i < entries.length; i++) {
    _selectLayerById(entries[i].id);
    var box = _currentLayerBox();
    if (!box) {
      outcome.result = "doubleBubbleEmpty";
      return outcome;
    }
    items.push({ id: entries[i].id, box: box, sizePixels: _currentDisplayedTextPixels(), rect: null });
  }
  var boxes = [];
  for (i = 0; i < items.length; i++) boxes.push(items[i].box);
  var merged = null;
  var userHoldsAll = !!user;
  for (i = 0; userHoldsAll && i < items.length; i++) {
    userHoldsAll = _containsPoint(user, items[i].box.xMid, items[i].box.yMid, 1);
  }
  if (userHoldsAll) {
    merged = { rect: _openedBubble(user, null, boxes), probe: null };
    outcome.consumed = true;
  } else {
    var missing = false;
    for (i = 0; i < items.length; i++) {
      var exclude = [];
      for (j = 0; j < items.length; j++) if (j !== i) exclude.push(items[j].box);
      var own = _probeBubble(items[i].box, items[i].sizePixels, exclude, docSize).best;
      if (own) items[i].rect = _openedBubble(own, items[i].box);
      else missing = true;
    }
    if (missing) {
      var whole = _probeBubble(_unionRect(boxes), items[0].sizePixels, [], docSize).best;
      for (i = 0; whole && i < items.length; i++) {
        if (!_containsPoint(whole, items[i].box.xMid, items[i].box.yMid, 1)) whole = null;
      }
      if (!whole) {
        outcome.result = "doubleBubbleNotFound";
        return outcome;
      }
      merged = { rect: _openedBubble(whole, null, boxes), probe: whole };
    }
  }
  if (merged) {
    var lobes = _splitBubble(merged.rect, boxes);
    for (i = 0; i < items.length; i++) {
      items[i].rect = (merged.probe && _tightLobe(merged.probe, lobes[i], items[i].box, docSize)) || lobes[i];
    }
  }
  try {
    _deselect();
  } catch (deselectError) {}
  var ids = [];
  for (i = 0; i < items.length; i++) {
    _selectLayerById(items[i].id);
    if (!_placeLayerInRect(items[i].rect, resize, padding)) {
      outcome.result = "doubleBubbleEmpty";
      return outcome;
    }
    ids.push(items[i].id);
  }
  _selectLayersById(ids);
  return outcome;
}

function _alignTextLayersToDoubleBubble() {
  var state = _hostState.alignTextLayersToDoubleBubble;
  var saved = _saveSelectionState();
  var outcome = { result: "", consumed: false };
  try {
    outcome = _splitDoubleBubble(state.entries || [], state.resize, state.padding);
  } catch (splitError) {
    outcome.result = "scriptError: " + (splitError && splitError.message ? splitError.message : splitError);
  }
  _restoreSelectionState(saved, outcome.consumed && !outcome.result);
  state.result = outcome.result;
}

/**
 * Retrieve stroke information from the active layer.
 * Returns null if no stroke is found.
 */
function _getLayerStroke(layerIndex) {
  // Must never throw: getActiveLayerText() serializes its result straight to
  // the panel, and an exception here would make the whole call fail and show
  // "select a text layer" even though a text layer is active.
  // When layerIndex is provided, the layer is addressed by index so callers
  // (FontScanR) never have to change the active layer.
  try {
    var ref = new ActionReference();
    ref.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("Lefx"));
    if (typeof layerIndex === "number") {
      ref.putIndex(charIDToTypeID("Lyr "), layerIndex);
    } else {
      ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    }
    var desc = executeActionGet(ref);
    if (!desc.hasKey(charIDToTypeID("Lefx"))) return null;

    var fx = desc.getObjectValue(charIDToTypeID("Lefx"));
    var fr = null;
    if (fx.hasKey(charIDToTypeID("FrFX"))) {
      try {
        fr = fx.getObjectValue(charIDToTypeID("FrFX"));
      } catch (frError) {
        fr = null;
      }
    }
    if (!fr) {
      // Newer Photoshop versions store duplicated strokes in a
      // "frameFXMulti" list instead of a single FrFX object
      var multiId = stringIDToTypeID("frameFXMulti");
      if (fx.hasKey(multiId)) {
        var frList = fx.getList(multiId);
        if (frList.count > 0) fr = frList.getObjectValue(0);
      }
    }
    if (!fr) return null;

    // Gradient/pattern strokes have no solid "Clr " descriptor, and
    // grayscale documents store the color as "Gry " instead of RGB
    var color = { r: 0, g: 0, b: 0 };
    try {
      var col = fr.getObjectValue(charIDToTypeID("Clr "));
      if (col.hasKey(charIDToTypeID("Rd  "))) {
        color = {
          r: col.getDouble(charIDToTypeID("Rd  ")),
          g: col.getDouble(charIDToTypeID("Grn ")),
          b: col.getDouble(charIDToTypeID("Bl  ")),
        };
      } else if (col.hasKey(charIDToTypeID("Gry "))) {
        var grayValue = Math.round(255 * (1 - col.getDouble(charIDToTypeID("Gry ")) / 100));
        color = { r: grayValue, g: grayValue, b: grayValue };
      }
    } catch (colorError) {}

    var enabled = true;
    try {
      enabled = fr.getBoolean(charIDToTypeID("enab"));
    } catch (enabledError) {}
    var position = "other";
    try {
      position = fr.getEnumerationValue(charIDToTypeID("Styl")) == charIDToTypeID("OutF") ? "outer" : "other";
    } catch (positionError) {}
    var size = 0;
    try {
      size = fr.getUnitDoubleValue(charIDToTypeID("Sz  "));
    } catch (sizeError) {}
    var opacity = 100;
    try {
      opacity = fr.getUnitDoubleValue(charIDToTypeID("Opct"));
    } catch (opacityError) {}

    return {
      enabled: enabled,
      position: position,
      size: size,
      opacity: opacity,
      color: color,
    };
  } catch (strokeError) {
    return null;
  }
}

/**
 * Apply or update a stroke on the active layer.
 * @param {Object} stroke - {size, color:{r,g,b}, opacity, enabled}
 *                          position is forced to "outer".
 */
function _setLayerStroke(stroke) {
  if (!stroke || stroke.enabled === false) return;
  if (stroke.size <= 0 && stroke.enabled !== true) return;

  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("Lefx"));
  r.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var fx = new ActionDescriptor();
  fx.putUnitDouble(charIDToTypeID("Scl "), charIDToTypeID("#Prc"), 100);

  var fr = new ActionDescriptor();
  fr.putBoolean(charIDToTypeID("enab"), true);
  fr.putBoolean(stringIDToTypeID("present"), true);
  fr.putBoolean(stringIDToTypeID("showInDialog"), true);

  fr.putEnumerated(charIDToTypeID("Styl"), charIDToTypeID("FStl"), charIDToTypeID("OutF"));
  fr.putEnumerated(charIDToTypeID("PntT"), charIDToTypeID("FrFl"), charIDToTypeID("SClr"));
  fr.putEnumerated(charIDToTypeID("Md  "), charIDToTypeID("BlnM"), charIDToTypeID("Nrml"));

  fr.putUnitDouble(charIDToTypeID("Sz  "), charIDToTypeID("#Pxl"), stroke.size || 3);
  fr.putUnitDouble(charIDToTypeID("Opct"), charIDToTypeID("#Prc"), stroke.opacity || 100);

  var c = new ActionDescriptor();
  c.putDouble(charIDToTypeID("Rd  "), stroke.color.r);
  c.putDouble(charIDToTypeID("Grn "), stroke.color.g);
  c.putDouble(charIDToTypeID("Bl  "), stroke.color.b);
  fr.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), c);

  fx.putObject(charIDToTypeID("FrFX"), charIDToTypeID("FrFX"), fr);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("Lefx"), fx);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _setDiacXOffset(val) {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("TxtS"));
  r.putEnumerated(charIDToTypeID("TxLr"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var t = new ActionDescriptor();
  t.putInteger(stringIDToTypeID("textOverrideFeatureName"), 808466486);
  t.putInteger(stringIDToTypeID("typeStyleOperationType"), 3);
  t.putUnitDouble(stringIDToTypeID("diacXOffset"), charIDToTypeID("#Pxl"), val);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("TxtS"), t);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _setMarkYOffset(val) {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putProperty(charIDToTypeID("Prpr"), charIDToTypeID("TxtS"));
  r.putEnumerated(charIDToTypeID("TxLr"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  d.putReference(charIDToTypeID("null"), r);

  var t = new ActionDescriptor();
  t.putInteger(stringIDToTypeID("textOverrideFeatureName"), 808466488);
  t.putInteger(stringIDToTypeID("typeStyleOperationType"), 3);
  t.putUnitDouble(stringIDToTypeID("markYDistFromBaseline"), charIDToTypeID("#Pxl"), val);
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("TxtS"), t);

  executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

function _applyMiddleEast(textStyle) {
  if (!textStyle) return;
  if (textStyle.diacXOffset != null) _setDiacXOffset(textStyle.diacXOffset);
  if (textStyle.markYDistFromBaseline != null) _setMarkYOffset(textStyle.markYDistFromBaseline);
}

// A text set resets the diacritic offsets jamText cannot write: put back the
// ones that differ from Photoshop's defaults (0 and 100)
function _restoreMiddleEastOffsets(textStyle) {
  if (!textStyle) return;
  var diacOffset = textStyle.diacXOffset != null && textStyle.diacXOffset !== 0;
  var markOffset = textStyle.markYDistFromBaseline != null && textStyle.markYDistFromBaseline !== 100;
  if (diacOffset || markOffset) _applyMiddleEast(textStyle);
}

// Right-to-left text only lays out with the World-Ready (Optyca) composer;
// left-to-right keeps the composer of the style
function _setParagraphDirection(paragraphStyle, direction) {
  paragraphStyle.directionType = direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight";
  if (direction === "rtl") paragraphStyle.textComposerEngine = "textOptycaComposer";
}

function _bakeDirection(paragraphRanges, direction) {
  for (var p = 0; p < oldLayerText.paragraphStyleRange.length; p++) {
    var paragraphRange = paragraphRanges[p] || {};
    var bakedStyle = paragraphRange.paragraphStyle || {};
    _setParagraphDirection(bakedStyle, direction);
    paragraphRange.paragraphStyle = bakedStyle;
    paragraphRanges[p] = paragraphRange;
  }
}

function _stripDirection(paragraphRanges) {
  for (var q = 0; q < paragraphRanges.length; q++) {
    var retryStyle = paragraphRanges[q].paragraphStyle || {};
    delete retryStyle.directionType;
    delete retryStyle.textComposerEngine;
  }
}

// Sets the direction of every paragraph of the active text layer, like the
// Paragraph panel: fonts, sizes, diacritic offsets and the box stay as they are
function _applyTextDirection(direction) {
  if (!direction) return;
  try {
    var paragraphStyle = new ActionDescriptor();
    paragraphStyle.putEnumerated(
      stringIDToTypeID("directionType"),
      stringIDToTypeID("directionType"),
      stringIDToTypeID(direction === "rtl" ? "dirRightToLeft" : "dirLeftToRight")
    );
    if (direction === "rtl") {
      paragraphStyle.putEnumerated(
        stringIDToTypeID("textComposerEngine"),
        stringIDToTypeID("textComposerEngine"),
        stringIDToTypeID("textOptycaComposer")
      );
    }
    var reference = new ActionReference();
    reference.putProperty(charID.Property, stringIDToTypeID("paragraphStyle"));
    reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
    var descriptor = new ActionDescriptor();
    descriptor.putReference(charID.Null, reference);
    descriptor.putObject(charID.To, stringIDToTypeID("paragraphStyle"), paragraphStyle);
    executeAction(charID.Set, descriptor, DialogModes.NO);
  } catch (e) {
    // Ignore errors if directionType is not supported on this PS version
  }
}

function _buildRichTextRanges(baseRange, textRuns, textLength) {
  if (!baseRange || !baseRange.textStyle || !textRuns || !textRuns.length) return null;
  var ranges = [];
  var offset = 0;
  for (var i = 0; i < textRuns.length; i++) {
    var run = textRuns[i] || {};
    var runText = run.text || "";
    var runLength = runText.length;
    if (!runLength) continue;
    var textStyle = _clone(baseRange.textStyle);
    resolveTypeRFontVariant(textStyle, run, app.fonts);
    ranges.push({
      from: offset,
      to: offset + runLength,
      textStyle: textStyle,
    });
    offset += runLength;
  }
  if (offset < textLength) {
    ranges.push({
      from: offset,
      to: textLength,
      textStyle: _clone(baseRange.textStyle),
    });
  }
  return ranges.length ? ranges : null;
}

function _applyRichTextRanges(textParams, textRuns, textLength) {
  if (!textParams || !textParams.layerText || !textRuns || !textRuns.length) return false;
  var baseRange = textParams.layerText.textStyleRange && textParams.layerText.textStyleRange[0];
  var ranges = _buildRichTextRanges(baseRange, textRuns, textLength);
  if (!ranges) return false;
  textParams.layerText.textStyleRange = ranges;
  return true;
}

// The slot a new layer takes: first in its folder, or on top of the document
// outside any folder. Indexes run from the bottom of the stack up, and a folder
// has its start entry above its content and its end entry below it.
function _topSlotOfStack(index, top, sectionAt) {
  var depth = 0;
  for (var i = index + 1; i <= top; i++) {
    var section = sectionAt(i);
    if (section === "layerSectionEnd") {
      depth++;
    } else if (section === "layerSectionStart") {
      if (!depth) return i - 1;
      depth--;
    }
  }
  return top;
}

function _layerSectionAt(index) {
  var layerSection = stringIDToTypeID("layerSection");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, layerSection);
  reference.putIndex(charID.Layer, index);
  return typeIDToStringID(executeActionGet(reference).getEnumerationValue(layerSection));
}

// Photoshop makes a layer right above the active one, so under whatever is
// higher up, and clipped when the active one is. A new text must not stay there.
// It only decides where the text sits, so a refusal must not fail the paste.
function _raiseNewTextLayer() {
  try {
    var itemIndex = stringIDToTypeID("itemIndex");
    var numberOfLayers = stringIDToTypeID("numberOfLayers");
    // A background is index 0 but item 1, and the move takes item numbers
    var offset = _documentHasBackgroundLayer() ? 1 : 0;
    var index = _getCurrent(charID.Layer, itemIndex).getInteger(itemIndex) - offset;
    var top = _getCurrent(charID.Document, numberOfLayers).getInteger(numberOfLayers);
    var slot = _topSlotOfStack(index, top, _layerSectionAt);
    var target = new ActionReference();
    target.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    if (slot !== index) {
      var destination = new ActionReference();
      destination.putIndex(charID.Layer, slot + offset);
      var move = new ActionDescriptor();
      move.putReference(charID.Null, target);
      move.putReference(charID.To, destination);
      move.putBoolean(charIDToTypeID("Adjs"), false);
      move.putInteger(charIDToTypeID("Vrsn"), 5);
      executeAction(charID.Move, move, DialogModes.NO);
    }
    var group = stringIDToTypeID("group");
    if (_getCurrent(charID.Layer, group).getBoolean(group)) {
      var release = new ActionDescriptor();
      release.putReference(charID.Null, target);
      executeAction(charIDToTypeID("Ungr"), release, DialogModes.NO);
    }
  } catch (raiseError) {}
}

function _createAndSetLayerText(data, width, height) {
  var style = _scaleStyleForPunctuationOnlyText(_resolveStyleSizeForDocument(_ensureStyle(data.style)), data.text);
  if (data.textSizeOverride > 0) {
    _overrideStyleTextSize(style, data.textSizeOverride);
  }
  style.textProps.layerText.textKey = _normalizeTextKey(data.text);
  style.textProps.layerText.textStyleRange[0].to = data.text.length;
  style.textProps.layerText.paragraphStyleRange[0].to = data.text.length;
  _applyRichTextRanges(style.textProps, data.richTextRuns, data.text.length);
  var sizeProp = style.textProps.layerText.textStyleRange[0].textStyle.size;
  if (typeof sizeProp !== "number") {
    try {
      var textParams = jamText.getLayerText();
      _hostState.fallbackTextSize = textParams.layerText.textStyleRange[0].textStyle.size;
    } catch (error) {}
    style.textProps.layerText.textStyleRange[0].textStyle.size = _hostState.fallbackTextSize;
  }
  style.textProps.layerText.textShape = [
    {
      textType: "box",
      orientation: "horizontal",
      bounds: {
        top: 0,
        left: 0,
        right: _convertPixelToPoint(width),
        bottom: _convertPixelToPoint(height),
      },
    },
  ];
  // Bake the direction into the make call: the legacy post-make
  // _applyTextDirection pass costs a second complete relayout
  var directionBaked = false;
  if (data.direction && style.textProps.layerText.paragraphStyleRange) {
    _bakeDirection(style.textProps.layerText.paragraphStyleRange, data.direction);
    directionBaked = true;
  }
  try {
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(style.textProps),
    });
  } catch (makeError) {
    if (!directionBaked) throw makeError;
    // Some Photoshop versions reject directionType/textComposerEngine in a
    // make: strip them, retry, then use the legacy post-make pass
    _stripDirection(style.textProps.layerText.paragraphStyleRange);
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(style.textProps),
    });
    directionBaked = false;
  }
  _raiseNewTextLayer();
  _applyMiddleEast(style.textProps.layerText.textStyleRange[0].textStyle);
  if (style.stroke) {
    _setLayerStroke(style.stroke);
  }
  // Apply text direction if it could not be baked into the make call
  if (data.direction && !directionBaked) {
    _applyTextDirection(data.direction);
  }
}

function _setTextBoxSize(width, height) {
  var box = [
    {
      textType: "box",
      orientation: "horizontal",
      bounds: {
        top: 0,
        left: 0,
        right: _convertPixelToPoint(width),
        bottom: _convertPixelToPoint(height),
      },
    },
  ];
  jamText.setLayerText({ layerText: { textShape: box } });
}

function _checkSelection(options) {
  var selection = _getCurrentSelectionBounds();
  if (selection === undefined) {
    return { error: "noSelection" };
  }

  var adjustAmount = 0;
  var adaptiveOpen = false;
  if (options && options.adjustAmount !== undefined) {
    adjustAmount = options.adjustAmount;
  }
  if (options && options.adaptiveOpen) {
    adaptiveOpen = true;
  }

  var adjustedSelection = selection;
  if (adaptiveOpen) {
    adjustedSelection = _getAdaptiveOpenedSelectionBounds(selection, options.holes);
  } else if (adjustAmount !== 0) {
    adjustedSelection = _getAdjustedSelectionBounds(selection, adjustAmount);
  }
  if (!adjustedSelection || adjustedSelection.width * adjustedSelection.height < 200) {
    return { error: "smallSelection" };
  }

  return adjustedSelection;
}

function _forEachSelectedLayer(action) {
  var selectedLayers = [];
  var reference = new ActionReference();
  var targetLayers = stringIDToTypeID("targetLayers");
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    doc = doc.getList(targetLayers);
    var ref2 = new ActionReference();
    ref2.putProperty(charID.Property, charID.Background);
    ref2.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
    var offset = executeActionGet(ref2).getBoolean(charID.Background) ? 0 : 1;
    for (var i = 0; i < doc.count; i++) {
      selectedLayers.push(doc.getReference(i).getIndex() + offset);
    }
  }
  if (selectedLayers.length > 1) {
    for (var j = 0; j < selectedLayers.length; j++) {
      var descr = new ActionDescriptor();
      var ref3 = new ActionReference();
      ref3.putIndex(charID.Layer, selectedLayers[j]);
      descr.putReference(charID.Null, ref3);
      executeAction(charID.Select, descr, DialogModes.NO);
      action(selectedLayers[j]);
    }
    var ref4 = new ActionReference();
    for (var k = 0; k < selectedLayers.length; k++) {
      ref4.putIndex(charID.Layer, selectedLayers[k]);
    }
    var descr2 = new ActionDescriptor();
    descr2.putReference(charID.Null, ref4);
    executeAction(charID.Select, descr2, DialogModes.NO);
  } else if (selectedLayers.length === 1) {
    action(selectedLayers[0]);
  }
  return selectedLayers.length;
}

/* ========================================================= */
/* ============ full methods for suspendHistory ============ */
/* ========================================================= */

function _setActiveLayerText() {
  var state = _hostState.setActiveLayerText;
  var payload = state.data;
  state.result = "";
  if (!payload) {
    return;
  } else if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  }
  var dataText = payload.text;
  var baseStyle = payload.style
    ? _resolveStyleSizeForDocument(_clone(payload.style))
    : payload.style;
  var dataStyle = baseStyle;
  var dataRuns = payload.richTextRuns;
  var targetTextLength = 0;

  // "Paste text to the current layer" is deliberately content-only. Assigning
  // contents directly avoids writing any font, size, paragraph, text-box or
  // position property. Only a right-to-left panel also sets the direction,
  // so Arabic text never stays in a left-to-right layer.
  if (payload.contentOnly && (!dataRuns || !dataRuns.length)) {
    _forEachSelectedLayer(function () {
      app.activeDocument.activeLayer.textItem.contents = _normalizeTextKey(dataText);
      if (payload.direction === "rtl") _applyTextDirection("rtl");
    });
    state.result = "";
    return;
  }

  _forEachSelectedLayer(function () {
    var oldBounds = _getCurrentTextLayerBounds();
    var isPoint = _textLayerIsPointText();
    var targetPoint = _resolveStylePointText(dataStyle, isPoint);
    if (isPoint) _changeToBoxText();
    var oldTextParams = jamText.getLayerText();
    // A style-only apply has no text of its own: each layer keeps its text
    dataStyle = _scaleStyleForPunctuationOnlyText(baseStyle, dataText || oldTextParams.layerText.textKey);
    if (payload.preserveActiveTextSize && dataStyle && oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle) {
      _overrideStyleTextSize(dataStyle, oldTextParams.layerText.textStyleRange[0].textStyle.size);
    }
    var newTextParams;
    if (dataText && dataStyle) {
      newTextParams = dataStyle.textProps;
      if (newTextParams.layerText.textStyleRange[0].textStyle.size == null &&
          oldTextParams.layerText.textStyleRange &&
          oldTextParams.layerText.textStyleRange[0] &&
          oldTextParams.layerText.textStyleRange[0].textStyle.size != null) {
        newTextParams.layerText.textStyleRange[0].textStyle.size = oldTextParams.layerText.textStyleRange[0].textStyle.size;
      }
      newTextParams.layerText.textKey = _normalizeTextKey(dataText);
      newTextParams.layerText.textStyleRange[0].to = dataText.length;
      newTextParams.layerText.paragraphStyleRange[0].to = dataText.length;
      targetTextLength = dataText.length;
      _applyRichTextRanges(newTextParams, dataRuns, targetTextLength);
    } else if (dataText) {
      newTextParams = {
        layerText: {
          textKey: _normalizeTextKey(dataText),
        },
      };
      if (oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange[0]) {
        newTextParams.layerText.textStyleRange = [oldTextParams.layerText.textStyleRange[0]];
        newTextParams.layerText.textStyleRange[0].to = dataText.length;
      }
      if (oldTextParams.layerText.paragraphStyleRange && oldTextParams.layerText.paragraphStyleRange[0]) {
        // Create a minimal paragraphStyleRange without directionType to avoid RTL issues
        var oldParagraphStyle = oldTextParams.layerText.paragraphStyleRange[0].paragraphStyle || {};
        var newParagraphStyle = {};

        // Copy only safe properties, explicitly excluding directionType
        for (var i = 0; i < _SAFE_PARAGRAPH_PROPS.length; i++) {
          var prop = _SAFE_PARAGRAPH_PROPS[i];
          if (oldParagraphStyle[prop] !== undefined) {
            newParagraphStyle[prop] = oldParagraphStyle[prop];
          }
        }

        newTextParams.layerText.paragraphStyleRange = [{
          from: 0,
          to: dataText.length,
          paragraphStyle: newParagraphStyle
        }];
      }
      targetTextLength = dataText.length;
      _applyRichTextRanges(newTextParams, dataRuns, targetTextLength);
    } else if (dataStyle) {
      var text = oldTextParams.layerText.textKey || "";
      newTextParams = dataStyle.textProps;
      newTextParams.layerText.textStyleRange[0].to = text.length;
      newTextParams.layerText.paragraphStyleRange[0].to = text.length;
      targetTextLength = text.length;
    }
    var retainedShape = oldTextParams.layerText.textShape && oldTextParams.layerText.textShape[0];
    if (isPoint && retainedShape && retainedShape.bounds) {
      var oldTextStyle = oldTextParams.layerText.textStyleRange &&
        oldTextParams.layerText.textStyleRange[0] &&
        oldTextParams.layerText.textStyleRange[0].textStyle;
      var styleTextStyle = dataStyle &&
        dataStyle.textProps &&
        dataStyle.textProps.layerText &&
        dataStyle.textProps.layerText.textStyleRange &&
        dataStyle.textProps.layerText.textStyleRange[0] &&
        dataStyle.textProps.layerText.textStyleRange[0].textStyle;
      var oldSize = oldTextStyle && oldTextStyle.size;
      var newSize = styleTextStyle && styleTextStyle.size != null ? styleTextStyle.size : oldSize;
      var widthScale = oldSize && newSize ? newSize / oldSize : 1;
      if (!(widthScale > 0)) widthScale = 1;
      if (widthScale < 1) widthScale = 1;
      var bounds = retainedShape.bounds;
      var currentWidth = bounds.right - bounds.left;
      var currentHeight = bounds.bottom - bounds.top;
      var oldWidthPoints = typeof oldBounds.width === "number" ? _convertPixelToPoint(oldBounds.width) : currentWidth;
      var oldHeightPoints = typeof oldBounds.height === "number" ? _convertPixelToPoint(oldBounds.height) : currentHeight;
      var targetWidth = currentWidth * widthScale;
      var targetHeight = currentHeight * widthScale;
      if (targetWidth < oldWidthPoints * widthScale) targetWidth = oldWidthPoints * widthScale;
      var minWidthPadding = (newSize || oldSize || 12) * 0.5;
      if (targetWidth < oldWidthPoints + minWidthPadding) targetWidth = oldWidthPoints + minWidthPadding;
      var minHeightPadding = (newSize || oldSize || 12) * 0.75;
      if (targetHeight < oldHeightPoints * widthScale) targetHeight = oldHeightPoints * widthScale;
      if (targetHeight < oldHeightPoints + minHeightPadding) targetHeight = oldHeightPoints + minHeightPadding;
      bounds.right = bounds.left + targetWidth;
      bounds.bottom = bounds.top + targetHeight;
    }
    // Applying a style must carry its configured anti-aliasing mode to the
    // layer. Keep the current value only for legacy styles that do not store
    // an antiAlias setting.
    var styleAntiAlias = dataStyle && dataStyle.textProps && dataStyle.textProps.layerText &&
      dataStyle.textProps.layerText.antiAlias;
    newTextParams.layerText.antiAlias = styleAntiAlias || oldTextParams.layerText.antiAlias || "antiAliasSmooth";
    if (retainedShape) {
      newTextParams.layerText.textShape = [retainedShape];
    }
    newTextParams.typeUnit = oldTextParams.typeUnit;

    var userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    // Bake the direction into the ranges of the main set call: the legacy
    // post-set _applyTextDirection pass costs a second complete relayout on
    // every apply
    var directionBaked = false;
    if (userDirection && newTextParams.layerText.paragraphStyleRange) {
      _bakeDirection(newTextParams.layerText.paragraphStyleRange, userDirection);
      directionBaked = true;
    }

    // Non-point layers are measured in an oversized box right after the text
    // lands; putting that box in the same set call skips one relayout with
    // the stale retained bounds in between. Only needed when the text itself
    // changes — a style-only apply keeps the same line breaks, and skipping
    // the measure pass there keeps it as fast as the legacy path.
    // Read before the measuring box below needs it, and again by the fit pass
    var textSize = 12;
    var styleSize = dataStyle && dataStyle.textProps.layerText.textStyleRange[0].textStyle.size;
    if (styleSize != null) {
      textSize = styleSize;
    } else if (oldTextParams.layerText.textStyleRange && oldTextParams.layerText.textStyleRange[0] && oldTextParams.layerText.textStyleRange[0].textStyle.size != null) {
      textSize = oldTextParams.layerText.textStyleRange[0].textStyle.size;
    }

    var boxShapeRef = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
    var measureBoxBounds = null;
    var measureEstimate = null;
    if (!isPoint && boxShapeRef && boxShapeRef.bounds && dataText) {
      var pageSpan = _getMeasureBoxSpanPoints();
      var estimate = _getMeasureBoxSpanForText(dataText, textSize);
      // Never larger than the page-sized box: that one is already known to hold
      // anything, and past it the estimate only buys relayout cost
      if (estimate) {
        if (estimate.width >= pageSpan && estimate.height >= pageSpan) estimate = null;
        else {
          if (estimate.width > pageSpan) estimate.width = pageSpan;
          if (estimate.height > pageSpan) estimate.height = pageSpan;
        }
      }
      measureBoxBounds = {
        top: boxShapeRef.bounds.top || 0,
        left: boxShapeRef.bounds.left || 0,
        right: boxShapeRef.bounds.right,
        bottom: boxShapeRef.bounds.bottom,
        pageSpan: pageSpan,
      };
      measureEstimate = estimate;
      boxShapeRef.bounds.right = measureBoxBounds.left + (estimate ? estimate.width : pageSpan);
      boxShapeRef.bounds.bottom = measureBoxBounds.top + (estimate ? estimate.height : pageSpan);
    }

    try {
      jamText.setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      // Some Photoshop versions reject directionType/textComposerEngine in a
      // plain set: strip them, retry, then use the legacy post-set pass
      _stripDirection(newTextParams.layerText.paragraphStyleRange);
      jamText.setLayerText(newTextParams);
      _applyTextDirection(userDirection);
    }
    _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
    if (dataStyle && dataStyle.stroke) {
      _setLayerStroke(dataStyle.stroke);
    }
    if (targetPoint) {
      _changeToPointText();
    } else {
      var boxShape = newTextParams.layerText.textShape && newTextParams.layerText.textShape[0];
      var boxFitted = false;
      if (boxShape && boxShape.bounds && measureBoxBounds) {
        // The retained box can be narrower than the new longest line, which
        // makes Photoshop soft-wrap it and break the intended line shape.
        // The layer already sits in the oversized measuring box from the main
        // set call: read the real text extent and shrink the box around it.
        try {
          var textExtent = _getCurrentTextLayerBounds();
          // The estimated box is only worth reading while the text stayed clear
          // of its edges. A line that reached the right edge may have been soft
          // wrapped, and text past the bottom edge is not rendered at all, so
          // either way the extent would describe the box and not the text. Fall
          // back to the page-sized box, which is what this always used.
          if (measureEstimate && textExtent.width > 0 && textExtent.height > 0 &&
              (_convertPixelToPointExact(textExtent.width) >= measureEstimate.width - textSize ||
               _convertPixelToPointExact(textExtent.height) >= measureEstimate.height - textSize)) {
            boxShape.bounds.right = measureBoxBounds.left + measureBoxBounds.pageSpan;
            boxShape.bounds.bottom = measureBoxBounds.top + measureBoxBounds.pageSpan;
            jamText.setLayerText({ layerText: { textShape: [boxShape] } });
            measureEstimate = null;
            textExtent = _getCurrentTextLayerBounds();
          }
          if (textExtent.width > 0 && textExtent.height > 0) {
            var widthPadding = Math.max(2, textSize * 0.4);
            boxShape.bounds.right = measureBoxBounds.left + _convertPixelToPointExact(textExtent.width) + widthPadding;
            boxShape.bounds.bottom = measureBoxBounds.top + _convertPixelToPointExact(textExtent.height) + textSize + 2;
            jamText.setLayerText({ layerText: { textShape: [boxShape] } });
            boxFitted = true;
          }
        } catch (fitError) {}
      }
      if (!boxFitted && boxShape) {
        // Fallback: restore the retained box and only grow its height. The
        // restore set is only needed when a measure box was actually applied;
        // on a style-only apply the layer still holds the retained box.
        if (measureBoxBounds) {
          boxShape.bounds.right = measureBoxBounds.right;
          boxShape.bounds.bottom = measureBoxBounds.bottom;
          jamText.setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
        }
        var fallbackBounds = _getCurrentTextLayerBounds();
        boxShape.bounds.bottom = _convertPixelToPoint(fallbackBounds.height + textSize + 2);
        jamText.setLayerText({ layerText: { textShape: newTextParams.layerText.textShape } });
      }
    }
    var newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    var offsetX = oldBounds.xMid - newBounds.xMid;
    var offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
  });

  state.result = "";
}

// Lean text-only apply for TextShapeR: the panel already holds a full style
// snapshot of the layer (read when it was selected), so this path skips the
// expensive jamText.getLayerText() re-read and the stroke re-apply — none of
// them can have changed since only the line breaking changes. The
// Middle-East override actions only run for offsets the set call resets.
// Point text also skips both box conversions since it can never soft-wrap:
// one relayout instead of four.
function _setTextShapeRText() {
  var state = _hostState.setTextShapeRText;
  var payload = state.data;
  state.result = "";
  if (!payload) {
    return;
  } else if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  }
  var convertedToPoint = false;
  try {
    var resolvedStyle = _resolveStyleSizeForDocument(_clone(payload.style));
    var snapshot = resolvedStyle.textProps;
    var dataText = payload.text;
    var oldBounds = _getCurrentTextLayerBounds();
    var isPoint = _textLayerIsPointText();
    // Size, leading and auto-leading are read on the layer right before the
    // write: applying a shape must never change the text size
    var liveParams = null;
    try {
      liveParams = jamText.getLayerText();
    } catch (liveReadError) {}

    var newTextParams = { layerText: { textKey: _normalizeTextKey(dataText) } };
    var baseRange = _clone(snapshot.layerText.textStyleRange[0]);
    baseRange.from = 0;
    baseRange.to = dataText.length;
    newTextParams.layerText.textStyleRange = [baseRange];

    var snapshotParagraph = snapshot.layerText.paragraphStyleRange && snapshot.layerText.paragraphStyleRange[0];
    var oldParagraphStyle = (snapshotParagraph && snapshotParagraph.paragraphStyle) || {};
    var newParagraphStyle = {};
    for (var propIndex = 0; propIndex < _SAFE_PARAGRAPH_PROPS.length; propIndex++) {
      var prop = _SAFE_PARAGRAPH_PROPS[propIndex];
      if (oldParagraphStyle[prop] !== undefined) {
        newParagraphStyle[prop] = oldParagraphStyle[prop];
      }
    }
    newTextParams.layerText.paragraphStyleRange = [{ from: 0, to: dataText.length, paragraphStyle: newParagraphStyle }];

    _applyRichTextRanges(newTextParams, payload.richTextRuns, dataText.length);

    // Carried over verbatim: dropping these made Photoshop reinterpret the
    // size unit (text size jumps) and reset the anti-aliasing mode
    newTextParams.layerText.antiAlias = snapshot.layerText.antiAlias || "antiAliasSmooth";
    newTextParams.typeUnit = snapshot.typeUnit;
    _keepLiveTextSize(newTextParams, liveParams, _getDocumentResolution());

    var userDirection = payload.direction;
    if (userDirection === "") userDirection = null;
    var directionBaked = false;
    if (userDirection) {
      _bakeDirection(newTextParams.layerText.paragraphStyleRange, userDirection);
      directionBaked = true;
    }

    // Box layers hop through point text for the swap: point text never
    // soft-wraps so no measuring box is needed, and converting back to box
    // rebuilds a box fitted around the new text automatically — that kills
    // both the giant measure box and the second fitting relayout
    if (!isPoint) {
      _changeToPointText();
      convertedToPoint = true;
    }

    try {
      jamText.setLayerText(newTextParams);
    } catch (setError) {
      if (!directionBaked) throw setError;
      _stripDirection(newTextParams.layerText.paragraphStyleRange);
      jamText.setLayerText(newTextParams);
      _applyTextDirection(userDirection);
    }
    _restoreMiddleEastOffsets(baseRange.textStyle);

    if (convertedToPoint) {
      _changeToBoxText();
      convertedToPoint = false;
    }

    var newBounds = _getCurrentTextLayerBounds();
    if (!oldBounds.bottom) oldBounds = newBounds;
    var offsetX = oldBounds.xMid - newBounds.xMid;
    var offsetY = oldBounds.yMid - newBounds.yMid;
    if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
    state.result = "";
  } catch (leanError) {
    // Restore the layer kind first so the fallback sees the original state
    if (convertedToPoint) {
      try {
        _changeToBoxText();
      } catch (revertError) {}
    }
    // Any surprise (stale snapshot, unexpected layer state) falls back to
    // the battle-tested full apply path within the same history state
    // and still keeps the layer's current size
    payload.preserveActiveTextSize = true;
    _hostState.setActiveLayerText.data = payload;
    _setActiveLayerText();
    state.result = _hostState.setActiveLayerText.result;
  }
}

function setTextShapeRLayerText(data) {
  // The variants the panel offers are built from a snapshot of one layer. If
  // the typesetter selected another balloon before clicking one of them, that
  // click would overwrite the balloon he is on with the text of the balloon he
  // left. Refuse instead of writing to the wrong layer.
  if (data && typeof data.layerId === "number" && documents.length) {
    var activeId = null;
    try {
      activeId = _getActiveLayerId();
    } catch (activeIdError) {}
    if (activeId !== data.layerId) return "staleLayer";
  }
  var valid = data && data.text && data.style && data.style.textProps && data.style.textProps.layerText &&
    data.style.textProps.layerText.textStyleRange && data.style.textProps.layerText.textStyleRange[0];
  if (!valid) return setActiveLayerText(data);
  if (!documents.length) return "doc";
  var state = _hostState.setTextShapeRText;
  state.data = data;
  state.result = "";
  // Same history state name as the classic apply so undoLastTyperChange works
  app.activeDocument.suspendHistory("TyperTools Change", "_setTextShapeRText()");
  return state.result;
}

function _createTextLayerInSelection() {
  var state = _hostState.createTextLayerInSelection;
  if (!documents.length) {
    state.result = "doc";
    return;
  }
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) {
      state.result = "sizeSource";
      return;
    }
    state.data.textSizeOverride = _getTextLayerSize();
  }

  var selection = _checkSelection({ adaptiveOpen: true });
  if (selection.error) {
    state.result = selection.error;
    return;
  }
  var target = selection.centroid || null;
  var dimensions = _punctuationOnlyBoxDimensions(_calculateSelectionDimensions(selection, state.padding), state.data);
  _createAndSetLayerText(state.data, dimensions.width, dimensions.height);
  var bounds = _getCurrentTextLayerBounds();
  if (state.point) {
    _changeToPointText();
  } else {
    _resizeTextBoxToContent(dimensions.width, bounds);
  }
  bounds = _getCurrentTextLayerBounds();
  _positionLayerWithinSelection(selection, bounds, state.data && state.data.phantomOffsetX, target);
  if (_autoCenterEnabled(state.data)) {
    _autoCenterCreated([_safeActiveLayerId()], {
      autoCenter: state.data.autoCenter,
      resizeTextBox: state.data.resizeTextBox,
      padding: state.padding,
    });
  }
  state.result = "";
}

/*
 * Page size in pixels, whatever the user's rulers are set to.
 *
 * `doc.width` is a UnitValue in the active ruler units, so a document measured in
 * centimetres reports ~21 where the selection bounds report ~2700. Every
 * comparison between the two then collapses: the page-share guard below refused
 * every region (so the centroid was never traced and centring silently fell back
 * to the bounding box), and the narrowing box clamped to the first pixels of the
 * page. The lab pages are measured in pixels, which is why no run ever saw it.
 */
function _getDocumentPixelSize(doc) {
  if (!doc) doc = app.activeDocument;
  if (typeof Units === "undefined") return { width: parseFloat(doc.width), height: parseFloat(doc.height) };
  var oldUnits = app.preferences.rulerUnits;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    var width = parseFloat(doc.width);
    var height = parseFloat(doc.height);
    if (!(width > 0) || !(height > 0)) return null;
    return { width: width, height: height };
  } catch (sizeError) {
    return null;
  } finally {
    try {
      app.preferences.rulerUnits = oldUnits;
    } catch (restoreError) {}
  }
}

/*
 * A region covering a quarter of the page is not a balloon: it is a fill that
 * escaped through a gap in an outline and swallowed the artwork. Measured on the
 * reference pages, real balloon regions stay under 7% of the page while the two
 * escaped ones covered 33%.
 */
function _regionCoversTooMuchPage(bounds) {
  if (!bounds) return false;
  try {
    var size = _getDocumentPixelSize(app.activeDocument);
    if (!size) return false;
    var docArea = size.width * size.height;
    return docArea > 0 && bounds.width * bounds.height > docArea * _MAX_BALLOON_PAGE_SHARE;
  } catch (sizeError) {
    return false;
  }
}

/*
 * Narrow the live selection down to the neighbourhood of the text: the ink box
 * grown by half its own width and height on each side, intersected with what is
 * already selected. Used when the contiguous fill escaped the balloon, instead of
 * refusing to centre — refusing costs the typesetter more than a wrong centre,
 * and this recovers the local balloon in the two measured cases (error dropped
 * from 1370 px and 1452 px to 12 px and 1 px).
 *
 * The margin is deliberately small: measured on the same two cases, growing it to
 * one full ink width and height made the error worse again (89 px and 7 px),
 * because the box then reached back into the artwork the fill had swallowed.
 */
function _narrowSelectionToTextNeighbourhood() {
  var doc;
  try {
    doc = app.activeDocument;
  } catch (docError) {
    return null;
  }
  if (!doc || !doc.selection) return null;

  var ink;
  try {
    ink = _getCurrentTextLayerBounds();
  } catch (boundsError) {
    return null;
  }
  if (!ink || !(ink.width > 0) || !(ink.height > 0)) return null;

  var marginX = ink.width / 2;
  var marginY = ink.height / 2;
  var pageSize = _getDocumentPixelSize(doc);
  var left = Math.max(0, Math.round(ink.left - marginX));
  var top = Math.max(0, Math.round(ink.top - marginY));
  var right = Math.round(ink.right + marginX);
  var bottom = Math.round(ink.bottom + marginY);
  if (pageSize) {
    right = Math.min(Math.round(pageSize.width), right);
    bottom = Math.min(Math.round(pageSize.height), bottom);
  }
  if (right - left < 2 || bottom - top < 2) return null;

  // The intersection can come out empty on a shape we did not anticipate, so the
  // original selection is kept aside and restored in that case.
  var tempChannel = _createTempSelectionChannel(doc);
  var narrowed = null;
  try {
    doc.selection.select([[left, top], [right, top], [right, bottom], [left, bottom]], SelectionType.INTERSECT, 0, false);
    narrowed = _checkSelection({ adaptiveOpen: true });
    if (narrowed && narrowed.error) narrowed = null;
  } catch (intersectError) {
    narrowed = null;
  }
  if (!narrowed && tempChannel) {
    try { doc.selection.load(tempChannel); } catch (restoreError) {}
  }
  if (tempChannel) {
    try { tempChannel.remove(); } catch (removeError) {}
  }
  return narrowed;
}

// With the lettering hidden, the text's centre has no glyph left to land on
function _wandBubbleOfActiveText() {
  var box = _currentLayerBox();
  if (!box) return;
  _withoutLettering(function () {
    try {
      _magicWandAt(box.xMid, box.yMid, _BUBBLE_WAND_TOLERANCE);
    } catch (wandError) {}
  });
}

function _alignCurrentTextLayerToSelection() {
  var state = _hostState.alignTextLayerToSelection;
  if (!_layerIsTextLayer()) {
    return "layer";
  }

  // Only the probe below leaves one, and it never runs when the typesetter is
  // holding a marquee. Left over from the call before, it would decide this one.
  _hostState.cleanCandidate = null;

  var selection = (state.placements && state.placements["id" + _safeActiveLayerId()]) || _checkSelection({ adaptiveOpen: true, holes: [_currentLayerBox()] });
  if (selection.error) {
    if (selection.error === "noSelection") {
      // Deterministic first: center on the bubble shape layer that sits
      // below the text layer. The magic wand (pixel sampling of the merged
      // image) depends on fill colors, bubble tails and anti-aliasing, so it
      // lands the text left or right of the true bubble center — it stays
      // only as the last resort for bubbles that are not shape layers.
      var bubbleBounds = _findShapeLayerBoundsBelowTextLayer();
      if (bubbleBounds) {
        selection = bubbleBounds;
      } else {
        _createBalloonWandSelection(20);
        selection = _checkSelection({ adaptiveOpen: true });
      }
    }
    if (selection.error) {
      return selection.error;
    }
  }

  // Between the balloon as the page has it and the balloon with the lines lying
  // over this one taken away, whichever centre sits closer to the line being
  // centred is the one this line is in.
  //
  // Giving a bite back always pulls the centre towards the text, because the bite
  // is where the text is. Running into the balloon next door pushes it away, into
  // a balloon this line is not in — and that is the whole risk of taking the ink
  // away, because where two balloons touch the neighbours' ink is the only thing
  // narrowing the gap between them, and it is that narrowing the opening relies on
  // to tell them apart. Comparing sizes cannot see it: the two regions share a
  // bounding box to the pixel, before and after the opening alike, while the
  // answer moves 590 px.
  //
  // This is the cheap place to decide it. The region above has just been opened,
  // so its centre is already paid for.
  var candidate = _hostState.cleanCandidate;
  _hostState.cleanCandidate = null;
  if (candidate && !selection.error) {
    var here = null;
    try { here = _getCurrentTextLayerBounds(); } catch (hereError) { here = null; }
    var plainAway = here ? _distanceFromCentroid(selection, here) : -1;
    var takeIt = candidate.away >= 0 && (plainAway < 0 || candidate.away < plainAway);
    _hostState.probe.before = Math.round(plainAway);
    _hostState.probe.after = Math.round(candidate.away);
    _hostState.probe.cleaned = !!takeIt;
    _hostState.probe.refused = !takeIt;
    if (takeIt) {
      selection = candidate.region;
      // The outline that came with it, or the cut would run on the outline of a
      // region that was thrown away.
      _hostState.lastOutline = candidate.outline;
      _hostState.lastOutlineKey = candidate.outlineKey;
    }
  }

  // A region covering a third of the page is a fill that escaped the balloon
  // through a gap in its outline, whether it came from the plugin's own probe or
  // from a magic wand click by the user. Centring on it threw the text 1370 px and
  // 1452 px away in the two measured cases, so it is narrowed to the text's
  // neighbourhood instead of refused: a refusal costs the typesetter more than a
  // wrong centre, and a local balloon costs less than either.
  if (_regionCoversTooMuchPage(selection)) {
    var narrowed = _narrowSelectionToTextNeighbourhood();
    if (narrowed) selection = narrowed;
  }

  var wasPoint = _textLayerIsPointText();
  var bounds = _getCurrentTextLayerBounds();
  /*
   * Where the line was standing before the layout moved it.
   *
   * The cut below asks which side of the chord the text is on, and the only
   * honest answer comes from where the typesetter left it. With `resizeTextBox`
   * on, the box is first grown to the *selection* — the whole merged region —
   * so its centre lands near the centre of both balloons and the side test is
   * being asked about a rectangle that no longer says anything about which
   * balloon the line belongs to. Measured on the fifteen reference pages with
   * resize on and 12 px of padding, three regions of `13.psd` and `14.psd` were
   * being cut from that moved box and centred 313 to 467 px away.
   *
   * The moved box is still the one the layer is positioned by; only the question
   * "which piece is this line in" is asked of the box it had.
   */
  var anchorBox = bounds;

  if (state.resize && !wasPoint) {
    var dimensions = _calculateSelectionDimensions(selection, state.padding);
    _setTextBoxSize(dimensions.width, dimensions.height);
    var textBounds = _getCurrentTextLayerBounds();
    _resizeTextBoxToContent(dimensions.width, textBounds);
    bounds = _getCurrentTextLayerBounds();
  }

  // The balloon's area centroid, traced when the selection was opened. A shape
  // layer bubble has no live selection, so it keeps the bounding-box centre.
  var target = selection.centroid || null;

  // When two balloons were drawn over each other the region's centroid is the
  // centre of the merged shape and belongs to neither. Cut it at the corners
  // where the two outlines meet and centre on the piece this layer sits in.
  // Everything here falls back to the centroid above, so a balloon with nothing
  // to cut follows exactly the path it followed before.
  // Why a cut did or did not happen. Cheap to keep, and without it a case that
  // silently kept the old target looks identical to one the cut never saw.
  _hostState.partition = { skip: "noOutline", cuts: 0, share: 0, concavity: "", used: false };
  // The outline belongs to the last region that was traced. It is only this
  // selection's outline when the key matches: `_checkSelection` runs again on the
  // `noSelection` retry and again after a leaked region is narrowed, and the
  // wrong outline would split the wrong shape.
  var outline = (_hostState.lastOutline && _hostState.lastOutlineKey === _selectionBoundsKey(selection))
    ? _hostState.lastOutline
    : null;
  _hostState.lastOutline = null;
  _hostState.lastOutlineKey = "";
  if (outline) {
    try {
      var report = _hostState.partition;
      var split = _splitOutlineAtCusps(outline, anchorBox, report);
      if (split && isFinite(split.x) && isFinite(split.y)) {
        if (_centreInsideOutline(outline, split)) {
          target = split;
          report.used = true;
        } else {
          report.skip = "outsideOutline";
        }
      }
    } catch (splitError) {
      _hostState.partition.skip = "threw:" + (splitError && splitError.message ? splitError.message : String(splitError));
    }
  }

  // The region the engine actually settled on, and where it decided to put the
  // text. The lab can reproduce the probes but not this, and without it a case
  // that landed in the wrong balloon looks the same as one that got the centre
  // of the right balloon wrong.
  _hostState.lastAlignRegion = {
    left: selection.left,
    top: selection.top,
    width: selection.width,
    height: selection.height,
    targetX: target ? target.x : selection.xMid,
    targetY: target ? target.y : selection.yMid
  };

  _deselect();
  _positionLayerWithinSelection(selection, bounds, state.phantomOffsetX, target);
  if (wasPoint) {
    _changeToPointText();
  }
  return "";
}

function _getLayerPropertyById(id, layerIndex) {
  var ref = new ActionReference();
  ref.putProperty(charIDToTypeID("Prpr"), id);
  ref.putIndex(charIDToTypeID("Lyr "), layerIndex);
  return executeActionGet(ref);
}

function _getLayerBoundsByIndex(layerIndex) {
  try {
    var boundsId = stringIDToTypeID("bounds");
    var desc = _getLayerPropertyById(boundsId, layerIndex);
    if (desc.hasKey(boundsId)) {
      return _getBoundsFromDescriptor(desc.getObjectValue(boundsId));
    }
  } catch (boundsError) {}
  return null;
}

// Look for the bubble shape layer below the active text layer and return its
// bounds. Shape layers (kind 4) are the canonical bubbles of the workflow,
// and their bounds are deterministic — unlike pixel sampling, they never
// depend on fill color, anti-aliasing or the bubble tail. The walk is capped
// so documents with huge layer stacks stay fast, and only a shape whose
// bounds contain the text layer is accepted: an unrelated loose shape
// (panel frame, redraw) below the bubble would otherwise hijack the
// centering.
function _findShapeLayerBoundsBelowTextLayer() {
  try {
    var propId = charIDToTypeID("Prpr");
    var layerId = charIDToTypeID("Lyr ");
    var docId = charIDToTypeID("Dcmn");
    var ordinalId = charIDToTypeID("Ordn");
    var targetId = charIDToTypeID("Trgt");
    var targetLayersId = stringIDToTypeID("targetLayers");
    var layerKindId = stringIDToTypeID("layerKind");
    var numberOfLayersId = stringIDToTypeID("numberOfLayers");
    var hasBackgroundId = stringIDToTypeID("hasBackgroundLayer");
    var shapeLayerKind = 4;

    var getDocProperty = function (id) {
      var ref = new ActionReference();
      ref.putProperty(propId, id);
      ref.putEnumerated(docId, ordinalId, targetId);
      return executeActionGet(ref);
    };

    var layerCount = getDocProperty(numberOfLayersId).getInteger(numberOfLayersId);
    var hasBackground = false;
    try {
      hasBackground = getDocProperty(hasBackgroundId).getBoolean(hasBackgroundId);
    } catch (backgroundError) {}
    var firstIndex = hasBackground ? 0 : 1;

    var activeIndex = -1;
    var selectionRef = new ActionReference();
    selectionRef.putProperty(propId, targetLayersId);
    selectionRef.putEnumerated(docId, ordinalId, targetId);
    var selectionDesc = executeActionGet(selectionRef);
    if (selectionDesc.hasKey(targetLayersId)) {
      var list = selectionDesc.getList(targetLayersId);
      if (list.count === 1) {
        var backgroundRef = new ActionReference();
        backgroundRef.putProperty(propId, charID.Background);
        backgroundRef.putEnumerated(layerId, ordinalId, charID.Back);
        var offset = executeActionGet(backgroundRef).getBoolean(charID.Background) ? 0 : 1;
        activeIndex = list.getReference(0).getIndex() + offset;
      }
    }
    if (activeIndex < firstIndex) return null;

    // If the text bounds cannot be read, fall back to accepting the first
    // shape layer so centering still works on unusual documents
    var textBounds = null;
    try {
      textBounds = _getCurrentTextLayerBounds();
    } catch (textBoundsError) {}

    var limit = Math.max(firstIndex, activeIndex - 12);
    for (var i = activeIndex - 1; i >= limit; i--) {
      var kind = 0;
      try {
        kind = _getLayerPropertyById(layerKindId, i).getInteger(layerKindId);
      } catch (kindError) {}
      if (kind === shapeLayerKind) {
        var shapeBounds = _getLayerBoundsByIndex(i);
        if (!shapeBounds) continue;
        // If the text bounds cannot be read, accept the first shape layer so
        // centering still works on unusual documents
        if (!textBounds) return shapeBounds;
        // Allow 1px of float/anti-alias noise on each side
        if (
          shapeBounds.left <= textBounds.left + 1 &&
          shapeBounds.top <= textBounds.top + 1 &&
          shapeBounds.right >= textBounds.right - 1 &&
          shapeBounds.bottom >= textBounds.bottom - 1
        ) {
          return shapeBounds;
        }
      }
    }
  } catch (walkError) {}
  return null;
}

function _alignTextLayerToSelection() {
  var state = _hostState.alignTextLayerToSelection;
  if (!documents.length) {
    state.result = "doc";
    return;
  }

  var alignedCount = 0;
  var firstError = "";
  var selectedCount = _forEachSelectedLayer(function () {
    var result = _alignCurrentTextLayerToSelection();
    if (result) {
      if (!firstError) firstError = result;
      return;
    }
    alignedCount++;
  });

  if (!selectedCount) {
    firstError = _alignCurrentTextLayerToSelection();
    if (!firstError) alignedCount++;
  }

  state.result = alignedCount > 0 ? "" : firstError;
}

function _textStyleRangeCount() {
  try {
    var reference = new ActionReference();
    reference.putProperty(charID.Property, stringIDToTypeID("textKey"));
    reference.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    var textKey = executeActionGet(reference).getObjectValue(stringIDToTypeID("textKey"));
    return textKey.getList(stringIDToTypeID("textStyleRange")).count;
  } catch (countError) {
    return 1;
  }
}

function _changeActiveLayerTextSize() {
  var state = _hostState.changeActiveLayerTextSize;
  if (!documents.length) {
    state.result = "doc";
    return;
  } else if (!_layerIsTextLayer()) {
    state.result = "layer";
    return;
  } else if (!state.value) {
    state.result = "";
    return;
  }

  var resolution = _getDocumentResolution();
  var resized = 0;
  var failure = "";
  _forEachSelectedLayer(function () {
    var oldBox = null;
    try {
      oldBox = _currentLayerBox();
    } catch (boxError) {}
    var textParams = null;
    try {
      textParams = jamText.getLayerText();
    } catch (readError) {}
    // No readable displayed size: keep the historical raw delta on the stored size
    var plan = textParams ? _textResizePlan(textParams, state.value, resolution) : null;
    var sizeBefore = _readTextStyleSize();
    var fast = false;
    // A whole-layer style write flattens mixed formatting even at one size.
    if ((!plan || plan.uniform) && (!textParams || textParams.layerText.textStyleRange.length === 1)) {
      try {
        _resizeTextStyleFast(plan, state.value);
        fast = true;
      } catch (fastError) {}
    }
    if (!fast) {
      try {
        if (!textParams) textParams = jamText.getLayerText();
      } catch (rereadError) {
        failure = "layer";
        return;
      }
      if (!_resizeTextRebuild(textParams, plan, state.value)) {
        failure = "layer";
        return;
      }
    }
    if (plan && plan.frame) {
      // The fast path leaves the frame as it was; the rebuild wrote it with
      // the planned ratio
      try {
        _fitFrameToTextSize(plan, sizeBefore, fast ? null : plan.ratio, textParams.typeUnit);
      } catch (frameError) {}
    }
    _recentreOnBox(oldBox);
    resized++;
  });

  state.result = resized > 0 ? "" : failure;
}

// Size of the layer's text style, as the fast path reads and writes it
function _readTextStyleSize() {
  try {
    var ref = new ActionReference();
    ref.putProperty(charID.Property, charID.TextStyle);
    ref.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
    var descriptor = executeActionGet(ref);
    if (!descriptor.hasKey(charID.TextStyle)) return null;
    var textStyle = descriptor.getObjectValue(charID.TextStyle);
    if (!textStyle.hasKey(charID.Size)) return null;
    return { value: textStyle.getUnitDoubleValue(charID.Size), unit: textStyle.getUnitDoubleType(charID.Size) };
  } catch (sizeError) {
    return null;
  }
}

// Fast path: one "set textStyle" action on the whole layer. With a plan the
// displayed size (and a shared fixed leading) of the plan are written, in the
// plan's unit; without one the raw delta is added as before.
function _resizeTextStyleFast(plan, delta) {
  var current = _readTextStyleSize();
  if (!current) throw new Error("no textStyle");
  var newSize = plan ? plan.nextShown : current.value + delta;
  if (!(newSize > 0)) throw new Error("bad size");
  var unit = plan ? stringIDToTypeID(plan.unit) : current.unit;

  var newTextStyle = new ActionDescriptor();
  newTextStyle.putUnitDouble(charID.Size, unit, newSize);
  if (plan && plan.scaleLeading && plan.nextLeading > 0) {
    newTextStyle.putUnitDouble(stringIDToTypeID("leading"), unit, plan.nextLeading);
  }

  var descriptor = new ActionDescriptor();
  var reference = new ActionReference();
  reference.putProperty(charID.Property, charID.TextStyle);
  reference.putEnumerated(charID.TextLayer, charID.Ordinal, charID.Target);
  descriptor.putReference(charID.Null, reference);
  descriptor.putObject(charID.To, charID.TextStyle, newTextStyle);
  executeAction(charID.Set, descriptor, DialogModes.NO);
}

// Fallback: rewrite the layer through jamText. Every run keeps its own style
// and scales by the same ratio, and so does a box frame. Returns false when
// the layer has no text to rebuild.
function _resizeTextRebuild(oldTextParams, plan, delta) {
  var oldLayerText = oldTextParams && oldTextParams.layerText;
  var text = oldLayerText ? _normalizeTextKey(oldLayerText.textKey) : "";
  if (!text || !oldLayerText.textStyleRange || !oldLayerText.textStyleRange.length) return false;
  var firstSize = Number(oldLayerText.textStyleRange[0].textStyle && oldLayerText.textStyleRange[0].textStyle.size);
  // No nested ternary here: once minified ExtendScript misreads it
  var ratio = 1;
  if (plan) {
    ratio = plan.ratio;
  } else if (firstSize > 0) {
    ratio = Math.max(0.1, firstSize + delta) / firstSize;
  }
  var scale = _transformScale(oldLayerText);
  var newTextParams = {
    typeUnit: oldTextParams.typeUnit,
    layerText: {
      textKey: text,
      textGridding: oldLayerText.textGridding || "none",
      orientation: oldLayerText.orientation || "horizontal",
      antiAlias: oldLayerText.antiAlias || "antiAliasSmooth",
      textStyleRange: [],
    },
  };
  for (var i = 0; i < oldLayerText.textStyleRange.length; i++) {
    var range = _clone(oldLayerText.textStyleRange[i]);
    var style = range.textStyle || {};
    var size = Number(style.size);
    if (size > 0) style.size = Math.max(0.1, _displayedStyleValue(style, "size", "impliedFontSize", scale) * ratio);
    if (style.autoLeading || style.leading === undefined) {
      style.autoLeading = true;
      delete style.leading;
    } else {
      style.leading = Math.max(0.1, _displayedStyleValue(style, "leading", "impliedLeading", scale) * ratio);
      style.autoLeading = false;
    }
    if (style.baselineShift !== undefined) {
      style.baselineShift = _displayedStyleValue(style, "baselineShift", "impliedBaselineShift", scale);
    }
    delete style.impliedFontSize;
    delete style.impliedLeading;
    delete style.impliedBaselineShift;
    range.textStyle = style;
    if (range.to > text.length) range.to = text.length;
    newTextParams.layerText.textStyleRange.push(range);
  }
  newTextParams.layerText.textStyleRange[newTextParams.layerText.textStyleRange.length - 1].to = text.length;
  if (oldLayerText.paragraphStyleRange && oldLayerText.paragraphStyleRange.length) {
    var paragraphRanges = [];
    for (var p = 0; p < oldLayerText.paragraphStyleRange.length; p++) {
      var paragraphRange = _clone(oldLayerText.paragraphStyleRange[p]);
      var oldParStyle = paragraphRange.paragraphStyle || {};
      oldParStyle.textEveryLineComposer = oldParStyle.textEveryLineComposer || false;
      oldParStyle.burasagari = oldParStyle.burasagari || "burasagariNone";
      paragraphRange.paragraphStyle = oldParStyle;
      if (paragraphRange.to > text.length) paragraphRange.to = text.length;
      paragraphRanges.push(paragraphRange);
    }
    paragraphRanges[paragraphRanges.length - 1].to = text.length;
    newTextParams.layerText.paragraphStyleRange = paragraphRanges;
  }
  var frame = _scaleTextShape(plan ? plan.frame : (oldLayerText.textShape && oldLayerText.textShape[0]), ratio);
  if (frame) newTextParams.layerText.textShape = [frame];
  jamText.setLayerText(newTextParams);
  _applyMiddleEast(newTextParams.layerText.textStyleRange[0].textStyle);
  return true;
}

// A box frame keeps its proportion to the text: the frame from before the
// change times the size ratio Photoshop really applied. No padding is added,
// so a + then a - puts the frame back where it was, and a full line does not
// re-wrap since text and frame scale together. `writtenRatio`: the ratio the
// frame was already written with (null when it was not written).
function _fitFrameToTextSize(plan, sizeBefore, writtenRatio, typeUnit) {
  var ratio = _appliedSizeRatio(sizeBefore, _readTextStyleSize(), plan.ratio);
  if (writtenRatio !== null && Math.abs(ratio - writtenRatio) < 1e-9) return;
  var frame = _scaleTextShape(plan.frame, ratio);
  if (!frame) return;
  var params = { layerText: { textShape: [frame] } };
  if (typeUnit) params.typeUnit = typeUnit;
  jamText.setLayerText(params);
}

// Put the layer's centre back where it was before the resize
function _recentreOnBox(oldBox) {
  if (!oldBox) return;
  var newBox = null;
  try {
    newBox = _currentLayerBox();
  } catch (boxError) {}
  if (!newBox) return;
  var offsetX = oldBox.xMid - newBox.xMid;
  var offsetY = oldBox.yMid - newBox.yMid;
  if (offsetX || offsetY) _moveLayer(offsetX, offsetY);
}

/* ======================================================== */
/* ==================== public methods ==================== */
/* ======================================================== */

function nativeAlert(data) {
  if (!data) return "";
  alert(data.text, data.title, data.isError);
}

function nativeConfirm(data) {
  if (!data) return "";
  var result = confirm(data.text, false, data.title);
  return result ? "1" : "";
}

function getUserFonts() {
  var fontsArr = [];
  for (var i = 0; i < app.fonts.length; i++) {
    var font = app.fonts[i];
    fontsArr.push({
      name: font.name,
      postScriptName: font.postScriptName,
      family: font.family,
      style: font.style,
    });
  }
  return jamJSON.stringify({
    fonts: fontsArr,
  });
}

function reloadUserFonts() {
  // app.fonts is built once at startup; refreshFonts() (CC 2015+) makes
  // Photoshop rescan the system so freshly installed fonts appear without a
  // restart. Only called after an explicit install action — the rescan
  // briefly blocks the host.
  try {
    app.refreshFonts();
  } catch (e) {
    // Older hosts without refreshFonts still return the current list.
  }
  return getUserFonts();
}

var frontmostCheckCache = { time: 0, front: true };

function isHostAppFrontmost() {
  // ScriptUI.environment.keyboardState reports the system-wide keyboard
  // state, so hotkeys would fire even while another app is focused. There is
  // no ExtendScript API for the foreground app, so shell out on macOS.
  if ($.os && $.os.indexOf("Windows") === 0) return true;
  var now = new Date().getTime();
  if (now - frontmostCheckCache.time < 300) return frontmostCheckCache.front;
  var front = true;
  try {
    front = app.system('lsappinfo info -only name `lsappinfo front` 2>/dev/null | grep -qi photoshop') === 0;
  } catch (e) {
    front = true;
  }
  frontmostCheckCache.time = now;
  frontmostCheckCache.front = front;
  return front;
}

function getHotkeyPressed() {
  var state = ScriptUI.environment.keyboardState;
  var string = "a";

  if (state.metaKey) {
    string += "WINa";
  }
  if (state.ctrlKey) {
    string += "CTRLa";
  }
  if (state.altKey) {
    string += "ALTa";
  }
  if (state.shiftKey) {
    string += "SHIFTa";
  }
  if (state.keyName) {
    string += state.keyName.toUpperCase() + "a";
  }
  if (string !== "a" && !isHostAppFrontmost()) {
    return "a";
  }
  return string;
}

function getActiveLayerText() {
  if (!documents.length) {
    return "";
  }
  // ActionManager only: touching activeDocument.activeLayer through the DOM
  // collapses a multi-layer selection down to a single layer
  if (!_layerIsTextLayer()) {
    return "";
  }
  var layerId = null;
  try {
    var layerIdProp = stringIDToTypeID("layerID");
    var idRef = new ActionReference();
    idRef.putProperty(charID.Property, layerIdProp);
    idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
    layerId = executeActionGet(idRef).getInteger(layerIdProp);
  } catch (idError) {}
  // Rendered pixel bounds let the panel calibrate its text measurements
  // against real pixels (TextShapeR bubble-fit)
  var bounds = null;
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  var stroke = null;
  try {
    stroke = _getLayerStroke();
  } catch (strokeError) {}
  // Layer IDs restart per document, so the panel cannot tell layer 5 of this
  // page from layer 5 of the last one without this. Its bubble cache and its
  // "nothing changed" signature are both keyed on the layer.
  var documentId = null;
  try {
    documentId = _getCurrentDocumentId();
  } catch (documentError) {}
  return jamJSON.stringify({
    layerId: layerId,
    documentId: documentId,
    bounds: bounds,
    textType: _textLayerIsPointText() ? "point" : "paragraph",
    textProps: jamText.getLayerText(),
    stroke: stroke,
  });
}

function _getRenderedTextLines() {
  var state = _hostState.getRenderedTextLines;
  var originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  var duplicated = false;
  try {
    // Converting box text to point text makes Photoshop materialize its
    // automatic wraps as hard returns — the only scriptable way to read the
    // rendered line breaks. Done on a throwaway duplicate so the original
    // layer is never modified.
    _duplicateActiveLayer();
    duplicated = true;
    _changeToPointText();
    var textParams = jamText.getLayerText();
    if (textParams && textParams.layerText && typeof textParams.layerText.textKey === "string") {
      state.result = textParams.layerText.textKey;
    }
  } catch (readError) {}
  if (duplicated) {
    try {
      _deleteActiveLayer();
    } catch (deleteError) {}
  }
  if (originalId !== null) {
    try {
      _selectLayerById(originalId);
    } catch (selectError) {}
  }
}

// Text of the active layer with the line breaks it actually renders with:
// point text already holds every break in textKey, while box (paragraph)
// text needs the duplicate-and-convert pass above to expose its wraps
function getRenderedTextLines() {
  if (!documents.length || !_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer" });
  }
  if (_textLayerIsPointText()) {
    var textParams = jamText.getLayerText();
    var text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
    return jamJSON.stringify({ text: text || "" });
  }
  var state = _hostState.getRenderedTextLines;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Read Shape", "_getRenderedTextLines()");
  return jamJSON.stringify({ text: state.result });
}

function _collectTextLayerIds(container, ids, limit) {
  for (var index = 0; index < container.layers.length; index++) {
    if (ids.length >= limit) return;
    var layer = container.layers[index];
    if (layer.typename === "LayerSet") {
      _collectTextLayerIds(layer, ids, limit);
    } else if (layer.kind === LayerKind.TEXT && layer.visible) {
      ids.push(layer.id);
    }
  }
}

// Learning from the whole page without bubble outlines: the layers are the
// typesetter's own, so they are never converted in place — the page is
// duplicated once, the copies are converted together, read by identifier and
// dropped in one delete. Four actions plus a cheap get per layer, instead of
// four actions per layer, which is what made repeating it slow the session
// down. Throws if anything is off, and the caller falls back to the walk.
function _readPageTextsInOneBatch(ids) {
  var texts = [];
  _selectLayersAtOnce(ids);
  _duplicateActiveLayer();
  var copies = _getSelectedLayerIds();
  if (!copies.length) throw new Error("noCopies");
  // Photoshop leaves the copies selected. If anything ever leaves the
  // originals selected instead, converting and deleting them would destroy the
  // typesetter's page — refuse before touching a single one.
  for (var copyIndex = 0; copyIndex < copies.length; copyIndex++) {
    for (var originalIndex = 0; originalIndex < ids.length; originalIndex++) {
      if (copies[copyIndex] === ids[originalIndex]) throw new Error("duplicateSelectionUnclear");
    }
  }
  try {
    _changeSelectionToPointText();
    for (var index = 0; index < copies.length; index++) {
      try {
        var text = _getTextKeyById(copies[index]);
        if (text) texts.push(text);
      } catch (readError) {}
    }
  } finally {
    _selectLayersAtOnce(copies);
    _deleteActiveLayer();
  }
  return texts;
}

function _getAllRenderedTextLines() {
  var state = _hostState.getAllRenderedTextLines;
  var originalId = null;
  try {
    originalId = _getActiveLayerId();
  } catch (idError) {}
  // Bubble scans only run in the precise mode, and they destroy the current
  // selection: never sacrifice one the user drew — without a selection at
  // batch start, scans are free to run
  var canScanBubbles = false;
  if (state.scanBubbles) {
    try {
      canScanBubbles = !_getCurrentSelectionBounds();
    } catch (selectionError) {}
  }
  var ids = [];
  try {
    _collectTextLayerIds(app.activeDocument, ids, 80);
  } catch (collectError) {}
  var entries = [];
  // No outlines to pair with, so the page can be read in one batch. The order
  // does not matter here: the caller feeds these texts to the ranker one after
  // another and never looks at which layer each came from.
  if (!canScanBubbles && ids.length) {
    try {
      var batched = _readPageTextsInOneBatch(ids);
      for (var batchIndex = 0; batchIndex < batched.length; batchIndex++) {
        entries.push({ text: batched[batchIndex], bubble: null });
      }
    } catch (batchError) {
      entries = [];
    }
    if (entries.length) {
      if (originalId !== null) {
        try { _selectLayerById(originalId); } catch (restoreError) {}
      }
      state.result = jamJSON.stringify({ entries: entries });
      return;
    }
  }
  for (var index = 0; index < ids.length; index++) {
    try {
      _selectLayerById(ids[index]);
      if (!_layerIsTextLayer()) continue;
      // Re-detect the bubble around this layer (same wand scan as the
      // bubble-aware mode) so each learned exemplar keeps its outline context
      var bubble = null;
      if (canScanBubbles) {
        try {
          var scan = _scanActiveLayerBubble(20, 17);
          if (scan && !scan.error && scan.bounds && scan.rows && scan.rows.length) {
            bubble = { rows: scan.rows, width: scan.bounds.width, height: scan.bounds.height };
          }
        } catch (bubbleScanError) {}
      }
      var text = "";
      if (_textLayerIsPointText()) {
        var textParams = jamText.getLayerText();
        text = textParams && textParams.layerText ? textParams.layerText.textKey : "";
      } else {
        // Same duplicate-and-convert trick as the single-layer read: box
        // text only exposes its automatic wraps once converted to point text
        var duplicated = false;
        try {
          _duplicateActiveLayer();
          duplicated = true;
          _changeToPointText();
          var dupParams = jamText.getLayerText();
          if (dupParams && dupParams.layerText && typeof dupParams.layerText.textKey === "string") {
            text = dupParams.layerText.textKey;
          }
        } catch (readError) {}
        if (duplicated) {
          try {
            _deleteActiveLayer();
          } catch (deleteError) {}
        }
      }
      if (text) entries.push({ text: text, bubble: bubble });
    } catch (layerError) {}
  }
  if (originalId !== null) {
    try {
      _selectLayerById(originalId);
    } catch (selectError) {}
  }
  state.result = jamJSON.stringify({ entries: entries });
}

// Rendered text of every visible text layer in the document, automatic box
// wraps included: fuels the "learn from the whole page" batch feedback.
// data.scanBubbles re-detects each layer's bubble outline (slower, precise).
function getAllRenderedTextLines(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "document" });
  }
  var state = _hostState.getAllRenderedTextLines;
  state.scanBubbles = !!(data && data.scanBubbles);
  state.result = jamJSON.stringify({ entries: [] });
  // The read duplicates a layer per box text and can wand a balloon per layer,
  // so it leaves a history state behind every time the typesetter learns from a
  // page. Borrow one and give it back, exactly like the shape scans; if the
  // document is not in a state where that is safe (sitting on an undo), fall
  // back to the plain suspension rather than refusing to learn.
  var borrowed = _withTemporaryHistory("TyperTools Read Shapes", function () {
    _getAllRenderedTextLines();
    return true;
  });
  if (!borrowed || borrowed.error) {
    app.activeDocument.suspendHistory("TyperTools Read Shapes", "_getAllRenderedTextLines()");
  }
  return state.result;
}

// Training reads run on a disposable document. Existing PSDs, their layer
// selections, pixel selections and history must remain untouched.
function _collectTrainingTextLayers(container, entries, parentPath, parentVisible) {
  for (var index = 0; index < container.layers.length; index++) {
    var layer = container.layers[index];
    var layerPath = parentPath ? parentPath + " / " + layer.name : layer.name;
    var visible = parentVisible && layer.visible;
    if (layer.typename === "LayerSet") {
      _collectTrainingTextLayers(layer, entries, layerPath, visible);
    } else if (layer.kind === LayerKind.TEXT) {
      entries.push({ layerId: layer.id, name: layer.name, layerPath: layerPath, visible: visible });
    }
  }
}

function _readTextShapeRTrainingLayers() {
  var state = _hostState.textShapeRTraining;
  var entries = [];
  _collectTrainingTextLayers(app.activeDocument, entries, "", true);
  // Selecting a layer to read it costs one executeAction(Select) each, and
  // those are what make a long import crawl: measured over 60 pages of the
  // same volume, the layer-at-a-time walk went from 264 to 467 ms per layer
  // while the same read done by identifier stayed flat around 100 ms. Nothing
  // is merged here — the layers are selected together only so that one
  // conversion command reaches each of them, exactly as picking them all in
  // the Layers panel would, and each is still read on its own identifier.
  // Box text has to be converted to point text to show the wraps it renders,
  // which is the whole point of learning from a typeset page.
  var ids = [];
  for (var idIndex = 0; idIndex < entries.length; idIndex++) ids.push(entries[idIndex].layerId);
  var converted = false;
  if (ids.length) {
    try {
      _selectLayersAtOnce(ids);
      _changeSelectionToPointText();
      converted = true;
    } catch (convertError) {}
  }
  for (var index = 0; index < entries.length; index++) {
    var entry = entries[index];
    entry.text = "";
    try {
      if (!converted) {
        // A page the batch refused — a locked layer, an unexpected state —
        // still gets read, one layer at a time, rather than lost
        _selectLayerById(entry.layerId);
        if (!_textLayerIsPointText()) _changeToPointText();
      }
      entry.text = _getTextKeyById(entry.layerId) || "";
    } catch (readError) {
      entry.error = "readFailed";
    }
  }
  state.entries = entries;
}

// A batch import that hangs takes Photoshop down with it, so the diagnosis has
// to be on disk before the step that hangs, not after: every phase is written
// and flushed before the work it names. The last line of the log is the step
// that never came back. Lives in %APPDATA%/TypeR (Application Support on Mac).
var _TRAINING_LOG_LIMIT = 262144;
function _trainingLog(text) {
  try {
    var now = new Date();
    var stamp = now.getFullYear() + "-" + _pad2(now.getMonth() + 1) + "-" + _pad2(now.getDate()) +
      " " + _pad2(now.getHours()) + ":" + _pad2(now.getMinutes()) + ":" + _pad2(now.getSeconds());
    var folder = new Folder(Folder.userData + "/TypeR");
    if (!folder.exists) folder.create();
    var file = new File(folder.fsName + "/training.log");
    // Bounded: a log nobody ever reads must not grow across sessions
    if (file.exists && file.length > _TRAINING_LOG_LIMIT) file.remove();
    file.open("a");
    file.writeln(stamp + " " + text);
    file.close();
  } catch (logError) {}
}

function _pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function _freeMemoryMB() {
  try { return Math.round(app.freeMemory / 1048576); } catch (memoryError) { return -1; }
}

// The panel writes into the same log so its own view of the import — start,
// cancel, the file a scan never came back from — sits next to the host phases
// in one ordered file. If Photoshop is wedged this call only lands later, and
// the last host line already names the step that hung.
function logTextShapeRTraining(text) {
  _trainingLog("panel " + String(text == null ? "" : text).replace(/[\r\n]+/g, " "));
  return "";
}

// An empty path means the current page, including unsaved edits. A supplied
// path reuses the open document when present, otherwise opens it without saving.
function scanTextShapeRTraining(path) {
  var previousDoc = null;
  var source = null;
  var workDoc = null;
  var file = null;
  var saveDialogs = app.displayDialogs;
  var logName = String(path || "(active page)").split(/[\/]/).pop();
  var startedAt = new Date().getTime();
  _trainingLog("open " + logName + " freeMB=" + _freeMemoryMB() + " docs=" + app.documents.length);
  try { previousDoc = app.activeDocument; } catch (noDocument) {}
  try {
    if (path) {
      if (!/\.psd$/i.test(path)) return jamJSON.stringify({ error: "badPath" });
      file = new File(path);
      if (!file.exists) return jamJSON.stringify({ error: "notFound" });
      for (var index = 0; index < app.documents.length; index++) {
        try {
          if (app.documents[index].fullName.fsName === file.fsName) {
            source = app.documents[index];
            break;
          }
        } catch (unsavedDocument) {}
      }
    } else {
      source = previousDoc;
      if (!source) return jamJSON.stringify({ error: "document" });
    }
    app.displayDialogs = DialogModes.NO;
    if (source) {
      app.activeDocument = source;
      workDoc = source.duplicate("TypeR Training Preview", false);
    } else {
      workDoc = app.open(file);
    }
    app.activeDocument = workDoc;
    _hostState.textShapeRTraining = { entries: [] };
    _trainingLog("read " + logName + " openMs=" + (new Date().getTime() - startedAt));
    workDoc.suspendHistory("TypeR Read Training", "_readTextShapeRTrainingLayers()");
    _trainingLog("layers " + logName + " n=" + _hostState.textShapeRTraining.entries.length);
    return jamJSON.stringify({ entries: _hostState.textShapeRTraining.entries });
  } catch (scanError) {
    _trainingLog("failed " + logName + " " + (scanError && scanError.message ? scanError.message : scanError));
    return jamJSON.stringify({ error: "scanFailed" });
  } finally {
    if (workDoc) {
      try { workDoc.close(SaveOptions.DONOTSAVECHANGES); } catch (closeError) {}
    }
    // Photoshop holds every page's undo and cache tiles for the whole session,
    // which is why file 100 of an import is slower than file 10. Purging is
    // free here, but it would also throw away the undo history of whatever the
    // typesetter has open, so it only runs when the scan left Photoshop empty.
    try {
      if (!app.documents.length) app.purge(PurgeTarget.ALLCACHES);
    } catch (purgeError) {}
    if (previousDoc) {
      try { app.activeDocument = previousDoc; } catch (restoreError) {}
    }
    app.displayDialogs = saveDialogs;
    _hostState.textShapeRTraining = null;
    _trainingLog("closed " + logName + " ms=" + (new Date().getTime() - startedAt) +
      " freeMB=" + _freeMemoryMB() + " docs=" + app.documents.length);
  }
}

function setActiveLayerText(data) {
  var state = _hostState.setActiveLayerText;
  state.data = data;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Change", "_setActiveLayerText()");
  return state.result;
}

function _setSelectedTextLayers() {
  var state = _hostState.setSelectedTextLayers;
  var items = state.data && state.data.items ? state.data.items : [];
  var requestedRestoreIds = state.data && state.data.restoreLayerIds
    ? state.data.restoreLayerIds
    : [];
  var restoreIds = [];
  state.result = "";

  if (!documents.length) {
    state.result = "doc";
    return;
  }
  if (items.length < 2) {
    state.result = "layer";
    return;
  }

  var restoreSource = requestedRestoreIds.length ? requestedRestoreIds : items;
  for (var restoreIndex = 0; restoreIndex < restoreSource.length; restoreIndex++) {
    var restoreValue = requestedRestoreIds.length
      ? restoreSource[restoreIndex]
      : restoreSource[restoreIndex].layerId;
    var restoreId = parseInt(restoreValue, 10);
    if (!isNaN(restoreId)) restoreIds.push(restoreId);
  }

  // Validate every target before changing any layer. The history rollback in
  // setSelectedTextLayers remains the safety net for errors raised while the
  // text/style is actually being applied.
  for (var validateIndex = 0; validateIndex < items.length; validateIndex++) {
    var validateId = parseInt(items[validateIndex].layerId, 10);
    if (isNaN(validateId)) {
      state.result = "layer";
      break;
    }
    try {
      _selectLayerById(validateId);
      if (!_layerIsTextLayer() || app.activeDocument.activeLayer.allLocked) {
        state.result = "layer";
        break;
      }
    } catch (validateError) {
      state.result = "scriptError: " +
        (validateError && validateError.message ? validateError.message : validateError);
      break;
    }
  }

  if (state.result) {
    if (restoreIds.length) {
      try {
        _selectLayersById(restoreIds);
      } catch (validateRestoreError) {}
    }
    return;
  }

  for (var i = 0; i < items.length; i++) {
    var layerId = parseInt(items[i].layerId, 10);
    if (isNaN(layerId)) {
      state.result = "layer";
      break;
    }
    try {
      _selectLayerById(layerId);
      if (!_layerIsTextLayer()) {
        state.result = "layer";
        break;
      }
      _hostState.setActiveLayerText.data = items[i];
      _hostState.setActiveLayerText.result = "";
      _setActiveLayerText();
      if (_hostState.setActiveLayerText.result) {
        state.result = _hostState.setActiveLayerText.result;
        break;
      }
    } catch (applyError) {
      state.result = "scriptError: " + (applyError && applyError.message ? applyError.message : applyError);
      break;
    }
  }

  if (restoreIds.length) {
    try {
      _selectLayersById(restoreIds);
    } catch (restoreError) {}
  }
}

function setSelectedTextLayers(data) {
  var state = _hostState.setSelectedTextLayers;
  state.data = data;
  state.result = "";
  if (!documents.length) return "doc";
  var originalHistoryState = null;
  try {
    originalHistoryState = app.activeDocument.activeHistoryState;
  } catch (historyReadError) {}
  app.activeDocument.suspendHistory("TyperTools Multiple Paste", "_setSelectedTextLayers()");
  if (state.result && originalHistoryState) {
    try {
      app.activeDocument.activeHistoryState = originalHistoryState;
    } catch (historyRollbackError) {}
    var restoreIds = data && data.restoreLayerIds ? data.restoreLayerIds : [];
    if (restoreIds.length) {
      try {
        _selectLayersById(restoreIds);
      } catch (rollbackRestoreError) {}
    }
  }
  return state.result;
}

function createTextLayerInSelection(data, point) {
  var state = _hostState.createTextLayerInSelection;
  state.data = data;
  state.point = point;
  state.padding = data.padding || 0;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Paste", "_createTextLayerInSelection()");
  return state.result;
}

// data.placements (from alignCapture and app_src/oneClick/alignPlan.js) send
// texts of a double or triple bubble to their chamber; the others use the
// selection, or the wand around them.
function alignTextLayerToSelection(data) {
  var state = _hostState.alignTextLayerToSelection;
  state.resize = !!data.resizeTextBox;
  state.padding = data.padding || 0;
  state.phantomOffsetX = Number(data && data.phantomOffsetX) || 0;
  state.result = "";
  state.placements = {};
  try {
    if (data.placements && String(app.activeDocument.id) === String(data.documentId)) {
      state.placements = _alignPlacementMap(data.placements);
    }
  } catch (placementError) {}
  app.activeDocument.suspendHistory("TyperTools Align", "_alignTextLayerToSelection()");
  state.placements = {};
  return state.result;
}

// Placement rectangles by layer id ("id" + id). The centre may be the
// chamber's optical centre: kept when it lies inside the rectangle.
function _alignPlacementMap(list) {
  var map = {};
  for (var i = 0; list && i < list.length; i++) {
    var placement = list[i];
    var r = placement && placement.rect;
    var rect = r ? _rectFrom(r.left, r.top, r.right, r.bottom) : null;
    if (!rect || placement.id === undefined || placement.id === null) continue;
    var x = Number(r.xMid);
    var y = Number(r.yMid);
    if (isFinite(x) && isFinite(y) && _containsPoint(rect, x, y)) {
      rect.xMid = x;
      rect.yMid = y;
    }
    map["id" + placement.id] = rect;
  }
  return map;
}

// What Align needs to split a double or triple bubble, read in a rolled-back
// history (the document, its selection and work path stay as they were):
// the selected texts (id, stack index, box) and the outline of the bubble
// around them, as a work path. The user's selection is that bubble; without
// one, each text gets the wand probes of the auto-centre. The panel cuts the
// outlines into chambers (app_src/oneClick/alignPlan.js).
function alignCapture() {
  if (!documents.length) return jamJSON.stringify({ error: "doc" });
  var read = _withTemporaryHistory("TypeR Read Bubble", _alignCaptureRun, { discardRedo: true });
  if (!read || read.error) return jamJSON.stringify({ error: (read && read.error) || "capture" });
  return jamJSON.stringify(read);
}

// Position in the layer stack: a text pasted later sits higher
function _layerStackIndex(id) {
  try {
    var key = stringIDToTypeID("itemIndex");
    var reference = new ActionReference();
    reference.putProperty(charID.Property, key);
    reference.putIdentifier(charID.Layer, id);
    return executeActionGet(reference).getInteger(key);
  } catch (indexError) {
    return 0;
  }
}

function _alignReadOutline() {
  var bounds = _liveSelectionBounds();
  if (!bounds) return null;
  // The fork's cusp geometry was calibrated at 0.5 px; smoothing loses narrow necks.
  _makeWorkPathFromSelection(0.5);
  var path = _smartReadWorkPath();
  if (!path) return null;
  return { selectionBounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom }, rawPath: path, textIds: [] };
}

function _alignCaptureRun() {
  var docSize = _getDocumentPixelSize();
  var entries = _targetLayerEntries();
  var ids = [];
  var texts = [];
  var i, j;
  for (i = 0; i < entries.length; i++) {
    ids.push(entries[i].id);
    if (!entries[i].text) continue;
    _selectLayerById(entries[i].id);
    var box = _currentLayerBox();
    if (box) texts.push({ id: entries[i].id, index: _layerStackIndex(entries[i].id), box: box, sizePixels: _currentDisplayedTextPixels() });
  }
  var bubbles = [];
  if (_liveSelectionBounds()) {
    var outline = _alignReadOutline();
    if (outline) {
      for (i = 0; i < texts.length; i++) outline.textIds.push(texts[i].id);
      bubbles.push(outline);
    }
  } else {
    _withoutLettering(function () {
      for (i = 0; i < texts.length; i++) {
        var found = _probeBubble(texts[i].box, texts[i].sizePixels, [], docSize).best;
        var live = found ? _liveSelectionBounds() : null;
        if (!live) continue;
        var known = null;
        for (j = 0; j < bubbles.length && !known; j++) {
          var b = bubbles[j].selectionBounds;
          if (b.left === live.left && b.top === live.top && b.right === live.right && b.bottom === live.bottom) known = bubbles[j];
        }
        if (!known) {
          known = _alignReadOutline();
          if (!known) continue;
          bubbles.push(known);
        }
        known.textIds.push(texts[i].id);
      }
    });
  }
  if (ids.length > 1) _selectLayersById(ids);
  else if (ids.length) _selectLayerById(ids[0]);
  return {
    documentId: app.activeDocument.id,
    width: docSize.width,
    height: docSize.height,
    resolution: _getDocumentResolution(),
    texts: texts,
    bubbles: bubbles,
  };
}

// Answers "" or an error code the panel translates: "doc",
// "doubleBubbleLayers", "doubleBubbleEmpty", "doubleBubbleNotFound", or
// "scriptError: ..." for anything Photoshop refused. A failed split leaves
// the document as it was.
function alignTextLayersToDoubleBubble(data) {
  var state = _hostState.alignTextLayersToDoubleBubble;
  state.resize = !!(data && data.resizeTextBox);
  state.padding = (data && data.padding) || 0;
  state.result = "";
  state.entries = null;
  if (!documents.length) return "doc";
  var entries = null;
  try {
    entries = _targetLayerEntries();
  } catch (entriesError) {
    entries = null;
  }
  if (!_doubleBubbleEntriesValid(entries)) return "doubleBubbleLayers";
  state.entries = entries;
  var doc = app.activeDocument;
  var previousHistory = null;
  try {
    previousHistory = doc.activeHistoryState;
  } catch (historyError) {}
  try {
    doc.suspendHistory("TyperTools Align Double", "_alignTextLayersToDoubleBubble()");
  } catch (e) {
    state.result = "scriptError: " + (e && e.message ? e.message : e);
  }
  if (state.result && previousHistory) {
    try {
      doc.activeHistoryState = previousHistory;
    } catch (rollbackError) {}
  }
  state.entries = null;
  return state.result;
}

function changeActiveLayerTextSize(val) {
  var state = _hostState.changeActiveLayerTextSize;
  state.value = val;
  state.result = "";
  app.activeDocument.suspendHistory("TyperTools Resize", "_changeActiveLayerTextSize()");
  return state.result;
}

function getCurrentSelection() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var selection = _checkSelection({ adjustAmount: 0 });
  if (selection.error) {
    return jamJSON.stringify({ error: selection.error });
  }
  return jamJSON.stringify(selection);
}

function _buildBoundsShapeRows(bounds, sampleCount) {
  var rows = [];
  for (var i = 0; i < sampleCount; i++) {
    var y = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
    rows.push({
      y: y,
      left: 0,
      right: 1,
      width: 1,
    });
  }
  return {
    bounds: bounds,
    rows: rows,
    fallback: true,
  };
}

function _normalizeShapeSampleCount(value, fallback) {
  var sampleCount = value ? parseInt(value, 10) : fallback;
  if (isNaN(sampleCount)) sampleCount = fallback;
  if (sampleCount < 5) sampleCount = 5;
  if (sampleCount > 31) sampleCount = 31;
  return sampleCount;
}

function _sampleCurrentSelectionShape(bounds, sampleCount) {
  var doc = app.activeDocument;
  var tempChannel = _createTempSelectionChannel(doc);
  if (!tempChannel) {
    return _buildBoundsShapeRows(bounds, sampleCount);
  }

  var rows = [];
  var oldUnits = app.preferences.rulerUnits;
  var canIntersect = true;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    for (var i = 0; i < sampleCount; i++) {
      var yRatio = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
      var yMid = bounds.top + bounds.height * yRatio;
      var sliceHeight = Math.max(1, Math.ceil(bounds.height / sampleCount));
      var top = Math.max(bounds.top, Math.round(yMid - sliceHeight / 2));
      var bottom = Math.min(bounds.bottom, Math.round(yMid + sliceHeight / 2));
      if (bottom <= top) bottom = top + 1;

      try {
        doc.selection.select([
          [bounds.left, top],
          [bounds.right, top],
          [bounds.right, bottom],
          [bounds.left, bottom],
        ], SelectionType.REPLACE, 0, false);
        doc.selection.load(tempChannel, SelectionType.INTERSECT);
      } catch (sliceError) {
        canIntersect = false;
        break;
      }

      var span = _getCurrentSelectionBounds();
      if (span && span.width > 0) {
        rows.push({
          y: yRatio,
          left: Math.max(0, Math.min(1, (span.left - bounds.left) / bounds.width)),
          right: Math.max(0, Math.min(1, (span.right - bounds.left) / bounds.width)),
          width: Math.max(0, Math.min(1, span.width / bounds.width)),
        });
      } else {
        rows.push({
          y: yRatio,
          left: 0.5,
          right: 0.5,
          width: 0,
        });
      }
    }
  } catch (error) {
    canIntersect = false;
  } finally {
    try {
      doc.selection.load(tempChannel);
    } catch (restoreError) {}
    try {
      tempChannel.remove();
    } catch (removeError) {}
    app.preferences.rulerUnits = oldUnits;
  }

  if (!canIntersect || !rows.length) {
    return _buildBoundsShapeRows(bounds, sampleCount);
  }

  return {
    bounds: bounds,
    rows: rows,
    fallback: false,
  };
}

function _findWorkPath(doc) {
  try {
    for (var i = 0; i < doc.pathItems.length; i++) {
      if (doc.pathItems[i].kind === PathKind.WORKPATH) return doc.pathItems[i];
    }
  } catch (findError) {}
  return null;
}

/*
 * Anchors of the targeted path, in document pixels, read through the Action
 * Manager.
 *
 * The DOM (`subPathItems[i].pathPoints[j].anchor`) costs about 5.7 ms per
 * anchor: the 592-anchor outline of one balloon took 3.4 s, which is not a price
 * a centering click can pay. The same anchors come back from a single
 * executeActionGet in a few milliseconds.
 *
 * The unit comes from the descriptor, it is not assumed: measured on Photoshop
 * 27.9, `pathContents` anchors carry `pixelsUnit` and are already in document
 * pixels (DOM 1082,24 against Action Manager 1082,24 on a 300 dpi page). Scaling
 * them by `resolution / 72` anyway multiplied every anchor by 4.17 there, so
 * `_pathAnchorsMatchDom` refused the outline and no balloon on a page outside
 * 72 dpi ever produced a centroid. A host that reports them in points still
 * works: that is what the resolution scale below is for.
 *
 * Control points are ignored on purpose: with a 0.5 px trace tolerance the
 * chords are a couple of pixels long and flattening the curves changed the
 * centroid by less than 0.2 px on the reference pages.
 */
function _readPathAnchorPolygons(doc) {
  var pointScale = 1;
  try {
    var resolution = parseFloat(doc.resolution);
    if (resolution > 0) pointScale = resolution / 72;
  } catch (resolutionError) {
    return null;
  }

  var ref = new ActionReference();
  ref.putProperty(charID.Property, stringIDToTypeID("pathContents"));
  ref.putEnumerated(charID.Path, charID.Ordinal, charID.Target);
  var contents = executeActionGet(ref).getObjectValue(stringIDToTypeID("pathContents"));
  var components = contents.getList(stringIDToTypeID("pathComponents"));
  var horizontalId = stringIDToTypeID("horizontal");
  var verticalId = stringIDToTypeID("vertical");
  var anchorId = stringIDToTypeID("anchor");
  var pointsId = stringIDToTypeID("points");
  var subpathsId = stringIDToTypeID("subpathListKey");

  // Count first, read second. `points.count` is a list size, so the whole outline
  // can be measured without materialising a single anchor: the budget below now
  // protects the read it exists to protect, instead of being checked by the caller
  // after the read has already been paid for.
  var budgeted = 0;
  var overBudget = false;
  for (var cc = 0; cc < components.count && !overBudget; cc++) {
    var sizing = components.getObjectValue(cc).getList(subpathsId);
    for (var ss = 0; ss < sizing.count; ss++) {
      budgeted += sizing.getObjectValue(ss).getList(pointsId).count;
      if (budgeted > _MAX_BALLOON_PATH_ANCHORS) { overBudget = true; break; }
    }
  }
  // The caller reports the count, so it must survive the refusal
  _hostState.lastPathAnchorCount = budgeted;
  if (overBudget) return null;

  var polygons = [];
  var scale = null;
  for (var c = 0; c < components.count; c++) {
    var subpaths = components.getObjectValue(c).getList(subpathsId);
    for (var s = 0; s < subpaths.count; s++) {
      var points = subpaths.getObjectValue(s).getList(pointsId);
      if (points.count < 3) continue;
      var poly = [];
      for (var p = 0; p < points.count; p++) {
        var anchor = points.getObjectValue(p).getObjectValue(anchorId);
        // Pixels stay pixels; anything else is a 72 dpi distance and needs the
        // resolution scale. The ruler is pinned to pixels by the caller. Read
        // once for the whole outline: a descriptor cannot change unit halfway,
        // and the anchor loop is the hot path (10 740 anchors in 111 ms).
        if (scale === null) {
          scale = pointScale;
          try {
            if (typeIDToStringID(anchor.getUnitDoubleType(horizontalId)) === "pixelsUnit") scale = 1;
          } catch (unitError) {}
        }
        poly.push([
          anchor.getUnitDoubleValue(horizontalId) * scale,
          anchor.getUnitDoubleValue(verticalId) * scale,
        ]);
      }
      polygons.push(poly);
    }
  }
  return polygons.length ? polygons : null;
}

/*
 * One DOM anchor against the same anchor read through the Action Manager. The
 * DOM reports ruler units, which the caller has pinned to pixels, so the two
 * must agree; a mismatch means this Photoshop reports path coordinates in a unit
 * the conversion above does not cover, and the centroid is dropped instead of
 * moving the layer somewhere invented.
 */
function _pathAnchorsMatchDom(pathItem, polygons) {
  try {
    var domAnchor = pathItem.subPathItems[0].pathPoints[0].anchor;
    var amAnchor = polygons[0][0];
    return Math.abs(domAnchor[0] - amAnchor[0]) <= 2 && Math.abs(domAnchor[1] - amAnchor[1]) <= 2;
  } catch (compareError) {
    return false;
  }
}

function _readPathPolygons(pathItem) {
  var polygons = [];
  var subPaths = pathItem.subPathItems;
  for (var s = 0; s < subPaths.length; s++) {
    var points = subPaths[s].pathPoints;
    var count = points.length;
    if (count < 3) continue;
    // On noisy outlines (wand caught screentone) the point count explodes:
    // skip curve flattening there, the anchors alone are dense enough
    var flattenSteps = count > 500 ? 1 : 6;
    var poly = [];
    for (var i = 0; i < count; i++) {
      var current = points[i];
      var next = points[(i + 1) % count];
      var a = current.anchor;
      var c1 = current.rightDirection;
      var c2 = next.leftDirection;
      var b = next.anchor;
      var straight = c1[0] === a[0] && c1[1] === a[1] && c2[0] === b[0] && c2[1] === b[1];
      var steps = straight ? 1 : flattenSteps;
      for (var t = 0; t < steps; t++) {
        var u = t / steps;
        var v = 1 - u;
        poly.push([
          v * v * v * a[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u * u * u * b[0],
          v * v * v * a[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u * u * u * b[1],
        ]);
      }
    }
    if (poly.length >= 3) polygons.push(poly);
  }
  return polygons;
}

/*
 * Area centroid of a traced region.
 *
 * `Make Work Path` does not return one clean outline: it returns the balloon
 * plus holes plus, on an anti-aliased edge, specks, and their winding order
 * cannot be relied on to tell them apart. Summing every contour with its own
 * sign therefore lands several pixels off. So the largest contour is taken as
 * the balloon, contours whose own centre falls inside it are subtracted as
 * holes, and anything else (a speck, an island outside the balloon) is ignored.
 *
 * Integrating the area, rather than sampling scanlines, matters: a scanline
 * average weighs the widest rows of the outline and drifted the vertical centre
 * by tens of pixels on real balloons.
 */




/*
 * Even-odd test of a point against every contour at once: inside an odd number
 * of them means inside the region, so a point that fell in a balloon's hole is
 * rejected. A cell centroid can land outside its own cell when the cell is a
 * horseshoe, and moving the text there would be worse than not splitting at all.
 */
function _centreInsideOutline(polygons, point) {
  var inside = false;
  for (var p = 0; p < polygons.length; p++) {
    if (polygons[p].length >= 3 && _pointInPolygon(point.x, point.y, polygons[p])) inside = !inside;
  }
  return inside;
}

/*
 * Split a traced region where two balloons were drawn over each other, and give
 * back the centre of the piece the active layer sits in.
 *
 * Why this exists: `_polygonCentroid` above answers with the centroid of the
 * largest contour, so in a region that merges two balloons every text gets the
 * same target. Measured on the reference pages, a region holding one text is off
 * by 2/4 px at the median while a region holding two is off by 54/46 px and one
 * holding four by 104/17 px, out to 346 px.
 *
 * How it splits. Two overlapping convex shapes meet at exactly two cusps — the
 * points where one outline dives inside the other — and the chord between them
 * is the line that closes each balloon on its own. Finding those two corners is
 * all the geometry needed, and the corners survive the opening: opening rounds
 * convex corners, not concave ones.
 *
 * What it deliberately does not read: the other text layers. An earlier version
 * seeded the split with their ink boxes, which measured well on pages that were
 * already typeset and badly on the pages this plugin is for, where the lines have
 * just been dumped inside their balloons. Worse, it moved the answer every time
 * the button was pressed, because the neighbours had moved. Geometry alone is the
 * same answer twice.
 *
 * Its ceiling, measured: of the 38 layers that share a region on the reference
 * pages, 26 sit in a shape with a cusp pair and 12 do not — two balloons drawn as
 * one blob, or two panels fused into a rectangle, have nothing to find. Those
 * keep the whole region's centroid, which is what they had before.
 *
 * Everything here is arithmetic on the outline that was already traced: no
 * Photoshop call, no second work path, and the user's selection is never touched.
 */


/* The balloon is the contour with the most area; the rest are holes and specks. */






/*
 * The contour walked at a constant step, so a turn angle means the same thing
 * everywhere on it. `Make Work Path` drops anchors where the curve needs them —
 * dense on a corner, sparse on a straight run — and measuring a turn across a
 * fixed number of anchors would then measure a different length of outline at
 * every point, which is exactly the wrong instrument for finding corners.
 */


/*
 * The narrowest waist of the contour: the shortest line between two strong
 * concave corners that sit on opposite sides of the shape.
 *
 * Narrowest, not deepest. In a region holding four balloons the two deepest
 * corners can belong to two different junctions, and the chord between them then
 * slices through a balloon instead of between two. Measured over the reference
 * pages, taking the shortest chord instead cuts the vertical error of the
 * four-balloon regions from 14/91 px to 6/22 px and stops the cut firing on
 * single balloons at all.
 *
 * `first` and `second` are how far each corner turns back into the shape, in
 * radians, kept for the report.
 *
 * `skip` asks for the next-narrowest pair instead of the narrowest, so a caller
 * whose piece was refused can try the pair behind it. Ordering is by chord
 * length and then by index, so the same region answers the same way twice.
 */


/*
 * Cut the contour along the chord between two of its own points. Both ends are
 * already vertices, so each piece is simply one of the two arcs closed by the
 * chord — no clipping, no intersections to find.
 */


/*
 * Which piece the line belongs to.
 *
 * Containment first, when exactly one of the two holds the point: a chord does
 * not cut a shape into two half-planes once a piece is concave, so "the piece
 * whose centroid is on the same side of the chord as the text" can name the
 * wrong one, or neither. Measured over 529 traced regions, the side test picks a
 * piece that does not contain the line in 8 of 151 cuts and answers nothing at
 * all in 3 — one of those left a line 108 px out, another 115 px.
 *
 * The side test stays as the fallback, and it is not a leftover: the ink box can
 * sit outside the opened region entirely — a line dropped between two balloons,
 * or one whose region was bitten by a neighbour's ink — and a line with nowhere
 * to be still has to be given a side. Containment cannot answer there, and
 * neither can a rule that refuses.
 */


/*
 * Area centroid of the balloon whose opened selection is live right now, in
 * document pixels, or null when the outline cannot be trusted.
 *
 * The caller must already have the opened selection active and a way to restore
 * the original one, because `Make Work Path` consumes the selection. This runs
 * inside `_getAdaptiveOpenedSelectionBounds` for exactly that reason: doing it
 * separately meant a second temporary channel and a second contract/expand pair,
 * which measured 640 ms on a 5400x3840 page against 250 ms when shared.
 *
 * Measured against the 10 reference pages: replacing the bounding-box centre
 * with this centroid leaves the median error unchanged (it already sits at the
 * level of human placement noise) and cuts the 95th percentile of the error from
 * 9/38 px to 4/19 px, because a tail no longer drags the target sideways.
 */
function _openedSelectionCentroid(doc, openedBounds) {
  // Why a centroid was not produced. Cheap to keep and it took three rounds of
  // guessing to find the last cause without it.
  _hostState.centroidSkip = "";
  _hostState.lastOutline = null;
  _hostState.lastOutlineKey = "";
  if (!doc || !openedBounds || !(openedBounds.width > 0) || !(openedBounds.height > 0)) { _hostState.centroidSkip = "noBounds"; return null; }
  // Never clobber a work path the user is keeping around
  if (_findWorkPath(doc)) { _hostState.centroidSkip = "userWorkPath"; return null; }

  // A region covering a quarter of the page is not a balloon. Tracing it is both
  // meaningless and expensive — the resulting path follows every piece of artwork
  // it swallowed, and reading tens of thousands of anchors freezes Photoshop.
  if (_regionCoversTooMuchPage(openedBounds)) { _hostState.centroidSkip = "coversPage"; return null; }

  // Path anchors come back in ruler units, so the ruler is pinned to pixels
  // while the outline is read and the centroid is used as it comes.
  //
  // Mapping the centroid through the outline's own bounding box onto the
  // selection's was wrong: `Make Work Path` traces the 50% threshold while the
  // selection bounds also count the anti-aliased fringe, so the two extents
  // disagree (measured: outline 539x1069, selection 575x1163) and the rescaling
  // pushed the centre 46 px down a balloon whose traced centroid was already
  // within 1 px of where the typesetter had put it.
  var oldUnits = app.preferences.rulerUnits;
  var centre = null;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
    // Tolerance is the whole ballgame here: at 1.0 px Photoshop describes a
    // 434x681 balloon with 22 anchors and the resulting outline is not
    // symmetric, which dragged the centroid 13 px sideways. At 0.5 px the same
    // balloon takes ~490 anchors and the centroid lands within 1 px of the
    // mask's own centroid. Flattening density does not matter (6 steps and 24
    // steps agree to 0.2 px), and the anchor budget below keeps a noisy outline
    // from becoming expensive.
    _makeWorkPathFromSelection(0.5);
    var workPath = _findWorkPath(doc);
    if (workPath) {
      var polygons = null;
      _hostState.lastPathAnchorCount = 0;
      try {
        polygons = _readPathAnchorPolygons(doc);
      } catch (readError) {
        polygons = null;
        _hostState.centroidSkip = "amRead:" + (readError && readError.message ? readError.message : String(readError));
      }
      // A noisy outline (screentone, artwork caught by the fill) is refused
      // instead of stalling the host. The count comes from the reader, which
      // measures the outline from list sizes and gives up before touching an
      // anchor, so the budget costs nothing on the outlines it rejects.
      var anchors = _hostState.lastPathAnchorCount || 0;
      var centroid = null;
      if (anchors <= 2 || anchors > _MAX_BALLOON_PATH_ANCHORS) {
        _hostState.centroidSkip = "anchors:" + anchors;
      } else if (!polygons || !_pathAnchorsMatchDom(workPath, polygons)) {
        _hostState.centroidSkip = "unitMismatch";
      } else {
        centroid = _polygonCentroid(polygons);
        if (!centroid) _hostState.centroidSkip = "degenerateOutline";
        // The contours are kept for the caller: a region that merges two
        // balloons has to be split between the texts that share it, and this is
        // the only moment the outline exists. Costs nothing — the polygons are
        // already here and were about to be thrown away.
        //
        // They are parked here rather than hung on the bounds object, and only
        // one is ever kept. A bounds object outlives this call: multi-bubble
        // stores one per captured balloon and polls for a new one every 1.5 s,
        // and the measurement harness serialises the ones it keeps — which took
        // its reports from 33 KB to 360 KB the moment the outline rode along.
        // An outline is thousands of anchor pairs; it has no business travelling
        // with a rectangle.
        _hostState.lastOutline = polygons;
        _hostState.lastOutlineKey = _selectionBoundsKey(openedBounds);
      }
      // A centroid outside the selection it came from means the anchors were not
      // in document pixels after all: drop it rather than move the layer to a
      // made-up place.
      if (centroid && isFinite(centroid.x) && isFinite(centroid.y) &&
          centroid.x >= openedBounds.left - 1 && centroid.x <= openedBounds.right + 1 &&
          centroid.y >= openedBounds.top - 1 && centroid.y <= openedBounds.bottom + 1) {
        centre = { x: centroid.x, y: centroid.y };
      } else if (centroid) {
        _hostState.centroidSkip = "outsideEnvelope";
      }
      try {
        _deleteWorkPath();
      } catch (deleteError) {
        try { workPath.remove(); } catch (removeError) {}
      }
    }
  } catch (centroidError) {
    centre = null;
    _hostState.centroidSkip = "threw:" + (centroidError && centroidError.message ? centroidError.message : String(centroidError));
  }
  try { app.preferences.rulerUnits = oldUnits; } catch (unitsError) {}
  if (!centre && !_hostState.centroidSkip) _hostState.centroidSkip = "noWorkPath";
  return centre;
}

function _polygonScanlineSpan(polygons, y) {
  var minX = null;
  var maxX = null;
  for (var p = 0; p < polygons.length; p++) {
    var poly = polygons[p];
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i];
      var b = poly[(i + 1) % poly.length];
      // Half-open rule so scanlines crossing a vertex count it exactly once.
      // Deliberately a single comparison rather than the mixed &&/|| form:
      // ExtendScript's ES3 parser reads `X || Y && Z` as `(X || Y) && Z`, and
      // the build's minifier drops the parentheses the source spells out. That
      // made this test miss one side of every span, so _buildPathShapeRows
      // always returned no rows and every selection fell back to the legacy
      // 21-operation sampler - measured at 423-553 ms per scan.
      if ((a[1] > y) !== (b[1] > y)) {
        var x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
        if (minX === null || x < minX) minX = x;
        if (maxX === null || x > maxX) maxX = x;
      }
    }
  }
  return minX === null ? null : { left: minX, right: maxX };
}

function _buildPathShapeRows(polygons, sampleCount) {
  var minX = Infinity;
  var minY = Infinity;
  var maxX = -Infinity;
  var maxY = -Infinity;
  for (var p = 0; p < polygons.length; p++) {
    for (var i = 0; i < polygons[p].length; i++) {
      var point = polygons[p][i];
      if (point[0] < minX) minX = point[0];
      if (point[0] > maxX) maxX = point[0];
      if (point[1] < minY) minY = point[1];
      if (point[1] > maxY) maxY = point[1];
    }
  }
  var width = maxX - minX;
  var height = maxY - minY;
  if (!(width > 0) || !(height > 0)) return null;
  var sliceHeight = height / sampleCount;
  var rows = [];
  var covered = 0;
  for (var r = 0; r < sampleCount; r++) {
    var yRatio = sampleCount <= 1 ? 0.5 : r / (sampleCount - 1);
    var yMid = minY + height * yRatio;
    var left = null;
    var right = null;
    // The legacy sampler measured the widest extent inside each band: probe
    // three scanlines per band to keep the same behavior
    var offsets = [-sliceHeight / 2, 0, sliceHeight / 2];
    for (var k = 0; k < offsets.length; k++) {
      var y = yMid + offsets[k];
      if (y <= minY) y = minY + height * 0.002;
      if (y >= maxY) y = maxY - height * 0.002;
      var span = _polygonScanlineSpan(polygons, y);
      if (span) {
        if (left === null || span.left < left) left = span.left;
        if (right === null || span.right > right) right = span.right;
      }
    }
    if (left !== null && right > left) {
      covered++;
      rows.push({
        y: yRatio,
        left: Math.max(0, Math.min(1, (left - minX) / width)),
        right: Math.max(0, Math.min(1, (right - minX) / width)),
        width: Math.max(0, Math.min(1, (right - left) / width)),
      });
    } else {
      rows.push({ y: yRatio, left: 0.5, right: 0.5, width: 0 });
    }
  }
  if (!covered) return null;
  return rows;
}

// DOM errors pop modal alerts ("The command X is not available") unless
// dialogs are turned off for the run: scans must never surface a dialog
function _withDialogsSuppressed(fn) {
  var oldDialogs = null;
  try {
    oldDialogs = app.displayDialogs;
    app.displayDialogs = DialogModes.NO;
  } catch (dialogError) {
    oldDialogs = null;
  }
  var result = null;
  try {
    result = fn();
  } finally {
    if (oldDialogs !== null) {
      try {
        app.displayDialogs = oldDialogs;
      } catch (restoreError) {}
    }
  }
  return result;
}

function _makeWorkPathFromSelection(tolerance) {
  // Canonical source reference is property 'fsel' of class 'csel'; some
  // hosts accept it on 'Chnl' instead, so try both before giving up
  var sourceClasses = [charID.SelectionClass, charID.Channel];
  var lastError = null;
  for (var i = 0; i < sourceClasses.length; i++) {
    try {
      var desc = new ActionDescriptor();
      var pathRef = new ActionReference();
      pathRef.putClass(charID.Path);
      desc.putReference(charID.Null, pathRef);
      var fromRef = new ActionReference();
      fromRef.putProperty(sourceClasses[i], charID.FrameSelect);
      desc.putReference(charID.From, fromRef);
      desc.putUnitDouble(charID.Tolerance, charID.PixelUnit, tolerance);
      executeAction(charID.Make, desc, DialogModes.NO);
      return;
    } catch (makeError) {
      lastError = makeError;
    }
  }
  throw lastError;
}

function _deleteWorkPath() {
  var desc = new ActionDescriptor();
  var pathRef = new ActionReference();
  pathRef.putProperty(charID.Path, charID.WorkPath);
  desc.putReference(charID.Null, pathRef);
  executeAction(charID.Delete, desc, DialogModes.NO);
}

// Fast selection shape scan: one make-work-path call replaces the legacy
// 21x (rect select + channel intersect + bounds read) loop that kept
// Photoshop's UI thread busy long enough to flash the wait cursor.
// Rows are normalized against the path's own bounding box, so whatever
// unit path anchors are reported in cancels out.
// The active selection is snapshotted to a temp channel first: the path
// conversion consumes it, and both the caller (restoreSelection) and the
// legacy fallback need it back. Everything risky runs through ActionManager
// with DialogModes.NO - a host that refuses the path conversion fails
// silently into the legacy sampler instead of popping alerts, and after 3
// failures the fast path backs off for a while.
//
// The back-off is timed, not permanent: the legacy sampler costs ~60 Photoshop
// operations per scan against ~4 here, so a session that tripped the counter on
// three transient failures (a locked layer, a busy document, a scan racing an
// undo) used to stay 15x slower until Photoshop restarted - the single biggest
// cause of "TypeR gets slower the longer it runs". Retrying every few minutes
// costs one cheap probe and restores the fast path as soon as the host is happy
// again.
/*
 * Outline of the current work path, read the cheap way when it can be trusted.
 *
 * `_readPathAnchorPolygons` already existed for the centroid: one
 * executeActionGet instead of a DOM walk that costs about 5.7 ms per anchor.
 * Measured on a traced balloon (12 contours, 678 flattened points) the DOM walk
 * took 245-278 ms and the Action Manager read 48-79 ms, and the scanline rows
 * the two produce agree to 0.2 px - the anchors alone are dense enough at this
 * trace tolerance that skipping curve flattening does not move a row.
 *
 * The DOM walk stays as the fallback for a host that reports path coordinates in
 * a unit the reader does not cover, which is what `_pathAnchorsMatchDom` checks.
 * An outline over the anchor budget gets neither: the DOM walk would take
 * minutes on it, and the caller's legacy sampler is the right answer there.
 */
function _readSelectionOutlinePolygons(doc, workPath) {
  var polygons = null;
  _hostState.lastPathAnchorCount = 0;
  try {
    polygons = _readPathAnchorPolygons(doc);
  } catch (anchorReadError) {
    polygons = null;
  }
  var anchors = _hostState.lastPathAnchorCount || 0;
  if (anchors > _MAX_BALLOON_PATH_ANCHORS) {
    _hostState.lastPathScanReader = "overBudget";
    return null;
  }
  if (polygons && anchors > 2 && _pathAnchorsMatchDom(workPath, polygons)) {
    _hostState.lastPathScanReader = "anchors";
    return polygons;
  }
  _hostState.lastPathScanReader = "dom";
  return _readPathPolygons(workPath);
}

function _sampleSelectionShapeViaPath(bounds, sampleCount, restoreSelection) {
  if ((_hostState.pathScanFails || 0) >= 3) {
    var now = new Date().getTime();
    if (now - (_hostState.pathScanBackoffAt || 0) < _PATH_SCAN_RETRY_MS) return null;
    // Cooldown elapsed: allow one probe. A failure re-arms the back-off.
    _hostState.pathScanFails = 2;
  }
  var doc = app.activeDocument;
  // Never clobber a work path the user is keeping around
  if (_findWorkPath(doc)) return null;
  // An alpha channel is the only way to give back the exact selection the user
  // drew, anti-aliased fringe and all, so a caller that wants its selection back
  // pays for one. It is not cheap - measured 47 ms to create and 18 ms to remove
  // - and the wand callers throw their selection away the moment this returns,
  // so they no longer pay it. If the scan fails, they get the traced path back
  // as a selection instead, which is all the legacy sampler needs.
  var tempChannel = null;
  if (restoreSelection) {
    tempChannel = _createTempSelectionChannel(doc);
    if (!tempChannel) return null;
  }
  var rows = null;
  var failure = "";
  // Pinned to pixels for the whole read: the DOM reports anchors in ruler units,
  // and _pathAnchorsMatchDom weighs them against the Action Manager's pixels.
  var oldUnits = app.preferences.rulerUnits;
  try {
    app.preferences.rulerUnits = Units.PIXELS;
  } catch (unitsError) {}
  try {
    _makeWorkPathFromSelection(2.0);
  } catch (makeError) {
    failure = "make:" + String(makeError.message || makeError);
  }
  if (!failure) {
    var workPath = _findWorkPath(doc);
    if (workPath) {
      var polygons = null;
      try {
        polygons = _readSelectionOutlinePolygons(doc, workPath);
      } catch (readError) {
        failure = "read:" + String(readError.message || readError);
      }
      if (!failure && polygons && polygons.length) {
        rows = _buildPathShapeRows(polygons, sampleCount);
        if (!rows) failure = "emptyRows";
      } else if (!failure) {
        failure = "noPolygons";
      }
      // Rows are built while the path still exists, so a caller that took no
      // channel can hand the outline back as a selection for the fallback
      if (!rows && !tempChannel) {
        try {
          workPath.makeSelection(0, true, SelectionType.REPLACE);
        } catch (pathSelectionError) {}
      }
      try {
        _deleteWorkPath();
      } catch (deleteError) {
        try {
          workPath.remove();
        } catch (domRemoveError) {}
      }
    } else {
      failure = "noWorkPath";
    }
  }
  try {
    app.preferences.rulerUnits = oldUnits;
  } catch (restoreUnitsError) {}
  // The conversion consumed the selection: bring it back whenever the caller
  // wants it or the legacy fallback is about to need it
  if (tempChannel) {
    if (restoreSelection || !rows) {
      try {
        doc.selection.load(tempChannel);
      } catch (loadError) {}
    }
    try {
      tempChannel.remove();
    } catch (removeError) {}
  }
  if (!rows) {
    _hostState.pathScanFails = (_hostState.pathScanFails || 0) + 1;
    if (_hostState.pathScanFails >= 3) {
      _hostState.pathScanBackoffAt = new Date().getTime();
    }
    _hostState.lastPathScanError = failure;
    return null;
  }
  _hostState.pathScanFails = 0;
  _hostState.lastPathScanError = "";
  return {
    scan: "path",
    bounds: bounds,
    rows: rows,
    fallback: false,
  };
}
function getCurrentSelectionShape(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var bounds = _getCurrentSelectionBounds();
  if (!bounds) {
    return jamJSON.stringify({ error: "noSelection" });
  }
  var sampleCount = _normalizeShapeSampleCount(data && data.samples, 17);
  // A region covering a quarter of the page is not a balloon, so there is no
  // shape in it worth sampling — and sampling it is where the time goes: measured
  // 2 698 ms on a wand that had swallowed 97,6% of a 6331x8882 page, because the
  // path scan refuses and the legacy sampler then runs 21 selection operations on
  // 56 megapixels. Falling straight through to the bounding-box profile costs
  // nothing and says the same thing about a region that shape.
  var shape = _regionCoversTooMuchPage(bounds) ? null : _withTemporaryHistory("TypeR Shape Scan", function () {
    return _withDialogsSuppressed(function () {
      return (
        _sampleSelectionShapeViaPath(bounds, sampleCount, true) ||
        _sampleCurrentSelectionShape(bounds, sampleCount)
      );
    });
  });
  if (shape && shape.error) return jamJSON.stringify(shape);
  shape = shape || _buildBoundsShapeRows(bounds, sampleCount);
  // scan/scanError lead the object so they survive the debug log preview cap
  var out = { scan: shape.scan || "legacy" };
  if (out.scan === "legacy" && _hostState.lastPathScanError) {
    out.scanError = _hostState.lastPathScanError;
  }
  if (_hostState.lastPathScanReader) out.reader = _hostState.lastPathScanReader;
  out.bounds = shape.bounds;
  out.rows = shape.rows;
  out.fallback = shape.fallback;
  return jamJSON.stringify(out);
}

// Core wand scan around the active text layer, shared by the interactive
// bubble-aware mode and the batch learning pass. Destroys any selection:
// callers must ensure none exists, or accept losing it.
function _scanActiveLayerBubble(tolerance, sampleCount) {
  return _withDialogsSuppressed(function () {
    var scanResult = null;
    try {
      var textBounds = _getCurrentTextLayerBounds();
      // Same probe Align uses. The old scan wanded five pixels to the left of
      // the ink box: whenever the text nearly filled the balloon that point
      // landed outside it and the fill grabbed the panel, so TextShapeR shaped
      // the dialogue to a wide strip of page instead of to the balloon — one
      // long line where the balloon wanted six. The probe also hides this
      // layer's glyphs, so the region no longer has to be repaired afterwards.
      _createBalloonWandSelection(tolerance);
      var bounds = _getCurrentSelectionBounds();
      if (!bounds || bounds.width * bounds.height < 200) {
        _deselect();
        return { error: "noBubble" };
      }
      // A wand escaping the bubble (open outline, plain page background) grabs
      // a huge area: reject implausible bubbles instead of shaping to the page
      if (textBounds && textBounds.width > 0 && textBounds.height > 0) {
        var areaRatio = (bounds.width * bounds.height) / (textBounds.width * textBounds.height);
        if (areaRatio > 60) {
          _deselect();
          return { error: "noBubble" };
        }
      }
      // Close the text holes and smooth the outline before sampling
      var smoothAmount = Math.max(4, Math.round(_getTextLayerSize() / 2));
      _modifySelectionBounds(smoothAmount);
      var expanded = _getCurrentSelectionBounds();
      var contractAmount = _clampAdjustAmount(expanded, -smoothAmount);
      if (contractAmount !== 0) _modifySelectionBounds(contractAmount);
      bounds = _getCurrentSelectionBounds() || bounds;
      // The wand selection is ours and gets deselected right below, so the
      // fast path only restores it when the legacy fallback needs to run
      scanResult =
        _sampleSelectionShapeViaPath(bounds, sampleCount, false) ||
        _sampleCurrentSelectionShape(bounds, sampleCount);
    } catch (bubbleError) {
      scanResult = null;
    }
    try {
      _deselect();
    } catch (deselectError) {}
    return scanResult;
  });
}

function getActiveLayerBubbleShape(data) {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  if (!_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer" });
  }
  if (_getCurrentSelectionBounds()) {
    return jamJSON.stringify({ error: "hasSelection" });
  }
  // With several layers targeted the wand origin is ambiguous, and the user
  // is probably lining up a batch: leave the selection alone
  if (_getTargetLayerCount() > 1) {
    return jamJSON.stringify({ error: "multi" });
  }

  var tolerance = data && data.tolerance ? parseInt(data.tolerance, 10) : 20;
  if (isNaN(tolerance)) tolerance = 20;
  var sampleCount = _normalizeShapeSampleCount(data && data.samples, 21);

  var result = _withTemporaryHistory("TypeR Bubble Scan", function () {
    return _scanActiveLayerBubble(tolerance, sampleCount);
  });
  if (!result) {
    return jamJSON.stringify({ error: "shape" });
  }
  if (result.error) {
    return jamJSON.stringify({ error: result.error });
  }
  // scan/scanError lead the object so they survive the debug log preview cap
  var out = { scan: result.scan || "legacy" };
  if (out.scan === "legacy" && _hostState.lastPathScanError) {
    out.scanError = _hostState.lastPathScanError;
  }
  if (_hostState.lastPathScanReader) out.reader = _hostState.lastPathScanReader;
  out.bounds = result.bounds;
  out.rows = result.rows;
  out.fallback = result.fallback;
  return jamJSON.stringify(out);
}

function getSelectedTextLayers() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "doc" });
  }
  var layers = [];
  var targetLayers = stringIDToTypeID("targetLayers");
  var layerIdProp = stringIDToTypeID("layerID");
  var indexes = [];
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (doc.hasKey(targetLayers)) {
    var list = doc.getList(targetLayers);
    var backgroundRef = new ActionReference();
    backgroundRef.putProperty(charID.Property, charID.Background);
    backgroundRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Back);
    var offset = executeActionGet(backgroundRef).getBoolean(charID.Background) ? 0 : 1;
    for (var i = 0; i < list.count; i++) {
      indexes.push(list.getReference(i).getIndex() + offset);
    }
  } else {
    indexes.push(-1);
  }
  for (var j = 0; j < indexes.length; j++) {
    try {
      // Per-property gets: pulling the full layer descriptor is slow and
      // drags the whole text descriptor along for every selected layer
      var textRef = new ActionReference();
      textRef.putProperty(charID.Property, charID.Text);
      if (indexes[j] === -1) {
        textRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      } else {
        textRef.putIndex(charID.Layer, indexes[j]);
      }
      if (!executeActionGet(textRef).hasKey(charID.Text)) continue;

      var idRef = new ActionReference();
      idRef.putProperty(charID.Property, layerIdProp);
      if (indexes[j] === -1) {
        idRef.putEnumerated(charID.Layer, charID.Ordinal, charID.Target);
      } else {
        idRef.putIndex(charID.Layer, indexes[j]);
      }
      layers.push({
        id: executeActionGet(idRef).getInteger(layerIdProp),
      });
    } catch (layerError) {}
  }
  return jamJSON.stringify({ layers: layers });
}

function getActiveLayerTextIfChanged(data) {
  if (!documents.length || !_layerIsTextLayer()) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  var layerId = null;
  var historyIndex = null;
  var documentId = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  // Both halves restart per document: page 12 selected on layer 2 at history
  // state 5 answered "unchanged" for page 11's layer 2 at its own state 5, and
  // the panel kept showing the other page's text.
  try {
    documentId = _getCurrentDocumentId();
  } catch (documentError) {}
  var signature = String(documentId) + ":" + String(layerId) + ":" + String(historyIndex);
  if (layerId !== null && historyIndex !== null && data && data.signature === signature) {
    return jamJSON.stringify({ unchanged: true, signature: signature });
  }
  var snapshot = null;
  try {
    snapshot = jamJSON.parse(getActiveLayerText());
  } catch (snapshotError) {}
  if (!snapshot) return jamJSON.stringify({ error: "layer", signature: signature });
  snapshot.signature = signature;
  return jamJSON.stringify(snapshot);
}

// Geometry-only acknowledgement for Photoshop 'move' events. This intentionally
// avoids jamText.getLayerText(), stroke reads, selection reads and bubble scans:
// arrow nudges should never put Photoshop's main thread behind heavy TypeR work.
function getActiveTextLayerGeometry() {
  if (!documents.length) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  var layerId = null;
  var historyIndex = null;
  var documentId = null;
  var bounds = null;
  try {
    layerId = _getActiveLayerId();
  } catch (layerError) {}
  try {
    historyIndex = _getActiveHistoryIndex();
  } catch (historyError) {}
  // The panel hands this signature straight back to getActiveLayerTextIfChanged,
  // so the two must be built the same way or the "nothing changed" guard there
  // never matches again and every arrow nudge pays for a full layer read.
  try {
    documentId = _getCurrentDocumentId();
  } catch (documentError) {}
  try {
    bounds = _getCurrentTextLayerBounds();
  } catch (boundsError) {}
  if (layerId === null || !bounds) {
    return jamJSON.stringify({ error: "layer", signature: "" });
  }
  return jamJSON.stringify({
    layerId: layerId,
    documentId: documentId,
    bounds: bounds,
    signature: String(documentId) + ":" + String(layerId) + ":" + String(historyIndex),
  });
}

// Shared lightweight snapshot for the panel's selection-driven widgets. A
// single CEP bridge hop is much cheaper than queueing one call for the marquee
// and another for the selected text-layer IDs after every Photoshop event.
function getTypeRSelectionSnapshot() {
  var selection = null;
  var selectedLayers = { layers: [] };
  try {
    selection = jamJSON.parse(getCurrentSelection());
  } catch (selectionError) {}
  try {
    selectedLayers = jamJSON.parse(getSelectedTextLayers()) || selectedLayers;
  } catch (layersError) {}
  return jamJSON.stringify({
    selection: selection && !selection.error ? selection : null,
    layers: selectedLayers.layers || []
  });
}

function getTypeRPanelSnapshot(data) {
  var activeLayer = null;
  var selectionSnapshot = { selection: null, layers: [] };
  // jamText.getLayerText() alone costs ~95 ms of Photoshop's main thread on a
  // page-sized document, and the signature guard below it misses on every
  // history state - which a marquee drag creates. Callers that only want the
  // selection or the layer list (bubble outline, batch tracking) ask for
  // layer:false and skip it entirely.
  if (!data || data.layer !== false) {
    try {
      activeLayer = jamJSON.parse(getActiveLayerTextIfChanged(data || {}));
    } catch (activeLayerError) {}
  }
  try {
    selectionSnapshot = jamJSON.parse(getTypeRSelectionSnapshot()) || selectionSnapshot;
  } catch (selectionSnapshotError) {}
  return jamJSON.stringify({
    activeLayer: activeLayer,
    selection: selectionSnapshot.selection,
    layers: selectionSnapshot.layers || []
  });
}

function _getTargetLayerCount() {
  var targetLayers = stringIDToTypeID("targetLayers");
  var reference = new ActionReference();
  reference.putProperty(charID.Property, targetLayers);
  reference.putEnumerated(charID.Document, charID.Ordinal, charID.Target);
  var doc = executeActionGet(reference);
  if (!doc.hasKey(targetLayers)) return 1;
  return doc.getList(targetLayers).count;
}

function selectLayerById(id) {
  try {
    var layerId = parseInt(id, 10);
    if (isNaN(layerId)) return "error";
    var descriptor = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putIdentifier(charID.Layer, layerId);
    descriptor.putReference(charID.Null, reference);
    descriptor.putBoolean(stringIDToTypeID("makeVisible"), false);
    executeAction(charID.Select, descriptor, DialogModes.NO);
    return "";
  } catch (selectError) {
    return "error";
  }
}

function startSelectionMonitoring() {
  var monitor = _hostState.selectionMonitor;
  if (monitor.callback) {
    app.removeNotifier("Slct", monitor.callback);
    monitor.callback = null;
  }
}

function stopSelectionMonitoring() {
  var monitor = _hostState.selectionMonitor;
  if (monitor.callback) {
    app.removeNotifier("Slct", monitor.callback);
    monitor.callback = null;
  }
  monitor.lastBoundsKey = null;
  monitor.lastBounds = null;
  monitor.multiWarnBounds = null;
}

function deselectDocumentSelection() {
  try {
    if (!documents.length) return "doc";
    try {
      _deselect();
    } catch (deselectError) {}
    var monitor = _hostState.selectionMonitor;
    monitor.lastBounds = null;
    monitor.lastBoundsKey = null;
    monitor.multiWarnBounds = null;
    return "";
  } catch (e) {
    return "error";
  }
}

function _getActiveHistoryIndex() {
  var reference = new ActionReference();
  reference.putEnumerated(stringIDToTypeID("historyState"), charID.Ordinal, charID.Target);
  var descriptor = executeActionGet(reference);
  return descriptor.getInteger(stringIDToTypeID("itemIndex")) - 1;
}

// Jumps back to just before the most recent "TyperTools Change" history
// state. A plain single-step undo lands on selection/wand noise (bubble
// detection creates several history states between two applies), so the
// undo must search the history by name instead.
function undoLastTyperChange() {
  try {
    if (!documents.length) return "doc";
    var doc = app.activeDocument;
    var states = doc.historyStates;
    if (!states.length) return "none";
    var activeIndex;
    try {
      activeIndex = _getActiveHistoryIndex();
    } catch (indexError) {
      activeIndex = states.length - 1;
    }
    if (activeIndex < 0) activeIndex = 0;
    if (activeIndex > states.length - 1) activeIndex = states.length - 1;
    // Same trap as the scans: the state being restored carries its own layer
    // selection, and undoing a shape must leave the typesetter on the layer he
    // is undoing, not on the one he happened to be on when that state was made.
    var selectedIds = [];
    try {
      selectedIds = _getSelectedLayerIds();
    } catch (selectionError) {}
    for (var search = activeIndex; search > 0; search--) {
      if (states[search].name === "TyperTools Change") {
        doc.activeHistoryState = states[search - 1];
        if (selectedIds.length) {
          try { _selectLayersById(selectedIds); } catch (restoreError) {}
        }
        return "";
      }
    }
    return "none";
  } catch (e) {
    return "error";
  }
}

// No live marquee at all: report it as its own state instead of the ambiguous
// noChange (which also means "same selection as before") so the panel can drop
// its stored selections, and forget the last bounds so re-selecting the very
// same outline afterwards counts as a new selection.
function _selectionClearedResult(monitor, shiftPressed) {
  monitor.lastBounds = null;
  monitor.lastBoundsKey = null;
  monitor.multiWarnBounds = null;
  return jamJSON.stringify({ cleared: true, shiftKey: shiftPressed });
}

function getTypeRDocumentKey() {
  return documents.length ? _hostState.documentSession + ":" + String(app.activeDocument.id) : "";
}

function getSelectionChanged() {
  var monitor = _hostState.selectionMonitor;
  var documentKey = getTypeRDocumentKey();
  if (monitor.documentKey !== documentKey) {
    monitor.documentKey = documentKey;
    monitor.lastBoundsKey = null;
    monitor.lastBounds = null;
    monitor.multiWarnBounds = null;
    return jamJSON.stringify({ documentChanged: true, documentKey: documentKey });
  }
  var result = jamJSON.parse(_getSelectionChanged());
  result.documentKey = documentKey;
  var selections = result.multiSelection || [];
  for (var i = 0; i < selections.length; i++) selections[i].documentKey = documentKey;
  return jamJSON.stringify(result);
}

function _getSelectionChanged() {
  try {
    var monitor = _hostState.selectionMonitor;
    var keyboardState = ScriptUI.environment && ScriptUI.environment.keyboardState;
    var shiftPressed = !!(keyboardState && keyboardState.shiftKey);

    var rawSelection = _getCurrentSelectionBounds();
    if (!rawSelection) {
      // An empty document usually means the user pressed Ctrl+D, and multi-bubble
      // is right to drop its stored batch. But the capture stores the marquee in a
      // temp channel and `Make Work Path` consumes the selection while tracing, so
      // an interrupted capture (Esc during a slow trace, an engine error, a crash)
      // leaves the marquee only in that channel. Finding it here is proof the
      // document was not deselected by the user: put it back rather than let the
      // panel read the wreckage as a deselect and wipe the batch.
      rawSelection = _recoverSelectionFromTempChannel();
      if (!rawSelection) {
        return _selectionClearedResult(monitor, shiftPressed);
      }
    }

    var selectionArray = Object.prototype.toString.call(rawSelection) === "[object Array]" ? rawSelection : [rawSelection];
    var groups = [];

    for (var i = 0; i < selectionArray.length; i++) {
      if (selectionArray[i].width < 2 && selectionArray[i].height < 2) continue;
      groups.push([selectionArray[i]]);
    }

    var changed = true;
    var margin = 30;
    while (changed) {
      changed = false;
      for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
        for (var compareIndex = groupIndex + 1; compareIndex < groups.length; compareIndex++) {
          var overlap = false;
          for (var groupSelectionIndex = 0; groupSelectionIndex < groups[groupIndex].length; groupSelectionIndex++) {
            for (var compareSelectionIndex = 0; compareSelectionIndex < groups[compareIndex].length; compareSelectionIndex++) {
              var firstBounds = groups[groupIndex][groupSelectionIndex];
              var secondBounds = groups[compareIndex][compareSelectionIndex];
              if (!(firstBounds.right + margin < secondBounds.left - margin ||
                firstBounds.left - margin > secondBounds.right + margin ||
                firstBounds.bottom + margin < secondBounds.top - margin ||
                firstBounds.top - margin > secondBounds.bottom + margin)) {
                overlap = true;
                break;
              }
            }
            if (overlap) break;
          }

          if (overlap) {
            groups[groupIndex] = groups[groupIndex].concat(groups[compareIndex]);
            groups.splice(compareIndex, 1);
            changed = true;
            break;
          }
        }
        if (changed) break;
      }
    }

    var merged = [];
    for (var mergedIndex = 0; mergedIndex < groups.length; mergedIndex++) {
      var group = groups[mergedIndex];
      var minLeft = 99999;
      var minTop = 99999;
      var maxRight = -99999;
      var maxBottom = -99999;
      for (var boundIndex = 0; boundIndex < group.length; boundIndex++) {
        if (group[boundIndex].left < minLeft) minLeft = group[boundIndex].left;
        if (group[boundIndex].top < minTop) minTop = group[boundIndex].top;
        if (group[boundIndex].right > maxRight) maxRight = group[boundIndex].right;
        if (group[boundIndex].bottom > maxBottom) maxBottom = group[boundIndex].bottom;
      }

      var width = maxRight - minLeft;
      var height = maxBottom - minTop;
      if (width > 2 && height > 2) {
        merged.push({
          top: minTop,
          left: minLeft,
          right: maxRight,
          bottom: maxBottom,
          width: width,
          height: height,
          xMid: (minLeft + maxRight) / 2,
          yMid: (minTop + maxBottom) / 2,
        });
      }
    }

    if (merged.length === 0) {
      return _selectionClearedResult(monitor, shiftPressed);
    }

    var isSame = false;
    if (monitor.lastBounds && merged.length === 1) {
      var diffTop = Math.abs(merged[0].top - monitor.lastBounds.top);
      var diffLeft = Math.abs(merged[0].left - monitor.lastBounds.left);
      var diffRight = Math.abs(merged[0].right - monitor.lastBounds.right);
      var diffBottom = Math.abs(merged[0].bottom - monitor.lastBounds.bottom);
      if (diffTop <= 5 && diffLeft <= 5 && diffRight <= 5 && diffBottom <= 5) {
        isSame = true;
      }
    }

    if (isSame && !shiftPressed) {
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // The union of a flagged Shift-add stays suppressed until the user makes
    // a fresh selection: capturing it once Shift is released would silently
    // create one bubble spanning several selections right after the panel
    // warned that this is not supported.
    if (monitor.multiWarnBounds && merged.length === 1 &&
      Math.abs(merged[0].top - monitor.multiWarnBounds.top) <= 5 &&
      Math.abs(merged[0].left - monitor.multiWarnBounds.left) <= 5 &&
      Math.abs(merged[0].right - monitor.multiWarnBounds.right) <= 5 &&
      Math.abs(merged[0].bottom - monitor.multiWarnBounds.bottom) <= 5) {
      return jamJSON.stringify({ noChange: true, shiftKey: shiftPressed });
    }

    // Adding a second outline never shrinks the selection: Photoshop reports a
    // single union rectangle that still contains the previously seen bounds.
    // Warn the panel instead of capturing that union as one giant bubble, and
    // remember it so it is not captured later either.
    // The test is geometric on purpose: the add can come from Shift, from the
    // "Add to selection" tool mode (no key at all), and ScriptUI's keyboard
    // state is unreliable across Photoshop versions and focus, so a union must
    // never depend on the reported Shift key to be caught.
    if (!isSame && monitor.lastBounds && merged.length === 1 &&
      merged[0].top <= monitor.lastBounds.top + 5 &&
      merged[0].left <= monitor.lastBounds.left + 5 &&
      merged[0].right >= monitor.lastBounds.right - 5 &&
      merged[0].bottom >= monitor.lastBounds.bottom - 5) {
      monitor.multiWarnBounds = merged[0];
      return jamJSON.stringify({ multipleSelections: true, shiftKey: shiftPressed });
    }
    monitor.multiWarnBounds = null;

    // Stored multi-bubble selections only retain bounds, so clean a newly
    // captured selection while its real outline is still available. The area
    // centroid is captured here for the same reason: once the marquee is gone
    // only a rectangle is left, and the centre of that rectangle is not the
    // centre of the balloon whenever it has a tail.
    var payloadBounds = merged;
    var payloadCentroid = null;
    if (merged.length === 1) {
      var captured = _withTemporaryHistory("TypeR Selection Capture", function () {
        var openedBounds = _getAdaptiveOpenedSelectionBounds(merged[0]);
        return { bounds: openedBounds, centroid: openedBounds ? openedBounds.centroid : null };
      });
      // A scan that could not run at all answers with an error, not a capture
      if (captured && !captured.error) {
        payloadBounds = [captured.bounds || merged[0]];
        payloadCentroid = captured.centroid || null;
      }
    }

    monitor.lastBounds = merged[0];
    monitor.lastBoundsKey = _selectionBoundsKey(merged[0]);

    var multiResults = [];
    for (var payloadIndex = 0; payloadIndex < payloadBounds.length; payloadIndex++) {
      var result = {
        shiftKey: shiftPressed,
        top: payloadBounds[payloadIndex].top,
        left: payloadBounds[payloadIndex].left,
        right: payloadBounds[payloadIndex].right,
        bottom: payloadBounds[payloadIndex].bottom,
        width: payloadBounds[payloadIndex].width,
        height: payloadBounds[payloadIndex].height,
        xMid: payloadBounds[payloadIndex].xMid,
        yMid: payloadBounds[payloadIndex].yMid,
      };
      // The key is left out when there is no centroid, never set to undefined:
      // `jamJSON.stringify` throws on an undefined value instead of dropping the
      // key the way `JSON.stringify` does, so one refused centroid turned the
      // whole capture into `{error: true}` and the panel — which drops errors
      // silently — behaved as if multi-bubble were switched off.
      if (payloadCentroid && payloadIndex === 0) {
        result.centroidX = payloadCentroid.x;
        result.centroidY = payloadCentroid.y;
      }
      multiResults.push(result);
    }

    return jamJSON.stringify({
      multiSelection: multiResults,
      shiftKey: shiftPressed,
      top: payloadBounds[0].top,
      left: payloadBounds[0].left,
      right: payloadBounds[0].right,
      bottom: payloadBounds[0].bottom,
      width: payloadBounds[0].width,
      height: payloadBounds[0].height,
      xMid: payloadBounds[0].xMid,
      yMid: payloadBounds[0].yMid,
    });
  } catch (e) {
    return jamJSON.stringify({ error: true, message: "getSelectionChanged inner error: " + e.message + " on line " + e.line, shiftKey: false });
  }
}

function _createTextLayersInStoredSelections() {
  var state = _hostState.createTextLayersInStoredSelections;
  if (!documents.length) {
    state.result = "doc";
    return;
  }
  var textSizeOverride = null;
  if (state.data.preserveActiveTextSize) {
    if (!_layerIsTextLayer()) {
      state.result = "sizeSource";
      return;
    }
    textSizeOverride = _getTextLayerSize();
  }

  var texts = state.data.texts || [];
  var styles = state.data.styles || [];

  if (texts.length === 0 || state.selections.length === 0) {
    state.result = "noSelection";
    return;
  }

  var maxCount = Math.min(texts.length, state.selections.length);
  var autoCenter = _autoCenterEnabled(state.data);
  var createdIds = [];

  for (var i = 0; i < maxCount; i++) {
    try {
      var textIndex = texts[i] ? i : texts.length - 1;
      var text = texts[textIndex] || "";
      // Runs must follow the same index as the text they describe. Unformatted
      // lines send null; borrowing another line's runs would paint its
      // bold/italic offsets onto unrelated text.
      var textRuns = state.data.richTextRuns ? state.data.richTextRuns[textIndex] : null;
      var baseStyle = styles[i] || styles[styles.length - 1] || null;
      var style = _ensureStyle(baseStyle);
      var selection = state.selections[i];

      if (!selection || typeof selection.width !== "number" || typeof selection.height !== "number") {
        state.result = "invalidSelection";
        return;
      }

      if (!text) continue;

      var dimensions = _calculateSelectionDimensions(selection, state.padding);
      if (!dimensions || isNaN(dimensions.width) || isNaN(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) {
        state.result = "invalidSelection";
        return;
      }

      // Create the text layer.
      var data = { text: text, style: style, direction: state.data.direction, richTextRuns: textRuns, textSizeOverride: textSizeOverride };
      dimensions = _punctuationOnlyBoxDimensions(dimensions, data);
      _createAndSetLayerText(data, dimensions.width, dimensions.height);

      var bounds = _getCurrentTextLayerBounds();
      var pointModes = state.data.pointModes || [];
      var pointText = pointModes[i] === undefined ? state.point : !!pointModes[i];
      if (pointText) {
        _changeToPointText();
      } else {
        _resizeTextBoxToContent(dimensions.width, bounds);
      }
      bounds = _getCurrentTextLayerBounds();

      // Position the layer inside the stored selection, on the centroid
      // captured with the marquee when it is available.
      var storedTarget = (isFinite(selection.centroidX) && isFinite(selection.centroidY))
        ? { x: Number(selection.centroidX), y: Number(selection.centroidY) }
        : null;
      _positionLayerWithinSelection(selection, bounds, 0, storedTarget);
      if (autoCenter) createdIds.push(_safeActiveLayerId());
    } catch (e) {
      state.result = "scriptError: " + (e && e.message ? e.message : e);
      return;
    }
  }

  if (autoCenter) {
    _autoCenterCreated(createdIds, {
      autoCenter: state.data.autoCenter,
      resizeTextBox: state.data.resizeTextBox,
      padding: state.padding,
    });
  }

  // Clear stored selections after use.
  state.selections = [];
  state.result = "";
}

function createTextLayersInStoredSelections(data, point) {
  var state = _hostState.createTextLayersInStoredSelections;
  state.data = data;
  state.point = point;
  state.padding = data.padding || 0;
  state.result = "";

  // Selections are passed directly from React.
  if (data && data.selections) {
    state.selections = data.selections;
  } else {
    state.selections = [];
  }

  if (!documents.length) return "doc";
  var documentKey = getTypeRDocumentKey();
  var count = state.selections.length;
  if (!count || !data.texts || data.texts.length !== count) return "noSelection";
  for (var index = 0; index < count; index++) {
    var selection = state.selections[index];
    if (!selection || !selection.documentKey || selection.documentKey !== documentKey) return "wrongDocument";
    if (!data.texts[index]) return "noText";
    var dimensions = _calculateSelectionDimensions(selection, state.padding);
    if (!dimensions || !isFinite(dimensions.width) || !isFinite(dimensions.height) || dimensions.width <= 0 || dimensions.height <= 0) return "invalidSelection";
  }
  var doc = app.activeDocument;
  var previousHistory = doc.activeHistoryState;
  try {
    doc.suspendHistory("TyperTools Multiple Paste", "_createTextLayersInStoredSelections()");
  } catch (error) {
    state.result = "scriptError: " + error.message;
  }
  if (state.result) {
    try { doc.activeHistoryState = previousHistory; }
    catch (rollbackError) { return "rollbackFailed"; }
  }
  return state.result;
}

function openFile(path, autoClose) {
  try {
    var file = File(path);
    if (!file.exists) throw new Error("File not found");
    var previousId = _hostState.lastOpenedDocId;
    var newDoc = app.open(file);
    if (autoClose && previousId !== null && previousId !== newDoc.id) {
      for (var i = 0; i < app.documents.length; i++) {
        var doc = app.documents[i];
        if (doc.id === previousId) {
          try { doc.close(SaveOptions.SAVECHANGES); }
          catch (saveError) { app.activeDocument = doc; throw saveError; }
          break;
        }
      }
    }
    app.activeDocument = newDoc;
    _hostState.lastOpenedDocId = newDoc.id;
    return jamJSON.stringify({ ok: true, path: path, documentKey: getTypeRDocumentKey() });
  } catch (error) {
    return jamJSON.stringify({ ok: false, path: path, error: String(error.message || error) });
  }
}

function deleteFolder(folderPath) {
  try {
    var folder = new Folder(folderPath);
    if (folder.exists) {
      // Recursively delete contents
      var files = folder.getFiles();
      for (var i = 0; i < files.length; i++) {
        if (files[i] instanceof Folder) {
          deleteFolder(files[i].fsName);
        } else {
          files[i].remove();
        }
      }
      folder.remove();
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

function openFolder(folderPath) {
  try {
    var os = $.os.toLowerCase();
    if (os.indexOf('win') !== -1) {
      // Windows: open Explorer
      app.system('explorer "' + folderPath.replace(/\//g, '\\') + '"');
    } else {
      // macOS: open Finder
      app.system('open "' + folderPath + '"');
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

/**
 * Collect font data from every text layer of a document (recursively).
 * Returns an array of {layerName, antiAlias, typeUnit, paragraphStyle, stroke, runs}.
 */
function _collectDocumentFontData(doc) {
  // Flat ActionManager iteration over layer indexes: no DOM tree walk and no
  // activeLayer switching (both are very slow on layer-heavy documents).
  // Groups (kind 7) and section bounders (kind 13) fail the kind === 3 check,
  // so recursion is unnecessary — the index space already covers nested layers.
  var results = [];
  var propId = charIDToTypeID("Prpr");
  var layerId = charIDToTypeID("Lyr ");
  var docId = charIDToTypeID("Dcmn");
  var ordinalId = charIDToTypeID("Ordn");
  var targetId = charIDToTypeID("Trgt");
  var nameId = charIDToTypeID("Nm  ");
  var layerKindId = stringIDToTypeID("layerKind");
  var layerCountId = stringIDToTypeID("numberOfLayers");
  var hasBackgroundId = stringIDToTypeID("hasBackgroundLayer");

  var getDocProperty = function (id) {
    var ref = new ActionReference();
    ref.putProperty(propId, id);
    ref.putEnumerated(docId, ordinalId, targetId);
    return executeActionGet(ref);
  };
  var getLayerProperty = function (id, index) {
    var ref = new ActionReference();
    ref.putProperty(propId, id);
    ref.putIndex(layerId, index);
    return executeActionGet(ref);
  };

  var layerCount = 0;
  try {
    layerCount = getDocProperty(layerCountId).getInteger(layerCountId);
  } catch (countError) {
    return results;
  }
  var hasBackground = false;
  try {
    hasBackground = getDocProperty(hasBackgroundId).getBoolean(hasBackgroundId);
  } catch (backgroundError) {}
  // Layer indexes are 0-based when a background layer exists, 1-based otherwise
  var firstIndex = hasBackground ? 0 : 1;
  var lastIndex = hasBackground ? layerCount - 1 : layerCount;

  var saveMeaningfulIds = jamEngine.meaningfulIds;
  var saveParseFriendly = jamEngine.parseFriendly;
  jamEngine.meaningfulIds = true;
  jamEngine.parseFriendly = true;
  try {
    for (var i = firstIndex; i <= lastIndex; i++) {
      try {
        if (getLayerProperty(layerKindId, i).getInteger(layerKindId) !== 3) continue;
        var resultObj = jamEngine.jsonGet([
          { "property": { "<property>": "textKey" } },
          { "layer": { "<index>": i } },
        ]);
        if (!("textKey" in resultObj)) continue;
        var textParams = jamText.fromLayerTextObject(resultObj["textKey"]);
        if (!textParams || !textParams.layerText) continue;
        var layerText = textParams.layerText;
        var ranges = layerText.textStyleRange || [];
        var runs = [];
        for (var r = 0; r < ranges.length; r++) {
          if (ranges[r] && ranges[r].textStyle) runs.push(ranges[r].textStyle);
        }
        if (!runs.length) continue;
        var paragraphStyle = null;
        if (layerText.paragraphStyleRange && layerText.paragraphStyleRange[0]) {
          paragraphStyle = layerText.paragraphStyleRange[0].paragraphStyle || null;
        }
        var stroke = null;
        try {
          stroke = _getLayerStroke(i);
        } catch (strokeError) {}
        var layerName = "";
        try {
          layerName = getLayerProperty(nameId, i).getString(nameId);
        } catch (nameError) {}
        results.push({
          layerName: layerName,
          antiAlias: layerText.antiAlias || "antiAliasSmooth",
          typeUnit: textParams.typeUnit || "pixelsUnit",
          paragraphStyle: paragraphStyle,
          stroke: stroke,
          runs: runs,
        });
      } catch (layerError) {}
    }
  } finally {
    jamEngine.meaningfulIds = saveMeaningfulIds;
    jamEngine.parseFriendly = saveParseFriendly;
  }
  return results;
}

/**
 * FontScanR: open a .psd file, extract font/style data from all its text
 * layers, then close it (unless it was already open in Photoshop).
 * Called once per file so the panel can show per-file progress.
 */
function scanPsdFonts(path) {
  if (!path) return jamJSON.stringify({ error: "badPath" });
  var file = new File(path);
  if (!file.exists) return jamJSON.stringify({ error: "notFound", file: path });
  var doc = null;
  var wasOpen = false;
  for (var i = 0; i < app.documents.length; i++) {
    try {
      // Unsaved documents throw on fullName access
      if (app.documents[i].fullName && app.documents[i].fullName.fsName === file.fsName) {
        doc = app.documents[i];
        wasOpen = true;
        break;
      }
    } catch (fullNameError) {}
  }
  var previousDoc = null;
  try {
    previousDoc = app.activeDocument;
  } catch (noDocError) {}
  // Suppress missing-font / text-update prompts: they block the scan and every
  // dialog Photoshop prepares slows the open down
  var saveDialogs = app.displayDialogs;
  app.displayDialogs = DialogModes.NO;
  try {
    if (doc) {
      app.activeDocument = doc;
    } else {
      doc = app.open(file);
    }
    var layers = _collectDocumentFontData(doc);
    if (!wasOpen) {
      doc.close(SaveOptions.DONOTSAVECHANGES);
      if (previousDoc) {
        try {
          app.activeDocument = previousDoc;
        } catch (restoreError) {}
      }
    }
    return jamJSON.stringify({ file: file.fsName, layers: layers });
  } catch (scanError) {
    if (doc && !wasOpen) {
      try {
        doc.close(SaveOptions.DONOTSAVECHANGES);
      } catch (closeError) {}
    }
    return jamJSON.stringify({ error: "scanFailed", file: path, message: scanError && scanError.message ? scanError.message : String(scanError) });
  } finally {
    app.displayDialogs = saveDialogs;
  }
}

function makeExecutable(filePath) {
  try {
    var os = $.os.toLowerCase();
    if (os.indexOf('mac') !== -1) {
      app.system('chmod +x "' + filePath + '"');
    }
    return 'OK';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

function launchInstaller(filePath) {
  try {
    var file = new File(filePath);
    if (!file.exists) {
      return 'ERROR: file not found';
    }
    // execute() opens the file with its default handler: a console window for
    // .cmd on Windows, Terminal for an executable .command on macOS
    var launched = file.execute();
    if (launched) return 'OK';
    var os = $.os.toLowerCase();
    if (os.indexOf('mac') !== -1) {
      app.system('open "' + file.fsName + '"');
      return 'OK';
    }
    return 'ERROR: execute failed';
  } catch (e) {
    return 'ERROR: ' + e.message;
  }
}

/* ========================================================= */
/* ======================= smart paste ===================== */
/* ========================================================= */
// The CEP half of the smart paste. The engine (app_src/oneClick) runs in the
// panel; these calls only talk to Photoshop:
//   smartPasteCapture  - the selection's outline (work path, rolled back),
//                        its bounds, its channel histograms
//   smartPasteMeasure  - text lines rendered at 64 px (rolled back)
//   smartPasteCommit   - cleanup fills and text layers, one history state
//   getHistorySnapshot - history state ids, for the undo sync
// uxp-src/host/smartPaste.js is the UXP counterpart (it runs the engine).

var _SMART_CLEAN_LAYER = "TypeR Clean";
var _SMART_HISTORY_NAME = "TyperTools Smart Paste";

function _smartUnit(desc, key, units) {
  var type = desc.getUnitDoubleType(key);
  var unit = "pixelsUnit";
  if (type === units.distance || type === units.points) unit = "distanceUnit";
  return { _unit: unit, _value: desc.getUnitDoubleValue(key) };
}

function _smartPathPoint(desc, units) {
  return {
    horizontal: _smartUnit(desc, charID.Horizontal, units),
    vertical: _smartUnit(desc, charID.Vertical, units)
  };
}

// The work path as the actionJSON UXP returns: pathContents > pathComponents
// > subpathListKey > points { anchor, forward, backward }
function _smartReadPath(reference, maxPoints) {
  var descriptor = executeActionGet(reference);
  var contentsKey = stringIDToTypeID("pathContents");
  if (!descriptor.hasKey(contentsKey)) return null;
  var contents = descriptor.getObjectValue(contentsKey);
  var componentList = contents.getList(stringIDToTypeID("pathComponents"));
  // An atlas has thousands of handles. Resolve invariant Action Manager
  // ids once per path, rather than crossing into Photoshop for every axis.
  var units = { distance: charIDToTypeID("#Rlt"), points: charIDToTypeID("#Pnt") };
  var subpathsKey = stringIDToTypeID("subpathListKey");
  var pointsKey = stringIDToTypeID("points");
  var anchorKey = stringIDToTypeID("anchor");
  var forwardKey = stringIDToTypeID("forward");
  var backwardKey = stringIDToTypeID("backward");
  var closedKey = stringIDToTypeID("closedSubpath");
  var components = [];
  var total = 0;
  for (var c = 0; c < componentList.count; c++) {
    var component = componentList.getObjectValue(c);
    var subList = component.getList(subpathsKey);
    var subpaths = [];
    for (var s = 0; s < subList.count; s++) {
      var sub = subList.getObjectValue(s);
      var pointList = sub.getList(pointsKey);
      var points = [];
      total += pointList.count;
      if (total > maxPoints) throw new Error("pathBudget");
      for (var p = 0; p < pointList.count; p++) {
        var pointDesc = pointList.getObjectValue(p);
        var point = { anchor: _smartPathPoint(pointDesc.getObjectValue(anchorKey), units) };
        if (pointDesc.hasKey(forwardKey)) point.forward = _smartPathPoint(pointDesc.getObjectValue(forwardKey), units);
        if (pointDesc.hasKey(backwardKey)) point.backward = _smartPathPoint(pointDesc.getObjectValue(backwardKey), units);
        points.push(point);
      }
      subpaths.push({ closedSubpath: sub.hasKey(closedKey) && sub.getBoolean(closedKey), points: points });
    }
    components.push({ subpathListKey: subpaths });
  }
  return { pathContents: { pathComponents: components } };
}

function _smartReadWorkPath() {
  var reference = new ActionReference();
  // 'WrPt' (not charID.WorkPath, 'WrkP') is the work path a get accepts
  reference.putProperty(charID.Path, charIDToTypeID("WrPt"));
  return _smartReadPath(reference, 4096);
}

// Reduce a vector atlas here, before crossing the CEP bridge. Sending all
// Bezier points costs far more than the few bounds the layout engine needs.
function _smartAtlasMetrics(path, count) {
  if (!(count >= 1 && count <= 24 && count === Math.floor(count))) return null;
  var page = _getDocumentPixelSize();
  var resolution = _getDocumentResolution();
  var cx = page.width / 2;
  var cy = page.height / 2;
  var rows = [];
  var i, c, s, p, k;
  for (i = 0; i < count; i++) rows.push({ left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  var components = path && path.pathContents && path.pathContents.pathComponents;
  if (!components) return null;
  var keys = ["anchor", "forward", "backward"];
  for (c = 0; c < components.length; c++) {
    var subs = components[c].subpathListKey || [];
    for (s = 0; s < subs.length; s++) {
      var points = subs[s].points || [];
      var left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
      for (p = 0; p < points.length; p++) {
        for (k = 0; k < keys.length; k++) {
          var point = points[p][keys[k]];
          if (!point || !point.horizontal || !point.vertical) continue;
          if (point.horizontal._unit !== "pixelsUnit" && point.horizontal._unit !== "distanceUnit") return null;
          if (point.vertical._unit !== "pixelsUnit" && point.vertical._unit !== "distanceUnit") return null;
          var x = point.horizontal._unit === "distanceUnit" ? (point.horizontal._value * resolution) / 72 : point.horizontal._value;
          var y = point.vertical._unit === "distanceUnit" ? (point.vertical._value * resolution) / 72 : point.vertical._value;
          if (!isFinite(x) || !isFinite(y)) return null;
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
      if (!isFinite(left)) continue;
      var row = Math.floor(((top + bottom) / 2 - cy + 128) / 256);
      if (row < 0 || row >= count || top < cy + row * 256 - 128 || bottom > cy + row * 256 + 128) return null;
      rows[row].left = Math.min(rows[row].left, left);
      rows[row].right = Math.max(rows[row].right, right);
      rows[row].top = Math.min(rows[row].top, top);
      rows[row].bottom = Math.max(rows[row].bottom, bottom);
    }
  }
  for (i = 0; i < rows.length; i++) {
    var bounds = rows[i];
    if (!(bounds.right > bounds.left && bounds.bottom > bounds.top)) return null;
    rows[i] = { left: (bounds.left - cx - 1) / 64, right: (bounds.right - cx + 1) / 64,
      top: (bounds.top - (cy + i * 256) - 1) / 64, bottom: (bounds.bottom - (cy + i * 256) + 1) / 64 };
  }
  return rows;
}

// Document component channels already describe the visible composite, even
// when the active layer is empty or translucent. Avoid stamping the whole
// page just to read the same histograms.
function _smartReadChannelHistograms() {
  var out = [];
  var channels = app.activeDocument.componentChannels;
  for (var i = 0; i < channels.length && i < 3; i++) out.push(channels[i].histogram);
  return out;
}

function _smartSelectionHistograms() {
  try {
    return _smartReadChannelHistograms();
  } catch (readError) {}
  // Preserve the older-host fallback if a composite is not readable yet.
  try {
    var stamp = new ActionDescriptor();
    stamp.putBoolean(charIDToTypeID("Dplc"), true);
    executeAction(charIDToTypeID("MrgV"), stamp, DialogModes.NO);
    return _smartReadChannelHistograms();
  } catch (histogramError) {
    return [];
  }
}

function smartPasteCapture(data) {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  if (data && data.trigger && data.trigger.documentKey && data.trigger.documentKey !== getTypeRDocumentKey()) return jamJSON.stringify({ error: "doc" });
  var selection = _getCurrentSelectionBounds();
  if (!selection || selection.width < 8 || selection.height < 8) return jamJSON.stringify({ error: "noSelection" });
  var doc = app.activeDocument;
  var size = _getDocumentPixelSize();
  var result = {
    documentId: doc.id,
    width: size.width,
    height: size.height,
    resolution: _getDocumentResolution(),
    selectionBounds: { left: selection.left, top: selection.top, right: selection.right, bottom: selection.bottom },
    histograms: [],
    rawPath: null,
    activeTextSize: null
  };
  if (data && data.keepSize) {
    try {
      if (_layerIsTextLayer()) result.activeTextSize = _getTextLayerSize();
    } catch (sizeError) {}
  }
  var needsPath = !data || !data.trigger || data.trigger.source !== "rectangle";
  var read = _withTemporaryHistory("TypeR Read Bubble", function () {
    // Histograms first: making the work path consumes the selection
    var histograms = _smartSelectionHistograms();
    var path = null;
    if (needsPath) {
      _makeWorkPathFromSelection(2.0);
      path = _smartReadWorkPath();
    }
    return { path: path, histograms: histograms };
  }, { discardRedo: true });
  if (!read || read.error) return jamJSON.stringify({ error: "shape" });
  if (needsPath && !read.path) return jamJSON.stringify({ error: "shape" });
  result.rawPath = read.path;
  result.histograms = read.histograms || [];
  return jamJSON.stringify(result);
}

function _smartCreateMeasureGroup() {
  var reference = new ActionReference();
  reference.putClass(stringIDToTypeID("layerSection"));
  var descriptor = new ActionDescriptor();
  descriptor.putReference(charID.Null, reference);
  var using = new ActionDescriptor();
  using.putUnitDouble(stringIDToTypeID("opacity"), stringIDToTypeID("percentUnit"), 0);
  descriptor.putObject(stringIDToTypeID("using"), stringIDToTypeID("layerSection"), using);
  executeAction(charID.Make, descriptor, DialogModes.NO);
  var group = app.activeDocument.activeLayer;
  // Opacity is honoured during make on PS 2019 (visible:false is ignored),
  // so temporary text is invisible without a second hide command.
  if (group.opacity !== 0) group.visible = false;
  return group;
}

function smartPasteMeasure(data) {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  var requests = (data && data.requests) || [];
  if (!requests.length) return jamJSON.stringify([]);
  var measured = _withTemporaryHistory("TypeR text measurement", function () {
    var replies = [];
    var staging = false;
    var group = _smartCreateMeasureGroup();
    try {
      // Make every test layer inside an already invisible group.
      for (var i = 0; i < requests.length; i++) {
        var request = requests[i];
        var params = request.params;
        if (request.kind === "atlas" && params.typeUnit === "pixelsUnit") {
          // The shared atlas generator expresses its 256px row advance in
          // points. JAM honours typeUnit for leading too; pixel styles need
          // that advance converted back to pixels on non-72dpi documents.
          params = _clone(params);
          var ranges = params.layerText.textStyleRange || [];
          var scale = _getDocumentResolution() / 72;
          for (var r = 0; r < ranges.length; r++) {
            var style = ranges[r].textStyle;
            if (style && typeof style.leading === "number") style.leading *= scale;
          }
        }
        var using = jamText.toLayerTextObject(params);
        if (!staging) {
          executeAction(charID.Make, jamEngine.jsonToActionDescriptor({
            target: ["<reference>", [["textLayer", ["<class>", null]]]],
            using: using
          }), DialogModes.NO);
          staging = true;
        } else {
          // We own the staging layer: avoid setLayerText's full textKey
          // read/JSON conversion before every candidate's update.
          executeAction(charID.Set, jamEngine.jsonToActionDescriptor({
            target: ["<reference>", [["layer", ["<enumerated>", ["ordinal", "targetEnum"]]]]],
            to: using
          }), DialogModes.NO);
        }
        if (request.kind === "atlas") {
          try {
            executeAction(charID.Make, jamEngine.jsonToActionDescriptor({
              target: ["<reference>", [["contentLayer", ["<class>", null]]]],
              using: ["<reference>", [["textLayer", ["<enumerated>", ["ordinal", "targetEnum"]]]]]
            }), DialogModes.NO);
            var reference = new ActionReference();
            reference.putEnumerated(charID.Path, charID.Path, stringIDToTypeID("vectorMask"));
            replies.push({ metrics: _smartAtlasMetrics(_smartReadPath(reference, 65536), request.count) });
          } catch (atlasError) {
            // The engine retries unsupported fonts/conversions individually.
            replies.push(null);
          }
          var measuredLayer = app.activeDocument.activeLayer;
          if (measuredLayer.parent !== group) throw new Error("measureLayer");
          // The final group removal below also deletes its last atlas.
          // Only switch back to the group when another request follows.
          if (i + 1 < requests.length) {
            measuredLayer.remove();
            app.activeDocument.activeLayer = group;
          }
          staging = false;
        } else {
          var box = _currentLayerBox();
          replies.push(box ? { bounds: { left: box.left, top: box.top, right: box.right, bottom: box.bottom } } : null);
        }
      }
      return { replies: replies };
    } finally {
      // Remove our objects before history refresh, including the selected
      // vector path; rollback still restores the user's selection/history.
      group.remove();
    }
  }, { discardRedo: true });
  if (!measured || measured.error || !measured.replies) return jamJSON.stringify({ error: "measure" });
  return jamJSON.stringify(measured.replies);
}

function _smartSelectPolygon(polygon) {
  var desc = new ActionDescriptor();
  var reference = new ActionReference();
  reference.putProperty(charID.Channel, charID.FrameSelect);
  desc.putReference(charID.Null, reference);
  var shape = new ActionDescriptor();
  var points = new ActionList();
  for (var i = 0; i < polygon.length; i++) {
    var point = new ActionDescriptor();
    point.putUnitDouble(charID.Horizontal, charID.PixelUnit, polygon[i][0]);
    point.putUnitDouble(charID.Vertical, charID.PixelUnit, polygon[i][1]);
    points.putObject(charIDToTypeID("Pnt "), point);
  }
  shape.putList(charIDToTypeID("Pts "), points);
  desc.putObject(charID.To, charIDToTypeID("Plgn"), shape);
  executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
}

// The document's "TypeR Clean" layer, created above the topmost pixel layer
// (under every text layer) the first time
function _smartCleanLayer() {
  var doc = app.activeDocument;
  var layers = doc.layers;
  var anchor = null;
  for (var i = 0; i < layers.length; i++) {
    var layer = layers[i];
    if (layer.typename !== "ArtLayer") continue;
    if (layer.name === _SMART_CLEAN_LAYER && layer.kind === LayerKind.NORMAL) return layer;
    if (!anchor && layer.kind !== LayerKind.TEXT) anchor = layer;
  }
  if (anchor) doc.activeLayer = anchor;
  var created = doc.artLayers.add();
  created.name = _SMART_CLEAN_LAYER;
  return created;
}

function _smartPaintCleanup(plan) {
  var doc = app.activeDocument;
  doc.activeLayer = _smartCleanLayer();
  _smartSelectPolygon(plan.cleanupPolygon);
  if (plan.cleanupInset > 0) doc.selection.contract(new UnitValue(plan.cleanupInset, "px"));
  var rgb = plan.fillRGB || { red: 255, green: 255, blue: 255 };
  var color = new SolidColor();
  color.rgb.red = rgb.red;
  color.rgb.green = rgb.green;
  color.rgb.blue = rgb.blue;
  doc.selection.fill(color, ColorBlendMode.NORMAL, 100, false);
  doc.selection.deselect();
}

function _smartMakeText(params) {
  try {
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(params)
    });
  } catch (makeError) {
    // Older hosts reject directionType/textComposerEngine in a make: strip
    // them, retry, then set the direction on the new layer
    var ranges = params.layerText.paragraphStyleRange || [];
    var direction = null;
    for (var i = 0; i < ranges.length; i++) {
      if (!ranges[i].paragraphStyle) continue;
      if (ranges[i].paragraphStyle.directionType) {
        direction = ranges[i].paragraphStyle.directionType === "dirRightToLeft" ? "rtl" : "ltr";
      }
      delete ranges[i].paragraphStyle.directionType;
      delete ranges[i].paragraphStyle.textComposerEngine;
    }
    jamEngine.jsonPlay("make", {
      target: ["<reference>", [["textLayer", ["<class>", null]]]],
      using: jamText.toLayerTextObject(params)
    });
    _applyTextDirection(direction);
  }
}

function _smartPlaceText(session, pointText) {
  var params = session.text.params;
  _smartMakeText(params);
  _raiseNewTextLayer();
  var ranges = params.layerText.textStyleRange;
  if (ranges && ranges[0]) _applyMiddleEast(ranges[0].textStyle);
  if (!pointText) {
    // Paragraph text keeps the composed lines; point text otherwise
    var before = _currentLayerBox();
    _changeToBoxText();
    var after = _currentLayerBox();
    if (before && after) {
      if (Math.abs(before.width - after.width) > 1.5 || Math.abs(before.height - after.height) > 1.5) {
        _changeToPointText();
        var back = _currentLayerBox();
        if (back) _moveLayer(before.left - back.left, before.top - back.top);
      } else if (Math.abs(before.left - after.left) > 0.01 || Math.abs(before.top - after.top) > 0.01) {
        _moveLayer(before.left - after.left, before.top - after.top);
      }
    }
  }
  if (session.text.stroke) _setLayerStroke(session.text.stroke);
  return _getActiveLayerId();
}

function _smartPasteCommitRun() {
  var state = _hostState.smartCommit;
  var sessions = state.data.sessions || [];
  try {
    for (var i = 0; i < sessions.length; i++) {
      var plan = sessions[i].plan;
      if (plan.autoClean && plan.cleanupPolygon) {
        // Back on the user's layer afterwards: it decides the text's folder
        var activeId = _safeActiveLayerId();
        _smartPaintCleanup(plan);
        if (activeId !== null) _selectLayerById(activeId);
      }
      try { app.activeDocument.selection.deselect(); } catch (deselectError) {}
      var id = _smartPlaceText(sessions[i], !!state.data.pointText);
      state.layerIds.push(id);
    }
  } catch (runError) {
    state.error = String(runError && runError.message ? runError.message : runError);
  }
}

// A history state's id (falls back on index and name on hosts without ids)
function _smartHistoryKey(descriptor) {
  var idKey = stringIDToTypeID("ID");
  if (descriptor.hasKey(idKey)) return descriptor.getInteger(idKey);
  var nameKey = charIDToTypeID("Nm  ");
  var name = descriptor.hasKey(nameKey) ? descriptor.getString(nameKey) : "";
  return "i" + descriptor.getInteger(stringIDToTypeID("itemIndex")) + ":" + name;
}

function _smartCurrentHistoryKey() {
  var reference = new ActionReference();
  reference.putEnumerated(stringIDToTypeID("historyState"), charID.Ordinal, charID.Target);
  return _smartHistoryKey(executeActionGet(reference));
}

function smartPasteCommit(data) {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  var doc = app.activeDocument;
  if (!data || String(doc.id) !== String(data.documentId)) return jamJSON.stringify({ error: "doc" });
  var before = null;
  try { before = _smartCurrentHistoryKey(); } catch (beforeError) {}
  var count = doc.historyStates.length;
  _hostState.smartCommit = { data: data, layerIds: [], error: null };
  try {
    doc.suspendHistory(_SMART_HISTORY_NAME, "_smartPasteCommitRun()");
  } catch (suspendError) {
    _hostState.smartCommit.error = String(suspendError);
  }
  var state = _hostState.smartCommit;
  _hostState.smartCommit = null;
  if (state.error) {
    // Undo whatever the failed run left, then let the panel fall back
    try {
      var states = doc.historyStates;
      if (states.length > count && states[states.length - 1].name === _SMART_HISTORY_NAME) {
        doc.activeHistoryState = states[states.length - 2];
      }
    } catch (rollbackError) {}
    return jamJSON.stringify({ error: "commit", message: state.error });
  }
  var after = null;
  try { after = _smartCurrentHistoryKey(); } catch (afterError) {}
  return jamJSON.stringify({ layerIds: state.layerIds, history: { documentId: doc.id, before: before, after: after } });
}

function getHistorySnapshot() {
  if (!app.documents.length) return jamJSON.stringify(null);
  try {
    var doc = app.activeDocument;
    var count = doc.historyStates.length;
    var states = [];
    for (var i = 1; i <= count; i++) {
      var reference = new ActionReference();
      reference.putIndex(stringIDToTypeID("historyState"), i);
      states.push(_smartHistoryKey(executeActionGet(reference)));
    }
    return jamJSON.stringify({ documentId: doc.id, current: _smartCurrentHistoryKey(), states: states });
  } catch (snapshotError) {
    return jamJSON.stringify(null);
  }
}

// Go back to a history state (a paste the user wants redone in two chambers)
function restoreHistoryState(data) {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  var doc = app.activeDocument;
  if (!data || String(doc.id) !== String(data.documentId)) return jamJSON.stringify({ error: "doc" });
  try {
    var count = doc.historyStates.length;
    for (var i = 1; i <= count; i++) {
      var reference = new ActionReference();
      reference.putIndex(stringIDToTypeID("historyState"), i);
      if (String(_smartHistoryKey(executeActionGet(reference))) === String(data.state)) {
        doc.activeHistoryState = doc.historyStates[i - 1];
        return jamJSON.stringify({ ok: true });
      }
    }
  } catch (restoreError) {
    return jamJSON.stringify({ error: "history" });
  }
  return jamJSON.stringify({ error: "history" });
}

// Select again what a stored multi-bubble selection remembers: the Magic
// Wand click (with its options) or the rectangle
function replaySelectionTrigger(trigger) {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  if (!trigger) return jamJSON.stringify({ error: "trigger" });
  if (trigger.documentKey && trigger.documentKey !== getTypeRDocumentKey()) return jamJSON.stringify({ error: "doc" });
  try {
    var desc = new ActionDescriptor();
    var reference = new ActionReference();
    reference.putProperty(charID.Channel, charID.FrameSelect);
    desc.putReference(charID.Null, reference);
    if (trigger.source === "wand") {
      var scale = trigger.unit === "distanceUnit" ? _getDocumentResolution() / 72 : 1;
      var point = new ActionDescriptor();
      point.putUnitDouble(charID.Horizontal, charID.PixelUnit, trigger.x * scale);
      point.putUnitDouble(charID.Vertical, charID.PixelUnit, trigger.y * scale);
      desc.putObject(charID.To, charIDToTypeID("Pnt "), point);
      var options = trigger.options || {};
      desc.putInteger(charIDToTypeID("Tlrn"), typeof options.tolerance === "number" ? options.tolerance : 32);
      desc.putBoolean(charIDToTypeID("AntA"), options.antiAlias !== false);
      if (options.contiguous === false) desc.putBoolean(charIDToTypeID("Cntg"), false);
      if (options.merged === true) desc.putBoolean(stringIDToTypeID("merged"), true);
    } else if (trigger.source === "rectangle" && typeof trigger.left === "number") {
      var rect = new ActionDescriptor();
      rect.putUnitDouble(charIDToTypeID("Top "), charID.PixelUnit, trigger.top);
      rect.putUnitDouble(charIDToTypeID("Left"), charID.PixelUnit, trigger.left);
      rect.putUnitDouble(charIDToTypeID("Btom"), charID.PixelUnit, trigger.bottom);
      rect.putUnitDouble(charIDToTypeID("Rght"), charID.PixelUnit, trigger.right);
      desc.putObject(charID.To, charIDToTypeID("Rctn"), rect);
    } else {
      return jamJSON.stringify({ error: "trigger" });
    }
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
    return jamJSON.stringify({ ok: true });
  } catch (replayError) {
    return jamJSON.stringify({ error: "replay" });
  }
}

// Paste on click needs the Magic Wand's "Sample All Layers": without it a click
// reads the active layer, often the text just pasted, instead of the page.
// Turns it on and answers whether it was off. WndS is the option's key.
function ensureWandSampleAll() {
  try {
    var reference = new ActionReference();
    reference.putEnumerated(charIDToTypeID("capp"), charID.Ordinal, charID.Target);
    var application = executeActionGet(reference);
    if (typeIDToStringID(application.getEnumerationType(stringIDToTypeID("tool"))) !== "magicWandTool") return jamJSON.stringify({ wasOff: false });
    var sampleAll = charIDToTypeID("WndS");
    var current = application.getObjectValue(stringIDToTypeID("currentToolOptions"));
    if (!current.hasKey(sampleAll) || current.getBoolean(sampleAll)) return jamJSON.stringify({ wasOff: false });
    var tool = new ActionReference();
    tool.putClass(stringIDToTypeID("magicWandTool"));
    var options = new ActionDescriptor();
    options.putBoolean(sampleAll, true);
    var desc = new ActionDescriptor();
    desc.putReference(charID.Null, tool);
    desc.putObject(charID.To, stringIDToTypeID("currentToolOptions"), options);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
    return jamJSON.stringify({ wasOff: true });
  } catch (sampleAllError) {
    return jamJSON.stringify({ error: "sampleAll" });
  }
}

// Paste on click when Photoshop sends a selection event without its
// descriptor (some CEP hosts): the current tool and the selection bounds
function smartPasteSelectionProbe() {
  if (!app.documents.length) return jamJSON.stringify({ error: "doc" });
  var tool = "";
  try {
    tool = String(app.currentTool || "");
  } catch (toolError) {
    try {
      var reference = new ActionReference();
      reference.putProperty(charIDToTypeID("Prpr"), stringIDToTypeID("tool"));
      reference.putEnumerated(charIDToTypeID("capp"), charID.Ordinal, charID.Target);
      var descriptor = executeActionGet(reference);
      tool = typeIDToStringID(descriptor.getEnumerationType(stringIDToTypeID("tool")));
    } catch (amError) {
      tool = "";
    }
  }
  var selection = null;
  try { selection = _getCurrentSelectionBounds(); } catch (selectionError) {}
  return jamJSON.stringify({
    documentId: app.activeDocument.id,
    tool: tool,
    bounds: selection ? { left: selection.left, top: selection.top, right: selection.right, bottom: selection.bottom } : null
  });
}
