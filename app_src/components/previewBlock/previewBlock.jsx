import "./previewBlock.scss";

import React from "react";
import { FiArrowRightCircle, FiPlusCircle, FiMinusCircle, FiArrowUp, FiArrowDown, FiAlertTriangle, FiX, FiType } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";
import { MdCenterFocusWeak } from "react-icons/md";

import { locale, setActiveLayerText, getSelectionBoundsHash, startSelectionMonitoring, stopSelectionMonitoring, getSelectionChanged, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, changeActiveLayerTextSize, getStyleObject, scrollToLine, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { buildStoredSelectionPayload, getScaledStyle } from "../../textLayerPayload";

const PreviewBlock = React.memo(function PreviewBlock() {
  const context = useContext();
  const style = context.state.currentStyle || {};
  const line = context.state.currentLine || { text: "" };
  const textStyle = style.textProps?.layerText.textStyleRange[0].textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const markdownEnabled = context.state.interpretMarkdown !== false;
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
      </div>
    </React.Fragment>
  );
});

export default PreviewBlock;
