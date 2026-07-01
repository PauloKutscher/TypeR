import "./previewBlock.scss";

import React from "react";
import { FiArrowRightCircle, FiChevronLeft, FiChevronRight, FiRefreshCw, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown, FiAlertTriangle, FiX, FiType } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";
import { FaMagic } from "react-icons/fa";

import { csInterface, locale, setActiveLayerText, getCurrentSelection, getSelectionBoundsHash, addPhotoshopEventListener, hasReceivedPhotoshopEvents, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { buildStoredSelectionPayload, getScaledStyle } from "../../textLayerPayload";
import { generateTextShapRVariants } from "../../textShapR";
import TextShapRFitPreview from "../textShapRFitPreview";

const normalizeLayerText = (text) => String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const getLayerSourceKey = (source) => JSON.stringify({
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
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const [inlineLayerSource, setInlineLayerSource] = React.useState({
    text: "",
    style: null,
    key: "",
    loading: false,
    error: "",
  });
  const inlineSourceKey = React.useRef("");
  const inlineSourcePending = React.useRef(false);
  const inlineEventDebounce = React.useRef(null);
  const inlineLastRefreshAt = React.useRef(0);
  const inlineShapePending = React.useRef(false);
  const inlineShapeKey = React.useRef("");
  const [inlineSelectionShape, setInlineSelectionShape] = React.useState(null);
  const inlineTextStyle = inlineLayerSource.style?.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const inlineStyleObject = getStyleObject(inlineTextStyle);
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const inlineTextShapRVariants = React.useMemo(
    () => generateTextShapRVariants(inlineLayerSource.text, {
      limit: 10,
      allowHyphenation: true,
      profile: "balanced",
      shapeProfile: inlineSelectionShape?.profile || null,
      width: inlineSelectionShape?.width,
      height: inlineSelectionShape?.height,
    }),
    [inlineLayerSource.text, inlineSelectionShape]
  );
  const [inlineVariantPage, setInlineVariantPage] = React.useState(0);
  const inlinePageSize = 3;
  const inlinePageCount = Math.max(1, Math.ceil(inlineTextShapRVariants.length / inlinePageSize));
  const visibleInlineVariants = inlineTextShapRVariants.slice(
    inlineVariantPage * inlinePageSize,
    inlineVariantPage * inlinePageSize + inlinePageSize
  );
  const [applyingTextShapRId, setApplyingTextShapRId] = React.useState(null);
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
        setInlineLayerSource((current) => {
          const error = locale.textShapRLayerNoText || "Select a Photoshop text layer first.";
          if (!current.text && current.error === error && !current.loading) return current;
          return { text: "", style: null, key: "", loading: false, error };
        });
        return;
      }
      if (source.key === inlineSourceKey.current) {
        setInlineLayerSource((current) => (current.loading || current.error ? { ...current, loading: false, error: "" } : current));
        return;
      }
      inlineSourceKey.current = source.key;
      setInlineLayerSource({
        text: source.text,
        style: source.style,
        key: source.key,
        loading: false,
        error: "",
      });
    });
  }, []);

  const bubbleAware = context.state.textShapRBubbleAware === true;

  const refreshInlineSelectionShape = React.useCallback((force = false) => {
    if (inlineShapePending.current) return;
    // Multi-bubble mode owns the selection monitor; sampling the outline
    // would replace the user's selection mid-flow
    if (context.state.multiBubbleMode) return;
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
        // The outline sampling is expensive, only run it when bounds changed
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

      if (!bubbleAware || !inlineSourceKey.current) {
        inlineShapePending.current = false;
        inlineShapeKey.current = "";
        setInlineSelectionShape((current) => (current ? null : current));
        return;
      }

      // Bubble-aware mode: magic-wand the bubble around the active text layer
      // (same detection as align-without-selection). Cached per layer so the
      // wand only fires when the layer changes.
      const bubbleKey = `bubble:${inlineSourceKey.current}`;
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
  }, [context.state.multiBubbleMode, bubbleAware]);

  React.useEffect(() => {
    if (!context.state.inlineTextShapR) return undefined;
    refreshInlineLayerSource();
    refreshInlineSelectionShape();

    // Primary signal: Photoshop notifies the panel when a layer is selected
    // or edited. Debounced because 'setd' events arrive in bursts.
    const unsubscribePhotoshopEvents = addPhotoshopEventListener(() => {
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
    };
    const refreshOnVisibility = () => {
      if (!document.hidden) refreshOnFocus();
    };
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnVisibility);

    // Fallback polling for hosts where the event bridge stays silent; slows
    // down to a keep-alive once real Photoshop events are flowing.
    const pollTimer = setInterval(() => {
      if (document.hidden) return;
      const idleDelay = hasReceivedPhotoshopEvents() ? 6000 : 1200;
      if (Date.now() - inlineLastRefreshAt.current >= idleDelay) {
        refreshInlineLayerSource();
        refreshInlineSelectionShape();
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
      inlineSourcePending.current = false;
      inlineShapePending.current = false;
    };
  }, [context.state.inlineTextShapR, refreshInlineLayerSource, refreshInlineSelectionShape]);

  React.useEffect(() => {
    setInlineVariantPage(0);
  }, [inlineLayerSource.key]);

  // Re-detect the bubble when the active layer changes or the mode toggles
  React.useEffect(() => {
    if (!context.state.inlineTextShapR) return;
    refreshInlineSelectionShape();
  }, [context.state.inlineTextShapR, inlineLayerSource.key, bubbleAware, refreshInlineSelectionShape]);

  const toggleBubbleAware = React.useCallback(() => {
    context.dispatch({ type: "setTextShapRBubbleAware", value: !bubbleAware });
  }, [context, bubbleAware]);

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

  const clearButtonTimeout = React.useRef(null);

  const clearStoredSelections = () => {
    const storedSelections = context.state.storedSelections || [];
    if (storedSelections.length === 0) return;
    
    context.dispatch({ type: "removeSelection", index: storedSelections.length - 1 });
  };

  const handleClearMouseDown = () => {
    const timeout = setTimeout(() => {
      context.dispatch({ type: "clearSelections" });
      clearButtonTimeout.current = null;
    }, 1000);
    clearButtonTimeout.current = timeout;
  };

  const handleClearMouseUp = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
      clearStoredSelections();
    }
  };

  const handleClearMouseLeave = () => {
    if (clearButtonTimeout.current) {
      clearTimeout(clearButtonTimeout.current);
      clearButtonTimeout.current = null;
    }
  };

  const checkForSelectionChange = React.useCallback(() => {
    if (!context.state.multiBubbleMode || context.state.modalType || selectionCheckPending.current) return;
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
          context.dispatch({ type: "clearSelections" });
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
        context.dispatch({ type: "clearSelections" });
      }
    });
  }, [context.state.internalPadding, context.state.resizeTextBoxOnCenter, context.state.multiBubbleMode, context.state.storedSelections, context.dispatch]);

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

  const openTextShapR = React.useCallback((event) => {
    event.stopPropagation();
    context.dispatch({ type: "setModal", modal: "textShapR" });
  }, [context.dispatch]);

  const moveInlineTextShapRPage = React.useCallback((direction) => {
    setInlineVariantPage((current) => {
      if (inlinePageCount <= 1) return 0;
      return (current + direction + inlinePageCount) % inlinePageCount;
    });
  }, [inlinePageCount]);

  const applyTextShapRVariant = React.useCallback((variant, advance = false) => {
    if (!variant || applyingTextShapRId) return;
    setApplyingTextShapRId(variant.id);
    const lineStyle = getScaledStyle(inlineLayerSource.style, context.state.textScale);
    setActiveLayerText(variant.text, lineStyle, context.state.direction, (ok) => {
      setApplyingTextShapRId(null);
      if (!ok) return;
      refreshInlineLayerSource();
      if (advance) context.dispatch({ type: "nextLine", add: true });
    });
  }, [applyingTextShapRId, context, inlineLayerSource.style, refreshInlineLayerSource]);

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
                title={locale.clearSelections || "Clear selections"} 
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
          <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large--cta" title={
            context.state.multiBubbleMode && context.state.storedSelections && context.state.storedSelections.length > 0
              ? (locale.multiBubbleCreateLayersDescr || "Paste {count} text layer(s)").replace("{count}", context.state.storedSelections.length)
              : locale.createLayerDescr
          } onClick={createLayer}>
            <AiOutlineBorderInner size={18} /> {locale.createLayer}
          </button>
          <button className="preview-top_big-btn preview-top_big-btn--small topcoat-button--large" title={locale.alignLayerDescr} onClick={handleAlignLayer}>
            <MdCenterFocusWeak size={18} /> {locale.alignLayer}
          </button>
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
        </div>
      </div>
      <div className="preview-bottom">
        <div className="preview-nav">
          <button className="topcoat-icon-button--large" title={locale.prevLine} onClick={handlePrevLine}>
            <FiArrowUp size={18} />
          </button>
          <button className="topcoat-icon-button--large" title={locale.nextLine} onClick={handleNextLine}>
            <FiArrowDown size={18} />
          </button>
        </div>
        {context.state.inlineTextShapR ? (
          <div className="preview-textshapr hostBgdDark" onMouseEnter={() => { refreshInlineLayerSource(); refreshInlineSelectionShape(); }}>
            <div className="preview-textshapr-head">
              <button type="button" className="preview-textshapr-open" onClick={openTextShapR} title={locale.textShapRTitle || "TextShapR"}>
                <FiType size={13} />
                <span>{locale.textShapRTitle || "TextShapR"}</span>
              </button>
              <div className="preview-textshapr-pager">
                {inlineSelectionShape ? (
                  <span
                    className={"preview-textshapr-shape-dot" + (inlineSelectionShape.source === "bubble" ? " is-bubble" : "")}
                    title={inlineSelectionShape.source === "bubble"
                      ? (locale.textShapRBubbleActive || "Shapes follow the detected bubble outline")
                      : (locale.textShapRShapeActive || "Shapes follow the current selection outline")}
                  />
                ) : null}
                <button
                  type="button"
                  className={"preview-textshapr-bubble-toggle" + (bubbleAware ? " is-active" : "")}
                  onClick={toggleBubbleAware}
                  title={locale.textShapRBubbleToggle || "Bubble-aware: auto-detect the bubble around the text"}
                >
                  <FaMagic size={10} />
                </button>
                <button
                  type="button"
                  onClick={() => { refreshInlineLayerSource(true); refreshInlineSelectionShape(true); }}
                  disabled={inlineLayerSource.loading}
                  title={locale.textShapRLayerRefresh || "Refresh selected layer"}
                >
                  <FiRefreshCw size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapRPage(-1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.prevLine || "Previous"}
                >
                  <FiChevronLeft size={12} />
                </button>
                <span>{inlineLayerSource.loading ? (locale.textShapRLayerLoading || "Reading selected layer...") : `${inlineVariantPage + 1}/${inlinePageCount}`}</span>
                <button
                  type="button"
                  onClick={() => moveInlineTextShapRPage(1)}
                  disabled={inlinePageCount <= 1}
                  title={locale.nextLine || "Next"}
                >
                  <FiChevronRight size={12} />
                </button>
              </div>
            </div>
            <div className="preview-textshapr-list">
              {visibleInlineVariants.length ? visibleInlineVariants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={"preview-textshapr-choice" + (applyingTextShapRId === variant.id ? " is-applying" : "")}
                  onClick={(event) => applyTextShapRVariant(variant, event.shiftKey)}
                  title={locale.textShapRApply || "Apply this shape"}
                >
                  <span className="preview-textshapr-rank">{inlineVariantPage * inlinePageSize + index + 1}</span>
                  <TextShapRFitPreview
                    outerClassName="preview-textshapr-text"
                    innerClassName="preview-textshapr-fit"
                    contentKey={`${variant.text}|${markdownEnabled}|${inlineStyleObject.fontFamily || ""}`}
                    style={{ ...inlineStyleObject, fontFamily: inlineStyleObject.fontFamily || "Tahoma" }}
                  >
                    {variant.lines.map((variantLine, lineIndex) => (
                      <span key={`${variant.id}-${lineIndex}`} className="preview-textshapr-line">
                        {renderMarkdownText(variantLine)}
                      </span>
                    ))}
                  </TextShapRFitPreview>
                </button>
              )) : (
                <div className="preview-textshapr-empty">{inlineLayerSource.error || locale.textShapREmpty || "No text available for TextShapR."}</div>
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
                <FiType size={16} onClick={openTextShapR} title={locale.textShapRTitle || "TextShapR"} />
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
    </React.Fragment>
  );
});

export default PreviewBlock;
