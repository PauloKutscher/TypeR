import "./bubbleDetect.scss";

import React from "react";
import { FiRefreshCw, FiX, FiMinusCircle, FiPlusCircle, FiLayers, FiCheckCircle } from "react-icons/fi";
import { AiOutlineBorderInner } from "react-icons/ai";

import { locale, exportDocumentSnapshot, createTextLayersInStoredSelections, deselectDocument } from "../../utils";
import { useContext } from "../../context";
import { buildStoredSelectionPayload } from "../../textLayerPayload";
import {
  getDetectionOptions,
  detectBubbles,
  orderBubbles,
  bubbleToSelection,
  getNextUsableLineIndex,
  assignLinesToBubbles,
  findLineByDisplayNumber,
} from "../../bubbleDetection";

const SNAPSHOT_MAX_DIM = 1500;

const BubbleDetectModal = React.memo(function BubbleDetectModal() {
  const context = useContext((state) => ({
    lines: state.lines,
    currentLineIndex: state.currentLineIndex,
    currentStyleId: state.currentStyleId,
    currentStyle: state.currentStyle,
    styles: state.styles,
    textScale: state.textScale,
    pastePointText: state.pastePointText,
    internalPadding: state.internalPadding,
    direction: state.direction,
    multiBubbleMode: state.multiBubbleMode,
  }));

  const [phase, setPhase] = React.useState("scanning");
  const [errorKey, setErrorKey] = React.useState(null);
  const [snapshot, setSnapshot] = React.useState(null);
  const [rawBubbles, setRawBubbles] = React.useState([]);
  const [excluded, setExcluded] = React.useState({});
  const [manual, setManual] = React.useState({});
  const [rtl, setRtl] = React.useState(true);
  const [sensitivity, setSensitivity] = React.useState(5);
  const [hoverId, setHoverId] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const imageDataRef = React.useRef(null);
  const activeRef = React.useRef(true);
  React.useEffect(() => () => {
    activeRef.current = false;
  }, []);

  const close = React.useCallback(() => {
    context.dispatch({ type: "setModal" });
  }, [context.dispatch]);

  const runDetection = React.useCallback((pixels, sensitivityValue) => {
    const detectedBubbles = detectBubbles(pixels, getDetectionOptions(sensitivityValue))
      .map((bubble, index) => ({ ...bubble, id: index }));
    setRawBubbles(detectedBubbles);
    setExcluded({});
    setManual({});
  }, []);

  const scan = React.useCallback(() => {
    setPhase("scanning");
    setErrorKey(null);
    exportDocumentSnapshot(SNAPSHOT_MAX_DIM, (result) => {
      if (!activeRef.current) return;
      if (!result || result.error || !result.path) {
        setErrorKey(result?.error === "doc" ? "doc" : "generic");
        setPhase("error");
        return;
      }
      const read = window.cep.fs.readFile(result.path, window.cep.encoding.Base64);
      if (!read || read.err || !read.data) {
        setErrorKey("generic");
        setPhase("error");
        return;
      }
      const image = new Image();
      image.onload = () => {
        if (!activeRef.current) return;
        try {
          const canvas = document.createElement("canvas");
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
          const canvasContext = canvas.getContext("2d");
          canvasContext.drawImage(image, 0, 0);
          const pixels = canvasContext.getImageData(0, 0, canvas.width, canvas.height);
          imageDataRef.current = pixels;
          setSnapshot({
            dataUrl: image.src,
            imageWidth: canvas.width,
            imageHeight: canvas.height,
            docWidth: result.docWidth || canvas.width,
            docHeight: result.docHeight || canvas.height,
          });
          runDetection(pixels, sensitivity);
          setPhase("ready");
        } catch (error) {
          setErrorKey("generic");
          setPhase("error");
        }
      };
      image.onerror = () => {
        if (!activeRef.current) return;
        setErrorKey("generic");
        setPhase("error");
      };
      image.src = "data:image/png;base64," + read.data;
    });
  }, [runDetection, sensitivity]);

  React.useEffect(() => {
    scan();
    // The snapshot reflects the document at open time; re-running on every
    // dependency change would spam Photoshop with duplicate/flatten cycles.
  }, []);

  // Sensitivity changes recompute from the cached pixels: instant, no host call
  React.useEffect(() => {
    if (phase !== "ready" || !imageDataRef.current) return undefined;
    const timer = setTimeout(() => runDetection(imageDataRef.current, sensitivity), 150);
    return () => clearTimeout(timer);
  }, [sensitivity]);

  const lines = context.state.lines || [];
  const startRawIndex = React.useMemo(() => {
    const usable = getNextUsableLineIndex(lines, context.state.currentLineIndex);
    return usable === null ? context.state.currentLineIndex : usable;
  }, [lines, context.state.currentLineIndex]);

  const ordered = React.useMemo(() => orderBubbles(rawBubbles, rtl), [rawBubbles, rtl]);
  const orderedIncluded = React.useMemo(
    () => ordered
      .filter((bubble) => !excluded[bubble.id])
      .map((bubble) => (typeof manual[bubble.id] === "number" ? { ...bubble, manualLineIndex: manual[bubble.id] } : bubble)),
    [ordered, excluded, manual]
  );
  const assignments = React.useMemo(
    () => assignLinesToBubbles(orderedIncluded, lines, startRawIndex),
    [orderedIncluded, lines, startRawIndex]
  );

  const toggleBubble = React.useCallback((id) => {
    setExcluded((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const handleNumberChange = React.useCallback((id, value) => {
    const displayNumber = parseInt(value, 10);
    if (!Number.isFinite(displayNumber)) return;
    const lineIndex = findLineByDisplayNumber(lines, displayNumber, startRawIndex);
    if (lineIndex === null) return;
    setManual((current) => ({ ...current, [id]: lineIndex }));
  }, [lines, startRawIndex]);

  const buildEntries = React.useCallback(() => {
    if (!snapshot) return [];
    const scaleX = snapshot.docWidth / snapshot.imageWidth;
    const scaleY = snapshot.docHeight / snapshot.imageHeight;
    const entries = [];
    for (const bubble of orderedIncluded) {
      const lineIndex = assignments[bubble.id];
      if (typeof lineIndex !== "number") continue;
      const line = lines[lineIndex];
      entries.push({
        selection: bubbleToSelection(bubble, scaleX, scaleY),
        lineIndex,
        styleId: line?.usedStyle?.id || line?.style?.id || context.state.currentStyleId || null,
      });
    }
    return entries;
  }, [snapshot, orderedIncluded, assignments, lines, context.state.currentStyleId]);

  const getNextLineAfter = React.useCallback((entries) => {
    const lastIndex = entries[entries.length - 1].lineIndex;
    const next = getNextUsableLineIndex(lines, lastIndex + 1);
    return next === null ? lastIndex : next;
  }, [lines]);

  const addToSelections = React.useCallback(() => {
    const entries = buildEntries();
    if (!entries.length) return;
    if (!context.state.multiBubbleMode) {
      context.dispatch({ type: "setMultiBubbleMode", value: true });
    }
    context.dispatch({
      type: "addSelectionBatch",
      entries,
      nextLineIndex: getNextLineAfter(entries),
    });
    close();
  }, [buildEntries, getNextLineAfter, context.state.multiBubbleMode, context.dispatch, close]);

  const pasteNow = React.useCallback(() => {
    const entries = buildEntries();
    if (!entries.length || busy) return;
    const capturedAt = Date.now();
    const storedSelections = entries.map((entry) => ({
      ...entry.selection,
      styleId: entry.styleId,
      lineIndex: entry.lineIndex,
      capturedAt,
    }));
    const payload = buildStoredSelectionPayload({
      storedSelections,
      lines,
      currentLineIndex: context.state.currentLineIndex,
      styles: context.state.styles,
      currentStyle: context.state.currentStyle,
      textScale: context.state.textScale,
    });
    setBusy(true);
    createTextLayersInStoredSelections(
      payload.texts,
      payload.styles,
      storedSelections,
      context.state.pastePointText,
      context.state.internalPadding || 0,
      context.state.direction,
      (ok) => {
        if (!activeRef.current) return;
        setBusy(false);
        if (!ok) return;
        context.dispatch({
          type: "commitLineBatch",
          entries: entries.map((entry) => ({ lineIndex: entry.lineIndex, styleId: entry.styleId })),
          nextLineIndex: getNextLineAfter(entries),
        });
        deselectDocument();
        close();
      }
    );
  }, [buildEntries, getNextLineAfter, busy, lines, context.state, context.dispatch, close]);

  const includedCount = orderedIncluded.length;
  const canApply = phase === "ready" && includedCount > 0 && !busy &&
    orderedIncluded.some((bubble) => typeof assignments[bubble.id] === "number");

  const renderOverlay = () => {
    if (!snapshot) return null;
    return ordered.map((bubble) => {
      const isExcluded = !!excluded[bubble.id];
      const lineIndex = assignments[bubble.id];
      const line = typeof lineIndex === "number" ? lines[lineIndex] : null;
      const style = {
        left: `${(bubble.left / snapshot.imageWidth) * 100}%`,
        top: `${(bubble.top / snapshot.imageHeight) * 100}%`,
        width: `${(bubble.width / snapshot.imageWidth) * 100}%`,
        height: `${(bubble.height / snapshot.imageHeight) * 100}%`,
      };
      return (
        <div
          key={bubble.id}
          className={
            "bubble-detect-box" +
            (isExcluded ? " m-excluded" : "") +
            (hoverId === bubble.id ? " m-hover" : "")
          }
          style={style}
          title={isExcluded ? (locale.bubbleDetectInclude || "Restore this bubble") : (locale.bubbleDetectExclude || "Exclude this bubble")}
          onClick={() => toggleBubble(bubble.id)}
          onMouseEnter={() => setHoverId(bubble.id)}
          onMouseLeave={() => setHoverId(null)}
        >
          <span className="bubble-detect-badge">
            {isExcluded ? "×" : (line ? line.index : "?")}
          </span>
        </div>
      );
    });
  };

  const renderList = () => ordered.map((bubble, position) => {
    const isExcluded = !!excluded[bubble.id];
    const lineIndex = assignments[bubble.id];
    const line = typeof lineIndex === "number" ? lines[lineIndex] : null;
    return (
      <div
        key={bubble.id}
        className={"bubble-detect-row hostBrdContrast" + (isExcluded ? " m-excluded" : "") + (hoverId === bubble.id ? " m-hover" : "")}
        onMouseEnter={() => setHoverId(bubble.id)}
        onMouseLeave={() => setHoverId(null)}
      >
        <span className="bubble-detect-row-order">{position + 1}</span>
        {isExcluded ? (
          <span className="bubble-detect-row-text">{locale.bubbleDetectExcluded || "Excluded"}</span>
        ) : (
          <React.Fragment>
            <input
              className="topcoat-text-input bubble-detect-row-num"
              type="number"
              min={1}
              value={line ? line.index : ""}
              onChange={(event) => handleNumberChange(bubble.id, event.target.value)}
              title={locale.bubbleDetectHint}
            />
            <span className="bubble-detect-row-text">
              {line ? line.text : (locale.bubbleDetectLineMissing || "No line")}
            </span>
          </React.Fragment>
        )}
        <button
          className="topcoat-icon-button--large--quiet bubble-detect-row-toggle"
          title={isExcluded ? (locale.bubbleDetectInclude || "Restore this bubble") : (locale.bubbleDetectExclude || "Exclude this bubble")}
          onClick={() => toggleBubble(bubble.id)}
        >
          {isExcluded ? <FiPlusCircle size={15} /> : <FiMinusCircle size={15} />}
        </button>
      </div>
    );
  });

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.bubbleDetectTitle || "Auto bubble detection"}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner bubble-detect">
          {phase === "scanning" && (
            <div className="bubble-detect-status">{locale.bubbleDetectScanning || "Analyzing the page..."}</div>
          )}
          {phase === "error" && (
            <div className="bubble-detect-status">
              <span>
                {errorKey === "doc"
                  ? (locale.bubbleDetectErrorDoc || "No open document.")
                  : (locale.bubbleDetectError || "Could not analyze the document.")}
              </span>
              <button className="topcoat-button--large" onClick={scan}>
                <FiRefreshCw size={14} /> {locale.bubbleDetectRescan || "Scan again"}
              </button>
            </div>
          )}
          {phase === "ready" && (
            <React.Fragment>
              <div className="bubble-detect-toolbar">
                <div className="bubble-detect-toolbar-group">
                  <span className="bubble-detect-toolbar-label">{locale.bubbleDetectOrder || "Reading order"}</span>
                  <button
                    className={"topcoat-button--large" + (rtl ? " m-active" : "")}
                    onClick={() => setRtl(true)}
                  >
                    {locale.bubbleDetectOrderRtl || "Right → left"}
                  </button>
                  <button
                    className={"topcoat-button--large" + (!rtl ? " m-active" : "")}
                    onClick={() => setRtl(false)}
                  >
                    {locale.bubbleDetectOrderLtr || "Left → right"}
                  </button>
                </div>
                <div className="bubble-detect-toolbar-group">
                  <span className="bubble-detect-toolbar-label">{locale.bubbleDetectSensitivity || "Sensitivity"}</span>
                  <input
                    type="range"
                    min={1}
                    max={9}
                    value={sensitivity}
                    onChange={(event) => setSensitivity(parseInt(event.target.value, 10))}
                  />
                  <button className="topcoat-icon-button--large" title={locale.bubbleDetectRescan || "Scan again"} onClick={scan}>
                    <FiRefreshCw size={15} />
                  </button>
                </div>
              </div>
              <div className="bubble-detect-count">
                {(locale.bubbleDetectFound || "{count} bubble(s) detected").replace("{count}", includedCount)}
              </div>
              {rawBubbles.length === 0 && (
                <div className="bubble-detect-status">{locale.bubbleDetectEmpty || "No bubble detected. Try increasing the sensitivity."}</div>
              )}
              {snapshot && (
                <div className="bubble-detect-stage hostBrdContrast">
                  <img src={snapshot.dataUrl} alt="" draggable={false} />
                  {renderOverlay()}
                </div>
              )}
              {ordered.length > 0 && (
                <React.Fragment>
                  <div className="bubble-detect-hint">
                    {locale.bubbleDetectHint || "Click a bubble to exclude or restore it. Edit a number to link another dialogue line; the following bubbles renumber automatically."}
                  </div>
                  <div className="bubble-detect-list">{renderList()}</div>
                </React.Fragment>
              )}
            </React.Fragment>
          )}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast bubble-detect-footer">
        <button className="topcoat-button--large" onClick={close}>
          {locale.cancel}
        </button>
        <button
          className="topcoat-button--large"
          disabled={!canApply}
          title={locale.bubbleDetectAddSelectionsDescr || "Store the detected bubbles as multi-bubble selections"}
          onClick={addToSelections}
        >
          <FiLayers size={15} /> {locale.bubbleDetectAddSelections || "Add to selections"}
        </button>
        <button
          className="topcoat-button--large--cta"
          disabled={!canApply}
          title={locale.bubbleDetectPasteNowDescr || "Create the text layers for all detected bubbles now"}
          onClick={pasteNow}
        >
          {busy ? <FiCheckCircle size={15} /> : <AiOutlineBorderInner size={15} />} {locale.bubbleDetectPasteNow || "Paste now"}
        </button>
      </div>
    </React.Fragment>
  );
});

export default BubbleDetectModal;
