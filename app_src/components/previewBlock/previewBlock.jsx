import "./previewBlock.scss";

import React from "react";
import { FiArrowRightCircle, FiChevronLeft, FiChevronRight, FiChevronsRight, FiPlay, FiRefreshCw, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown, FiAlertTriangle, FiRotateCcw, FiX } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";
import { FaMagic } from "react-icons/fa";

import { csInterface, locale, setActiveLayerText, setLayerTextFast, getCurrentSelection, getSelectionBoundsHash, addPhotoshopEventListener, hasReceivedPhotoshopEvents, isPhotoshopSelectEvent, isHostActionPending, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, deselectDocument, undoLastTextChange, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { buildStoredSelectionPayload, getScaledStyle } from "../../textLayerPayload";
import { generateTextShapeRVariants, visibleWidth } from "../../textShapeR";
import TextShapeRFitPreview from "../textShapeRFitPreview";

const normalizeLayerText = (text) => String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const getLayerSourceKey = (source) => JSON.stringify({
  layerId: source.layerId || null,
  text: source.text,
  textStyleRange: source.style?.textProps?.layerText?.textStyleRange || null,
  paragraphStyleRange: source.style?.textProps?.layerText?.paragraphStyleRange || null,
  stroke: source.style?.stroke || null,
});

const getActiveTextLayerSource = (callback) => {
  csInterface.evalScript("getActiveLayerText()", (result) => {
    try {
      const data = JSON.parse(result || "{}");
      if (!data?.textProps?.layerText) {
        callback(null);
        return;
      }
      const source = {
        text: normalizeLayerText(data.textProps.layerText.textKey),
        layerId: typeof data.layerId === "number" ? data.layerId : null,
        bounds: data.bounds || null,
        style: {
          textProps: data.textProps,
          stroke: data.stroke || null,
        },
      };
      callback({ ...source, key: getLayerSourceKey(source) });
    } catch (error) {
      callback(null);
    }
  });
};

const PreviewBlock = React.memo(function PreviewBlock() {
  const context = useContext();
  const uiVisible = context.state.uiLayout?.visible || {};
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const [inlineLayerSource, setInlineLayerSource] = React.useState({
    text: "",
    style: null,
    key: "",
    layerId: null,
    loading: false,
    error: "",
  });
  const inlineSourceKey = React.useRef("");
  const inlineLayerIdRef = React.useRef(null);
  const inlineSourcePending = React.useRef(false);
  const inlineEventDebounce = React.useRef(null);
  const inlineLastRefreshAt = React.useRef(0);
  const inlineShapePending = React.useRef(false);
  const inlineShapeKey = React.useRef("");
  const inlineShapeSettle = React.useRef({ hash: "", timer: null });
  const [inlineSelectionShape, setInlineSelectionShape] = React.useState(null);
  const batchOrderRef = React.useRef([]);
  const batchPending = React.useRef(false);
  const batchQueued = React.useRef(false);
  const batchRunRef = React.useRef(null);
  const batchSelectionRef = React.useRef([]);
  const [batchSelection, setBatchSelection] = React.useState([]);
  const [batchRun, setBatchRun] = React.useState(null);
  batchRunRef.current = batchRun;
  batchSelectionRef.current = batchSelection;
  const inlineTextStyle = inlineLayerSource.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const inlineStyleObject = getStyleObject(inlineTextStyle);
  const markdownEnabled = context.state.interpretMarkdown !== false;
  // Calibrate measure units against the layer's real rendered pixels: the
  // current text and its bounds give px-per-unit and px-per-line, which lets
  // the generator check candidates against the bubble in absolute pixels
  const inlineCalibration = React.useMemo(() => {
    const bounds = inlineLayerSource.bounds;
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) return null;
    const lines = String(inlineLayerSource.text || "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    const maxUnits = Math.max(...lines.map((line) => visibleWidth(line)));
    if (!(maxUnits > 0)) return null;
    return {
      unitPx: bounds.width / maxUnits,
      // A single line's bounds measure glyph extent, not leading: pad it so
      // multi-line candidates aren't credited with less height than they use
      linePx: lines.length === 1 ? bounds.height * 1.2 : bounds.height / lines.length,
    };
  }, [inlineLayerSource.text, inlineLayerSource.bounds]);
  const inlineTextShapeRVariants = React.useMemo(
    () => generateTextShapeRVariants(inlineLayerSource.text, {
      limit: 12,
      allowHyphenation: true,
      profile: "balanced",
      shapeProfile: inlineSelectionShape?.profile || null,
      width: inlineSelectionShape?.width,
      height: inlineSelectionShape?.height,
      calibration: inlineCalibration,
    }),
    [inlineLayerSource.text, inlineSelectionShape, inlineCalibration]
  );
  const [inlineVariantPage, setInlineVariantPage] = React.useState(0);
  const inlinePageSize = 3;
  const inlinePageCount = Math.max(1, Math.ceil(inlineTextShapeRVariants.length / inlinePageSize));
  const visibleInlineVariants = inlineTextShapeRVariants.slice(
    inlineVariantPage * inlinePageSize,
    inlineVariantPage * inlinePageSize + inlinePageSize
  );
  const [applyingTextShapeRId, setApplyingTextShapeRId] = React.useState(null);
  const renderMarkdownText = React.useCallback((text) => {
    if (!markdownEnabled) return text;
    const parsed = parseMarkdownRuns(text || "");
    if (!parsed.hasFormatting) {
      return parsed.text;
    }
    return parsed.runs.map((run, index) => {
      const runStyle = {};
      if (run.bold) runStyle.fontWeight = "bold";
      if (run.italic) runStyle.fontStyle = "italic";
      return (
        <span key={`md-${index}`} style={runStyle}>
          {run.text}
        </span>
      );
    });
  }, [markdownEnabled]);

  const selectionCheckInterval = React.useRef(null);
  const selectionCheckPending = React.useRef(false);
  const [shiftSelectionWarning, setShiftSelectionWarning] = React.useState(false);
  const shiftTipTimeout = React.useRef(null);
  const [textShapeRUndoDepth, setTextShapeRUndoDepth] = React.useState(0);
  const [showClearAllTip, setShowClearAllTip] = React.useState(false);
  const clearAllTipTimeout = React.useRef(null);
  const [clearAllTipShown, setClearAllTipShown] = React.useState(false);

  const refreshInlineLayerSource = React.useCallback((showLoading = false) => {
    if (inlineSourcePending.current) return;
    inlineSourcePending.current = true;
    inlineLastRefreshAt.current = Date.now();
    setInlineLayerSource((current) => (
      showLoading || (!current.text && !current.error) ? { ...current, loading: true, error: "" } : current
    ));
    getActiveTextLayerSource((source) => {
      inlineSourcePending.current = false;
      if (!source?.text) {
        inlineSourceKey.current = "";
        inlineLayerIdRef.current = null;
        setInlineLayerSource((current) => {
          const error = locale.textShapeRLayerNoText || "Select a Photoshop text layer first.";
          if (!current.text && current.error === error && !current.loading) return current;
          return { text: "", style: null, key: "", layerId: null, loading: false, error };
        });
        return;
      }
      inlineLayerIdRef.current = source.layerId;
      if (source.key === inlineSourceKey.current) {
        setInlineLayerSource((current) => (current.loading || current.error ? { ...current, loading: false, error: "" } : current));
        return;
      }
      inlineSourceKey.current = source.key;
      setInlineLayerSource({
        text: source.text,
        style: source.style,
        key: source.key,
        layerId: source.layerId,
        bounds: source.bounds,
        loading: false,
        error: "",
      });
    });
  }, []);

  const bubbleAware = context.state.textShapeRBubbleAware === true;

  const clearInlineShapeSettle = React.useCallback(() => {
    if (inlineShapeSettle.current.timer) {
      clearTimeout(inlineShapeSettle.current.timer);
      inlineShapeSettle.current.timer = null;
    }
    inlineShapeSettle.current.hash = "";
  }, []);

  const refreshInlineSelectionShape = React.useCallback((force = false) => {
    if (inlineShapePending.current) return;
    if (force) inlineShapeKey.current = "";
    inlineShapePending.current = true;
    getCurrentSelection((selection) => {
      if (selection && selection.width && selection.height) {
        // A manual selection always wins over the automatic bubble detection
        const boundsHash = `selection:${getSelectionBoundsHash(selection)}`;
        if (boundsHash === inlineShapeKey.current) {
          inlineShapePending.current = false;
          return;
        }
        // The outline sampling runs 21 selection ops on Photoshop's main
        // thread: firing it on every bounds change would freeze the canvas
        // mid-drag. Wait until two consecutive reads agree (the user let go
        // of the mouse) before paying for it.
        if (!force && boundsHash !== inlineShapeSettle.current.hash) {
          inlineShapeSettle.current.hash = boundsHash;
          if (inlineShapeSettle.current.timer) clearTimeout(inlineShapeSettle.current.timer);
          inlineShapeSettle.current.timer = setTimeout(() => {
            inlineShapeSettle.current.timer = null;
            refreshInlineSelectionShape();
          }, 350);
          inlineShapePending.current = false;
          return;
        }
        clearInlineShapeSettle();
        csInterface.evalScript(`getCurrentSelectionShape(${JSON.stringify({ samples: 21 })})`, (result) => {
          inlineShapePending.current = false;
          try {
            const data = JSON.parse(result || "{}");
            if (!data || data.error || !data.bounds) return;
            inlineShapeKey.current = boundsHash;
            setInlineSelectionShape({
              profile: data,
              width: data.bounds.width,
              height: data.bounds.height,
              source: "selection",
            });
          } catch (error) {}
        });
        return;
      }

      // No manual selection anymore: forget any pending settle re-check
      clearInlineShapeSettle();

      // While several layers are selected (batch being lined up) the wand
      // would fire on an ambiguous target and churn the document: hold off
      const multiSelecting = batchSelectionRef.current.length > 1 && !batchRunRef.current;
      if (!bubbleAware || !inlineSourceKey.current || multiSelecting) {
        inlineShapePending.current = false;
        inlineShapeKey.current = "";
        setInlineSelectionShape((current) => (current ? null : current));
        return;
      }

      // Bubble-aware mode: magic-wand the bubble around the active text layer
      // (same detection as align-without-selection). Cached per layer ID, not
      // per layer content: the bubble doesn't move when the text changes, so
      // applying a shape must not pay for a new wand scan.
      const bubbleKey = `bubble:${inlineLayerIdRef.current != null ? inlineLayerIdRef.current : inlineSourceKey.current}`;
      if (bubbleKey === inlineShapeKey.current) {
        inlineShapePending.current = false;
        return;
      }
      csInterface.evalScript(`getActiveLayerBubbleShape(${JSON.stringify({ samples: 21, tolerance: 20 })})`, (result) => {
        inlineShapePending.current = false;
        try {
          const data = JSON.parse(result || "{}");
          if (data && data.error === "hasSelection") return;
          // Cache failures too: retrying the wand on every poll would spam
          // the document with temporary selections
          inlineShapeKey.current = bubbleKey;
          if (!data || data.error || !data.bounds) {
            setInlineSelectionShape((current) => (current ? null : current));
            return;
          }
          setInlineSelectionShape({
            profile: data,
            width: data.bounds.width,
            height: data.bounds.height,
            source: "bubble",
          });
        } catch (error) {}
      });
    });
  }, [bubbleAware, clearInlineShapeSettle]);

  // Batch mode: the user multi-selects text layers, then chains shapes one
  // layer at a time. Photoshop only reports stacking order, so the click
  // order is reconstructed by diffing the selection on every select event.
  const refreshBatchSelection = React.useCallback(() => {
    // While a batch runs the panel drives the layer selection itself
    if (batchRunRef.current) return;
    if (batchPending.current) {
      // A click landed while a diff was in flight: queue one trailing run so
      // the final selection state is never missed
      batchQueued.current = true;
      return;
    }
    batchPending.current = true;
    csInterface.evalScript("getSelectedTextLayers()", (result) => {
      batchPending.current = false;
      let ids = null;
      try {
        const data = JSON.parse(result || "{}");
        if (!data.error) {
          ids = (data.layers || []).map((layer) => layer.id).filter((id) => typeof id === "number");
        }
      } catch (error) {
        ids = null;
      }
      if (ids) {
        const kept = batchOrderRef.current.filter((id) => ids.indexOf(id) !== -1);
        const added = ids.filter((id) => kept.indexOf(id) === -1);
        const nextOrder = kept.concat(added);
        batchOrderRef.current = nextOrder;
        setBatchSelection((current) => (
          current.length === nextOrder.length && current.every((id, index) => id === nextOrder[index])
            ? current
            : nextOrder
        ));
      }
      if (batchQueued.current) {
        batchQueued.current = false;
        refreshBatchSelection();
      }
    });
  }, []);

  const goToBatchLayer = React.useCallback((layerId) => {
    // Blank the source first so stale variants of the previous layer are
    // never clickable while the next one loads
    inlineSourceKey.current = "";
    inlineLayerIdRef.current = null;
    setInlineLayerSource({ text: "", style: null, key: "", layerId: null, loading: true, error: "" });
    csInterface.evalScript(`selectLayerById(${JSON.stringify(layerId)})`, () => {
      refreshInlineLayerSource(true);
      refreshInlineSelectionShape(true);
    });
  }, [refreshInlineLayerSource, refreshInlineSelectionShape]);

  const startTextShapeRBatch = React.useCallback(() => {
    const queue = batchOrderRef.current;
    if (queue.length < 2) return;
    setBatchRun({ queue: [...queue], index: 0 });
    goToBatchLayer(queue[0]);
  }, [goToBatchLayer]);

  const stopTextShapeRBatch = React.useCallback(() => {
    setBatchRun(null);
    refreshBatchSelection();
  }, [refreshBatchSelection]);

  const advanceTextShapeRBatch = React.useCallback(() => {
    const current = batchRunRef.current;
    if (!current) return;
    const nextIndex = current.index + 1;
    if (nextIndex >= current.queue.length) {
      setBatchRun(null);
      return;
    }
    setBatchRun({ ...current, index: nextIndex });
    goToBatchLayer(current.queue[nextIndex]);
  }, [goToBatchLayer]);

  React.useEffect(() => {
    if (!context.state.inlineTextShapeR) return undefined;
    refreshInlineLayerSource();
    refreshInlineSelectionShape();
    refreshBatchSelection();

    // Primary signal: Photoshop notifies the panel when a layer is selected
    // or edited. Debounced because 'setd' events arrive in bursts.
    const unsubscribePhotoshopEvents = addPhotoshopEventListener((event) => {
      // The batch diff runs on every layer-select event, undebounced:
      // collapsing quick successive layer clicks would lose the order the
      // user picked them in. 'setd' bursts (selection drags, text edits)
      // never change which layers are targeted, so skip the diff for them.
      if (isPhotoshopSelectEvent(event)) refreshBatchSelection();
      if (inlineEventDebounce.current) clearTimeout(inlineEventDebounce.current);
      inlineEventDebounce.current = setTimeout(() => {
        inlineEventDebounce.current = null;
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
      }, 120);
    });

    const refreshOnFocus = () => {
      refreshInlineLayerSource();
      refreshInlineSelectionShape();
      refreshBatchSelection();
    };
    const refreshOnVisibility = () => {
      if (!document.hidden) refreshOnFocus();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    // Fallback polling for hosts where the event bridge stays silent; slows
    // down to a keep-alive once real Photoshop events are flowing.
    const pollTimer = setInterval(() => {
      // Never queue refresh work behind a running paste/align action
      if (document.hidden || isHostActionPending()) return;
      const idleDelay = hasReceivedPhotoshopEvents() ? 6000 : 1200;
      if (Date.now() - inlineLastRefreshAt.current >= idleDelay) {
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
        refreshBatchSelection();
      }
    }, 1200);

    return () => {
      unsubscribePhotoshopEvents();
      window.removeEventListener("focus", refreshOnFocus);
      document.removeEventListener("visibilitychange", refreshOnVisibility);
      clearInterval(pollTimer);
      if (inlineEventDebounce.current) {
        clearTimeout(inlineEventDebounce.current);
        inlineEventDebounce.current = null;
      }
      clearInlineShapeSettle();
      inlineSourcePending.current = false;
      inlineShapePending.current = false;
    };
  }, [context.state.inlineTextShapeR, refreshInlineLayerSource, refreshInlineSelectionShape, refreshBatchSelection, clearInlineShapeSettle]);

  React.useEffect(() => {
    setInlineVariantPage(0);
  }, [inlineLayerSource.key]);

  // Re-detect the bubble when the active layer changes or the mode toggles
  React.useEffect(() => {
    if (!context.state.inlineTextShapeR) return;
    refreshInlineSelectionShape();
  }, [context.state.inlineTextShapeR, inlineLayerSource.key, bubbleAware, refreshInlineSelectionShape]);

  const toggleBubbleAware = React.useCallback(() => {
    context.dispatch({ type: "setTextShapeRBubbleAware", value: !bubbleAware });
  }, [context, bubbleAware]);
  const bubbleAwareTitle = bubbleAware
    ? (locale.textShapeRBubbleToggleOn || "Bubble-aware is on: when there is no active selection, TextShapeR detects the bubble around the selected text layer and shapes suggestions to it. Click to turn it off.")
    : (locale.textShapeRBubbleToggleOff || "Bubble-aware is off: TextShapeR only follows a manual Photoshop selection. Click to auto-detect the bubble around the selected text layer.");

  React.useEffect(() => {
    setInlineVariantPage((current) => Math.min(current, inlinePageCount - 1));
  }, [inlinePageCount]);

  const showShiftTip = React.useCallback(() => {
    setShiftSelectionWarning(true);
    if (shiftTipTimeout.current) {
      clearTimeout(shiftTipTimeout.current);
    }
    shiftTipTimeout.current = setTimeout(() => setShiftSelectionWarning(false), 3500);
  }, []);

  const showClearAllTipFunc = React.useCallback(() => {
    if (clearAllTipShown) return;
    setShowClearAllTip(true);
    setClearAllTipShown(true);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
    clearAllTipTimeout.current = setTimeout(() => setShowClearAllTip(false), 5000);
  }, [clearAllTipShown]);

  const closeClearAllTip = () => {
    setShowClearAllTip(false);
    if (clearAllTipTimeout.current) {
      clearTimeout(clearAllTipTimeout.current);
    }
  };

  const addSelectionAndAdvance = (selection) => {
    if (!selection) return;
    context.dispatch({
      type: "addSelection",
      selection,
      lineIndex: context.state.currentLineIndex,
    });
    if (context.state.multiBubbleMode) {
      context.dispatch({ type: "nextLine", add: true });
    }
  };

  // Resets the stored selections AND the active Photoshop selection: leaving
  // the marquee alive would make the poll re-add it right away and advance
  // the current line behind the user's back
  const resetStoredSelections = React.useCallback(() => {
    context.dispatch({ type: "clearSelections" });
    deselectDocument();
  }, [context.dispatch]);

  const clearButtonTimeout = React.useRef(null);

  const removeLastStoredSelection = () => {
    const storedSelections = context.state.storedSelections || [];
    if (storedSelections.length === 0) return;
    context.dispatch({ type: "removeSelection", index: storedSelections.length - 1 });
    // The removed selection is usually the live marquee: drop it in Photoshop
    // too so the poll does not re-add it and advance the line
    deselectDocument();
  };

  const handleClearMouseDown = () => {
    clearButtonTimeout.current = setTimeout(() => {
      clearButtonTimeout.current = null;
      resetStoredSelections();
    }, 1000);
  };

  const handleClearMouseUp = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
      removeLastStoredSelection();
    }
  };

  const handleClearMouseLeave = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
    }
  };

  const checkForSelectionChange = React.useCallback(() => {
    if (!context.state.multiBubbleMode || context.state.modalType || document.hidden || selectionCheckPending.current || isHostActionPending()) return;
    selectionCheckPending.current = true;

    getSelectionChanged((selection) => {
      selectionCheckPending.current = false;
      if (selection) {
        const getNextLineIndex = (lineIndex) => {
          const lines = context.state.lines || [];
          const currentLine = lines[lineIndex];
          if (currentLine?.last) {
            return { index: lineIndex, advanced: false };
          }
          for (let i = lineIndex + 1; i < lines.length; i++) {
            if (!lines[i].ignore) {
              return { index: lines[i].rawIndex, advanced: true };
            }
          }
          return { index: lineIndex, advanced: false };
        };

        if (selection.multiSelection && selection.multiSelection.length > 0) {
          const storedHashSet = new Set((context.state.storedSelections || []).map((storedSelection) => getSelectionBoundsHash(storedSelection)));
          let nextLineIndex = context.state.currentLineIndex;
          let addedCount = 0;

          for (const multiSelection of selection.multiSelection) {
            const { shiftKey, ...cleanSelection } = multiSelection;
            const selectionHash = getSelectionBoundsHash(cleanSelection);
            if (storedHashSet.has(selectionHash)) {
              continue;
            }

            storedHashSet.add(selectionHash);
            context.dispatch({
              type: "addSelection",
              selection: cleanSelection,
              lineIndex: nextLineIndex,
            });
            addedCount++;
            const nextLine = getNextLineIndex(nextLineIndex);
            nextLineIndex = nextLine.index;
            if (!nextLine.advanced) {
              break;
            }
          }

          if (addedCount > 0 && nextLineIndex !== context.state.currentLineIndex) {
            context.dispatch({ type: "setCurrentLineIndex", index: nextLineIndex });
          }
          return;
        }

        if (selection.shiftKey) {
          showShiftTip();
          return;
        }
        const { shiftKey, ...cleanSelection } = selection;
        const newHash = getSelectionBoundsHash(cleanSelection);
        const storedHashSet = new Set((context.state.storedSelections || []).map((storedSelection) => getSelectionBoundsHash(storedSelection)));

        if (!storedHashSet.has(newHash)) {
          addSelectionAndAdvance(cleanSelection);
        }
      }
    });
  }, [context.state.multiBubbleMode, context.state.modalType, context.state.storedSelections, context.state.currentLineIndex, context.state.lines, showShiftTip]);

  React.useEffect(() => {
    if (context.state.multiBubbleMode && !context.state.modalType) {
      startSelectionMonitoring();
      selectionCheckInterval.current = setInterval(checkForSelectionChange, 200);
    } else {
      stopSelectionMonitoring();
      selectionCheckPending.current = false;
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
        selectionCheckInterval.current = null;
      }
    }

    return () => {
      stopSelectionMonitoring();
      selectionCheckPending.current = false;
      if (selectionCheckInterval.current) {
        clearInterval(selectionCheckInterval.current);
      }
      if (shiftTipTimeout.current) {
        clearTimeout(shiftTipTimeout.current);
      }
      if (clearAllTipTimeout.current) {
        clearTimeout(clearAllTipTimeout.current);
      }
      if (clearButtonTimeout.current) {
        clearTimeout(clearButtonTimeout.current);
      }
    };
  }, [context.state.multiBubbleMode, context.state.modalType, checkForSelectionChange]);
  React.useEffect(() => {
    if (!context.state.multiBubbleMode && shiftSelectionWarning) {
      setShiftSelectionWarning(false);
    }
  }, [context.state.multiBubbleMode, shiftSelectionWarning]);

  React.useEffect(() => {
    const storedSelections = context.state.storedSelections || [];
    if (context.state.multiBubbleMode && storedSelections.length > 10 && !clearAllTipShown) {
      showClearAllTipFunc();
    }
    if (!context.state.multiBubbleMode || storedSelections.length === 0) {
      setClearAllTipShown(false);
      setShowClearAllTip(false);
    }
  }, [context.state.multiBubbleMode, context.state.storedSelections, clearAllTipShown, showClearAllTipFunc]);

  const createLayer = () => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      const payload = buildStoredSelectionPayload({
        storedSelections,
        lines: context.state.lines,
        currentLineIndex: context.state.currentLineIndex,
        styles: context.state.styles,
        currentStyle: context.state.currentStyle,
        textScale: context.state.textScale,
      });

      const pointText = context.state.pastePointText;
      const padding = context.state.internalPadding || 0;
      const direction = context.state.direction;
      createTextLayersInStoredSelections(payload.texts, payload.styles, storedSelections, pointText, padding, direction, (ok) => {
        if (ok) {
          resetStoredSelections();
        }
      });
    } else {
      const lineStyle = getScaledStyle(context.state.currentStyle, context.state.textScale);
      const pointText = context.state.pastePointText;
      const padding = context.state.internalPadding || 0;
      const direction = context.state.direction;
      createTextLayerInSelection(line.text, lineStyle, pointText, padding, direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    }
  };

  const insertStyledText = () => {
    const storedSelections = context.state.storedSelections || [];
    
    if (context.state.multiBubbleMode && storedSelections.length > 0) {
      createLayer();
    } else {
      const lineStyle = getScaledStyle(context.state.currentStyle, context.state.textScale);
      setActiveLayerText(line.text, lineStyle, context.state.direction, (ok) => {
        if (ok) context.dispatch({ type: "nextLine", add: true });
      });
    }
  };

  const currentLineClick = React.useCallback(() => {
    if (line.rawIndex === void 0) return;
    scrollToLine(line.rawIndex);
  }, [line.rawIndex]);

  const handleAlignLayer = React.useCallback(() => {
    const padding = context.state.internalPadding || 0;
    alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, padding, () => {
      if (context.state.multiBubbleMode && (context.state.storedSelections || []).length > 0) {
        resetStoredSelections();
      }
    });
  }, [context.state.internalPadding, context.state.resizeTextBoxOnCenter, context.state.multiBubbleMode, context.state.storedSelections, resetStoredSelections]);

  const handleDecrease = React.useCallback(() => {
    changeActiveLayerTextSize(-(context.state.textSizeIncrement || 1));
  }, [context.state.textSizeIncrement]);

  const handleIncrease = React.useCallback(() => {
    changeActiveLayerTextSize(context.state.textSizeIncrement || 1);
  }, [context.state.textSizeIncrement]);

  const handlePrevLine = React.useCallback(() => {
    context.dispatch({ type: "prevLine" });
  }, [context.dispatch]);

  const handleNextLine = React.useCallback(() => {
    context.dispatch({ type: "nextLine" });
  }, [context.dispatch]);

  const handleScaleChange = React.useCallback((e) => {
    context.dispatch({ type: "setTextScale", scale: e.target.value });
  }, [context.dispatch]);

  const focusScale = React.useCallback(() => {
    if (!context.state.textScale) context.dispatch({ type: "setTextScale", scale: 100 });
  }, [context.state.textScale, context.dispatch]);

  const blurScale = React.useCallback(() => {
    if (context.state.textScale === 100) context.dispatch({ type: "setTextScale", scale: null });
  }, [context.state.textScale, context.dispatch]);

  const moveInlineTextShapeRPage = React.useCallback((direction) => {
    setInlineVariantPage((current) => {
      if (inlinePageCount <= 1) return 0;
      return (current + direction + inlinePageCount) % inlinePageCount;
    });
  }, [inlinePageCount]);

  const applyTextShapeRVariant = React.useCallback((variant, advance = false) => {
    if (!variant || applyingTextShapeRId) return;
    // In batch mode, only apply once the loaded layer really is the queued
    // one — a fast click during the layer switch must not hit the wrong layer
    if (batchRunRef.current) {
      const expectedLayerId = batchRunRef.current.queue[batchRunRef.current.index];
      if (inlineLayerSource.loading || !inlineLayerSource.layerId || inlineLayerSource.layerId !== expectedLayerId) return;
    }
    setApplyingTextShapeRId(variant.id);
    // Fast path: the style snapshot the widget already read lets the host
    // skip its own layer re-read and every style/stroke re-apply — only the
    // line breaking changes
    setLayerTextFast(variant.text, inlineLayerSource.style, context.state.direction, (ok) => {
      setApplyingTextShapeRId(null);
      if (!ok) return;
      // In batch mode a picked shape moves on to the next queued layer
      if (batchRunRef.current) {
        advanceTextShapeRBatch();
        return;
      }
      setTextShapeRUndoDepth((depth) => depth + 1);
      // The layer text now IS the applied variant: update the source locally
      // instead of paying a read roundtrip; the debounced Photoshop event
      // refresh will confirm silently (same key, no re-render)
      setInlineLayerSource((current) => {
        const next = { ...current, text: variant.text, loading: false, error: "" };
        next.key = getLayerSourceKey(next);
        inlineSourceKey.current = next.key;
        return next;
      });
      if (advance) context.dispatch({ type: "nextLine", add: true });
    });
  }, [applyingTextShapeRId, context, inlineLayerSource.style, inlineLayerSource.loading, inlineLayerSource.layerId, advanceTextShapeRBatch]);

  // Hover refresh is a fallback for missed Photoshop events: rate-limit it so
  // sweeping the cursor over the widget doesn't queue ExtendScript roundtrips
  const handleTextShapeRMouseEnter = React.useCallback(() => {
    if (Date.now() - inlineLastRefreshAt.current < 800 || isHostActionPending()) return;
    refreshInlineLayerSource();
    refreshInlineSelectionShape();
  }, [refreshInlineLayerSource, refreshInlineSelectionShape]);

  // Jumps Photoshop history back to just before the last applied shape —
  // the panel equivalent of Ctrl+Z after trying a shape
  const undoTextShapeRApply = React.useCallback(() => {
    if (applyingTextShapeRId || batchRunRef.current) return;
    undoLastTextChange((ok) => {
      if (!ok) return;
      setTextShapeRUndoDepth((depth) => Math.max(0, depth - 1));
      inlineSourceKey.current = "";
      refreshInlineLayerSource(true);
    });
  }, [applyingTextShapeRId, refreshInlineLayerSource]);

  const handleIncrementChange = React.useCallback((e) => {
    context.dispatch({ type: "setTextSizeIncrement", increment: e.target.value });
  }, [context.dispatch]);

  const handleIncrementBlur = React.useCallback(() => {
    if (!context.state.textSizeIncrement || context.state.textSizeIncrement < 1) {
      context.dispatch({ type: "setTextSizeIncrement", increment: 1 });
    }
  }, [context.state.textSizeIncrement, context.dispatch]);

  return (
    <React.Fragment>
      <div className="preview-top">
        {context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0 && (
          <div className="preview-top_selection-controls">
            <div className="preview-top_selection-info">
              <span className="preview-top_selection-count">{context.state.storedSelections.length} {context.state.storedSelections.length > 1 ? (locale.selectionsCount || 'selections') : (locale.selectionCount || 'selection')}</span>
              <button
                className="topcoat-icon-button--large"
                title={locale.clearSelections || "Remove the last selection (hold 1s to clear all)"}
                onMouseDown={handleClearMouseDown}
                onMouseUp={handleClearMouseUp}
                onMouseLeave={handleClearMouseLeave}
              >
                <FiMinusCircle size={16} />
              </button>
            </div>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && shiftSelectionWarning && (
          <div className="preview-top_selection-warning">
            <FiAlertTriangle size={14} />
            <span>{locale.multiBubbleShiftTip || "Multi-bubble works with one selection at a time. Release Shift and create selections one by one."}</span>
          </div>
        )}
        {context.state.multiBubbleMode && context.state.showTips !== false && showClearAllTip && (
          <div className="preview-top_selection-tip">
            <FiMinusCircle size={14} />
            <span>{locale.multiBubbleClearAllTip || "Tip: Hold the - button for 1 second to clear all selections at once"}</span>
            <button
              className="preview-top_selection-tip-close"
              onClick={closeClearAllTip}
              title={locale.close || "Close"}
            >
              <FiX size={14} />
            </button>
          </div>
        )}
        <div className="preview-top_main-controls">
          {uiVisible.previewCreateButton !== false && (
            <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large--cta" title={
              context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0
                ? (locale.multiBubbleCreateLayersDescr || "Paste {count} text layer(s)").replace("{count}", context.state.storedSelections.length)
                : locale.createLayerDescr
            } onClick={createLayer}>
              <AiOutlineBorderInner size={18} /> {locale.createLayer}
            </button>
          )}
          {uiVisible.previewAlignButton !== false && (
            <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large" title={locale.alignLayerDescr} onClick={handleAlignLayer}>
              <MdCenterFocusWeak size={18} /> {locale.alignLayer}
            </button>
          )}
          {uiVisible.previewSizeControls !== false && (
            <div className="preview-top_change-size-cont">
              <button className="topcoat-icon-button--large" title={locale.layerTextSizeMinus} onClick={handleDecrease}>
                <FiMinusCircle size={18} />
              </button>
              <div className="preview-top_size-input">
                <input min={1} max={99} type="number" value={context.state.textSizeIncrement || ""} onChange={handleIncrementChange} onBlur={handleIncrementBlur} className="topcoat-text-input" />
                <span>px</span>
              </div>
              <button className="topcoat-icon-button--large" title={locale.layerTextSizePlus} onClick={handleIncrease}>
                <FiPlusCircle size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
      {(uiVisible.previewNav !== false || uiVisible.previewWidget !== false) && (
      <div className="preview-bottom">
        {uiVisible.previewNav !== false && (
        <div className="preview-nav">
          <button className="topcoat-icon-button--large" title={locale.prevLine} onClick={handlePrevLine}>
            <FiArrowUp size={18} />
          </button>
          <button className="topcoat-icon-button--large" title={locale.nextLine} onClick={handleNextLine}>
            <FiArrowDown size={18} />
          </button>
        </div>
        )}
        {uiVisible.previewWidget === false ? null : context.state.inlineTextShapeR ? (
          <div className="preview-textshaper hostBgdDark" onMouseEnter={handleTextShapeRMouseEnter}>
            <div className="preview-textshaper-head">
              <div className="preview-textshaper-title">
                <span>{locale.textShapeRTitle || "TextShapeR"}</span>
              </div>
              <div className="preview-textshaper-pager">
                {batchRun ? (
                  <span className="preview-textshaper-batch-run">
                    <span
                      className="preview-textshaper-batch-progress"
                      title={(locale.textShapeRBatchProgress || "Batch: shaping layer {current} of {total}")
                        .replace("{current}", batchRun.index + 1)
                        .replace("{total}", batchRun.queue.length)}
                    >
                      {batchRun.index + 1}/{batchRun.queue.length}
                    </span>
                    <button
                      type="button"
                      onClick={advanceTextShapeRBatch}
                      title={locale.textShapeRBatchSkip || "Skip this layer and go to the next one"}
                    >
                      <FiChevronsRight size={12} />
                    </button>
                    <button
                      type="button"
                      onClick={stopTextShapeRBatch}
                      title={locale.textShapeRBatchStop || "Stop the batch"}
                    >
                      <FiX size={12} />
                    </button>
                  </span>
                ) : batchSelection.length >= 2 ? (
                  <button
                    type="button"
                    className="preview-textshaper-batch-start"
                    onClick={startTextShapeRBatch}
                    title={(locale.textShapeRBatchStart || "Chain shapes over the {count} selected text layers, in the order you picked them")
                      .replace("{count}", batchSelection.length)}
                  >
                    <FiPlay size={10} />
                    <span>{batchSelection.length}</span>
                  </button>
                ) : null}
                {inlineSelectionShape ? (
                  <span
                    className={"preview-textshaper-shape-dot" + (inlineSelectionShape.source === "bubble" ? " is-bubble" : "")}
                    title={inlineSelectionShape.source === "bubble"
                      ? (locale.textShapeRBubbleActive || "Shapes follow the detected bubble outline")
                      : (locale.textShapeRShapeActive || "Shapes follow the current selection outline")}
                  />
                ) : null}
                <button
                  type="button"
                  className={"preview-textshaper-bubble-toggle" + (bubbleAware ? " is-active" : "")}
                  onClick={toggleBubbleAware}
                  title={bubbleAwareTitle}
                >
                  <FaMagic size={10} />
                </button>
                <button
                  type="button"
                  onClick={undoTextShapeRApply}
                  disabled={!textShapeRUndoDepth || !!applyingTextShapeRId || !!batchRun}
                  title={locale.textShapeRUndo || "Undo the last applied shape (steps Photoshop history back)"}
                >
                  <FiRotateCcw size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => { refreshInlineLayerSource(true); refreshInlineSelectionShape(true); }}
                  disabled={inlineLayerSource.loading}
                  title={locale.textShapeRLayerRefreshHint || "Refresh the selected Photoshop text layer, its style, and the bubble/selection shape"}
                >
                  <FiRefreshCw size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapeRPage(-1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.textShapeRPreviousSuggestions || "Show previous TextShapeR suggestions"}
                >
                  <FiChevronLeft size={12} />
                </button>
                <span>{inlineLayerSource.loading ? (locale.textShapeRLayerLoading || "Reading selected layer...") : `${inlineVariantPage + 1}/${inlinePageCount}`}</span>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapeRPage(1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.textShapeRNextSuggestions || "Show next TextShapeR suggestions"}
                >
                  <FiChevronRight size={12} />
                </button>
              </div>
            </div>
            <div className="preview-textshaper-list">
              {visibleInlineVariants.length ? visibleInlineVariants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={"preview-textshaper-choice" + (applyingTextShapeRId === variant.id ? " is-applying" : "")}
                  onClick={(event) => applyTextShapeRVariant(variant, event.shiftKey)}
                  title={locale.textShapeRInlineApplyHint || "Apply this text shape to the selected Photoshop text layer. Shift-click also moves to the next line."}
                >
                  <span className="preview-textshaper-rank">{inlineVariantPage * inlinePageSize + index + 1}</span>
                  <TextShapeRFitPreview
                    outerClassName="preview-textshaper-text"
                    innerClassName="preview-textshaper-fit"
                    contentKey={`${variant.text}|${markdownEnabled}|${inlineStyleObject.fontFamily || ""}`}
                    style={{ ...inlineStyleObject, fontFamily: inlineStyleObject.fontFamily || "Tahoma" }}
                  >
                    {variant.lines.map((variantLine, lineIndex) => (
                      <span key={`${variant.id}-${lineIndex}`} className="preview-textshaper-line">
                        {renderMarkdownText(variantLine)}
                      </span>
                    ))}
                  </TextShapeRFitPreview>
                </button>
              )) : (
                <div className="preview-textshaper-empty">{inlineLayerSource.error || locale.textShapeREmpty || "No text available for TextShapeR."}</div>
              )}
            </div>
          </div>
        ) : (
          <div className="preview-current hostBgdDark" title={locale.scrollToLine} onClick={currentLineClick}>
            <div className="preview-line-info">
              <div className="preview-line-info-text">
                {locale.previewLine}: <b>{line.index || "—"}</b>, {locale.previewStyle}: <b className="preview-line-style-name">{style.name || "—"}</b>, {locale.previewTextScale}:
                <div className="preview-line-scale">
                  <input min={1} max={999} type="number" placeholder="100" value={context.state.textScale || ""} onChange={handleScaleChange} onFocus={focusScale} onBlur={blurScale} className="topcoat-text-input" />
                  <span>%</span>
                </div>
              </div>
              <div className="preview-line-info-actions">
                <FiArrowRightCircle size={16} onClick={insertStyledText} title={locale.insertStyledText} />
              </div>
            </div>
            <div className="preview-line-text" style={styleObject}>
              <span style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}>
                {renderMarkdownText(line.text || "")}
              </span>
            </div>
          </div>
        )}
      </div>
      )}
    </React.Fragment>
  );
});

export default PreviewBlock;
