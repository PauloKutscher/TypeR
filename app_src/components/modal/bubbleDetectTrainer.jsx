import "./bubbleDetect.scss";

import React from "react";
import { FiCheckCircle, FiCrosshair, FiFolder, FiGitMerge, FiRefreshCw, FiRotateCcw, FiScissors, FiX } from "react-icons/fi";

import {
  locale,
  getCurrentSelection,
  openBubbleTrainingDocument,
  closeBubbleTrainingDocument,
  readStorage,
  writeToStorage,
} from "../../utils";
import { useContext } from "../../context";
import {
  getDetectionOptions,
  detectBubbleCandidates,
  getBubbleConfidence,
  getBubbleConfidenceThreshold,
  normalizeBubbleLearning,
  trainBubbleLearning,
  getBubbleSplitConfidence,
  trainBubbleSplitLearning,
  findCandidateForBounds,
  createManualBubble,
  createSplitBubbles,
} from "../../bubbleDetection";

const SNAPSHOT_MAX_DIM = 1500;
const LEARNING_STORAGE_KEY = "bubbleDetectionLearning";

const BubbleDetectTrainerModal = React.memo(function BubbleDetectTrainerModal() {
  const context = useContext(() => ({}));
  const [phase, setPhase] = React.useState("pick");
  const [files, setFiles] = React.useState([]);
  const [fileIndex, setFileIndex] = React.useState(0);
  const [snapshot, setSnapshot] = React.useState(null);
  const [rawBubbles, setRawBubbles] = React.useState([]);
  const [excluded, setExcluded] = React.useState({});
  const [sensitivity, setSensitivity] = React.useState(5);
  const [selectionError, setSelectionError] = React.useState(false);
  const [trainedPages, setTrainedPages] = React.useState(0);
  const [learning, setLearning] = React.useState(() => normalizeBubbleLearning(readStorage(LEARNING_STORAGE_KEY)));
  const fileInputRef = React.useRef(null);
  const imageDataRef = React.useRef(null);
  const candidatesRef = React.useRef([]);
  const learningRef = React.useRef(learning);
  const activeRef = React.useRef(true);
  const manualIdRef = React.useRef(0);

  React.useEffect(() => () => {
    activeRef.current = false;
    closeBubbleTrainingDocument();
  }, []);

  const close = React.useCallback(() => {
    activeRef.current = false;
    closeBubbleTrainingDocument();
    context.dispatch({ type: "setModal" });
  }, [context.dispatch]);

  const runDetection = React.useCallback((pixels, sensitivityValue) => {
    const options = { ...getDetectionOptions(sensitivityValue), detectSplits: true };
    const threshold = getBubbleConfidenceThreshold(sensitivityValue);
    const candidates = detectBubbleCandidates(pixels, options).map((bubble, index) => ({
      ...bubble,
      id: `auto-${index}`,
      confidence: getBubbleConfidence(bubble, pixels, learningRef.current),
    }));
    candidatesRef.current = candidates;
    const displayed = [];
    candidates.filter((bubble) => bubble.confidence >= threshold).forEach((bubble) => {
      if (bubble.splitSuggestion && getBubbleSplitConfidence(bubble.splitSuggestion, learningRef.current) >= 0.62) {
        const children = createSplitBubbles(bubble, pixels);
        if (children.length === 2) {
          children.forEach((child, childIndex) => displayed.push({
            ...child,
            id: `${bubble.id}-split-${childIndex}`,
            splitGroup: bubble.id,
            splitParent: bubble,
          }));
          return;
        }
      }
      displayed.push(bubble);
    });
    setRawBubbles(displayed);
    setExcluded({});
    setSelectionError(false);
  }, []);

  const decodeSnapshot = React.useCallback((result) => {
    const read = window.cep.fs.readFile(result.path, window.cep.encoding.Base64);
    if (!read || read.err || !read.data) {
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
        setPhase("error");
      }
    };
    image.onerror = () => activeRef.current && setPhase("error");
    image.src = "data:image/png;base64," + read.data;
  }, [runDetection, sensitivity]);

  const loadFile = React.useCallback((index, selectedFiles) => {
    const batch = selectedFiles || files;
    if (!batch[index]) {
      closeBubbleTrainingDocument();
      setPhase("done");
      return;
    }
    setFileIndex(index);
    setSnapshot(null);
    setRawBubbles([]);
    setExcluded({});
    setPhase("scanning");
    openBubbleTrainingDocument(batch[index].path, SNAPSHOT_MAX_DIM, (result) => {
      if (!activeRef.current) return;
      if (!result || result.error || !result.path) {
        setPhase("error");
        return;
      }
      decodeSnapshot(result);
    });
  }, [files, decodeSnapshot]);

  React.useEffect(() => {
    if (phase !== "ready" || !imageDataRef.current) return undefined;
    const timer = setTimeout(() => runDetection(imageDataRef.current, sensitivity), 150);
    return () => clearTimeout(timer);
  }, [sensitivity]);

  const pickFiles = React.useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }, []);

  const onFilesPicked = React.useCallback((event) => {
    const selectedFiles = Array.from(event.target.files || [])
      .filter((file) => /\.psd$/i.test(file.name))
      .map((file) => ({ name: file.name, path: file.path || file.name }))
      .sort((first, second) => first.name.localeCompare(second.name, undefined, { numeric: true, sensitivity: "base" }));
    if (!selectedFiles.length) return;
    setFiles(selectedFiles);
    setTrainedPages(0);
    loadFile(0, selectedFiles);
  }, [loadFile]);

  const toggleBubble = React.useCallback((id) => {
    setExcluded((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const splitBubble = React.useCallback((bubble) => {
    if (!imageDataRef.current || !bubble.splitSuggestion) return;
    const children = createSplitBubbles(bubble, imageDataRef.current);
    if (children.length !== 2) return;
    setRawBubbles((current) => current.flatMap((item) => item.id === bubble.id
      ? children.map((child, childIndex) => ({
        ...child,
        id: `${bubble.id}-split-${Date.now()}-${childIndex}`,
        splitGroup: bubble.id,
        splitParent: bubble,
      }))
      : item));
    setExcluded((current) => {
      const next = { ...current };
      delete next[bubble.id];
      return next;
    });
  }, []);

  const mergeBubble = React.useCallback((bubble) => {
    if (!bubble.splitParent || !bubble.splitGroup) return;
    setRawBubbles((current) => {
      const firstIndex = current.findIndex((item) => item.splitGroup === bubble.splitGroup);
      return current.reduce((result, item, index) => {
        if (index === firstIndex) result.push(bubble.splitParent);
        if (item.splitGroup !== bubble.splitGroup) result.push(item);
        return result;
      }, []);
    });
    setExcluded((current) => {
      const next = { ...current };
      rawBubbles.forEach((item) => {
        if (item.splitGroup === bubble.splitGroup) delete next[item.id];
      });
      return next;
    });
  }, [rawBubbles]);

  const addCurrentSelection = React.useCallback(() => {
    if (!snapshot || !imageDataRef.current) return;
    getCurrentSelection((selection) => {
      if (!selection || !activeRef.current) {
        setSelectionError(true);
        return;
      }
      const bounds = {
        left: selection.left * snapshot.imageWidth / snapshot.docWidth,
        top: selection.top * snapshot.imageHeight / snapshot.docHeight,
        right: selection.right * snapshot.imageWidth / snapshot.docWidth,
        bottom: selection.bottom * snapshot.imageHeight / snapshot.docHeight,
      };
      const existing = findCandidateForBounds(rawBubbles, bounds);
      if (existing) {
        setExcluded((current) => ({ ...current, [existing.id]: false }));
      } else {
        const matchedCandidate = findCandidateForBounds(candidatesRef.current, bounds);
        const bubble = {
          ...createManualBubble(bounds, imageDataRef.current, matchedCandidate),
          id: `manual-${Date.now()}-${manualIdRef.current++}`,
        };
        setRawBubbles((current) => current.concat(bubble));
      }
      setSelectionError(false);
    });
  }, [snapshot, rawBubbles]);

  const saveTraining = React.useCallback(() => {
    const classification = {};
    const splitPositives = {};
    const splitNegatives = {};
    rawBubbles.forEach((bubble) => {
      const source = bubble.splitParent || bubble;
      const entry = classification[source.id] || { bubble: source, positive: false };
      if (!excluded[bubble.id]) entry.positive = true;
      classification[source.id] = entry;
      if (bubble.splitParent && !excluded[bubble.id]) {
        splitPositives[source.id] = source.splitSuggestion;
      } else if (!bubble.splitParent && source.splitSuggestion && !excluded[bubble.id]) {
        splitNegatives[source.id] = source.splitSuggestion;
      }
    });
    const entries = Object.keys(classification).map((key) => classification[key]);
    const positives = entries.filter((entry) => entry.positive).map((entry) => entry.bubble.features);
    const negatives = entries.filter((entry) => !entry.positive).map((entry) => entry.bubble.features);
    let next = learningRef.current;
    if (negatives.length) next = trainBubbleLearning(next, negatives, false);
    if (positives.length) next = trainBubbleLearning(next, positives, true);
    const negativeSplits = Object.keys(splitNegatives)
      .filter((key) => !splitPositives[key])
      .map((key) => splitNegatives[key]);
    if (negativeSplits.length) next = trainBubbleSplitLearning(next, negativeSplits, false);
    const positiveSplits = Object.keys(splitPositives).map((key) => splitPositives[key]);
    if (positiveSplits.length) next = trainBubbleSplitLearning(next, positiveSplits, true);
    learningRef.current = next;
    setLearning(next);
    writeToStorage({ [LEARNING_STORAGE_KEY]: next });
    setTrainedPages((count) => count + 1);
    loadFile(fileIndex + 1);
  }, [rawBubbles, excluded, loadFile, fileIndex]);

  const skipFile = React.useCallback(() => loadFile(fileIndex + 1), [loadFile, fileIndex]);

  const resetLearning = React.useCallback(() => {
    const next = normalizeBubbleLearning(null);
    learningRef.current = next;
    setLearning(next);
    writeToStorage({ [LEARNING_STORAGE_KEY]: next });
    if (imageDataRef.current) runDetection(imageDataRef.current, sensitivity);
  }, [runDetection, sensitivity]);

  const renderOverlay = () => {
    if (!snapshot) return null;
    return rawBubbles.map((bubble) => {
      const isExcluded = !!excluded[bubble.id];
      return (
        <div
          key={bubble.id}
          className={"bubble-detect-box" + (isExcluded ? " m-excluded" : "")}
          style={{
            left: `${bubble.left / snapshot.imageWidth * 100}%`,
            top: `${bubble.top / snapshot.imageHeight * 100}%`,
            width: `${bubble.width / snapshot.imageWidth * 100}%`,
            height: `${bubble.height / snapshot.imageHeight * 100}%`,
          }}
          title={isExcluded ? locale.bubbleTrainerRestore : locale.bubbleTrainerReject}
          onClick={() => toggleBubble(bubble.id)}
        >
          <span className="bubble-detect-badge">{isExcluded ? "×" : "✓"}</span>
          {!isExcluded && bubble.splitSuggestion && !bubble.splitParent && (
            <button
              className="bubble-trainer-split-action"
              title={locale.bubbleTrainerSplit}
              onClick={(event) => {
                event.stopPropagation();
                splitBubble(bubble);
              }}
            >
              <FiScissors size={12} />
            </button>
          )}
          {!isExcluded && bubble.splitParent && (
            <button
              className="bubble-trainer-split-action"
              title={locale.bubbleTrainerMerge}
              onClick={(event) => {
                event.stopPropagation();
                mergeBubble(bubble);
              }}
            >
              <FiGitMerge size={12} />
            </button>
          )}
        </div>
      );
    });
  };

  const currentFile = files[fileIndex];
  const positiveCount = rawBubbles.filter((bubble) => !excluded[bubble.id]).length;
  const negativeCount = rawBubbles.length - positiveCount;

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.bubbleTrainerTitle}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner bubble-detect bubble-trainer">
          <input ref={fileInputRef} type="file" multiple accept=".psd" style={{ display: "none" }} onChange={onFilesPicked} />
          {phase === "pick" && (
            <div className="bubble-detect-status">
              <FiFolder size={30} />
              <span>{locale.bubbleTrainerIntro}</span>
              <button className="topcoat-button--large--cta" onClick={pickFiles}>
                <FiFolder size={15} /> {locale.bubbleTrainerPick}
              </button>
            </div>
          )}
          {phase === "scanning" && (
            <div className="bubble-detect-status">
              <span>{locale.bubbleTrainerOpening
                .replace("{current}", fileIndex + 1)
                .replace("{total}", files.length)
                .replace("{file}", currentFile?.name || "")}</span>
            </div>
          )}
          {phase === "error" && (
            <div className="bubble-detect-status">
              <span>{locale.bubbleTrainerOpenError.replace("{file}", currentFile?.name || "")}</span>
              <button className="topcoat-button--large" onClick={skipFile}>{locale.bubbleTrainerSkip}</button>
            </div>
          )}
          {phase === "ready" && snapshot && (
            <React.Fragment>
              <div className="bubble-trainer-progress">
                <strong>{fileIndex + 1}/{files.length}</strong>
                <span>{currentFile?.name}</span>
                <span>{locale.bubbleTrainerModelStats
                  .replace("{positive}", learning.positiveSamples)
                  .replace("{negative}", learning.negativeSamples)}</span>
              </div>
              <div className="bubble-detect-toolbar">
                <div className="bubble-detect-toolbar-group">
                  <span className="bubble-detect-toolbar-label">{locale.bubbleDetectSensitivity}</span>
                  <input type="range" min={1} max={9} value={sensitivity} onChange={(event) => setSensitivity(parseInt(event.target.value, 10))} />
                </div>
                <div className="bubble-detect-toolbar-group">
                  <button className="topcoat-button--large" onClick={addCurrentSelection} title={locale.bubbleDetectAddCurrentDescr}>
                    <FiCrosshair size={14} /> {locale.bubbleDetectAddCurrent}
                  </button>
                  <button
                    className="topcoat-icon-button--large"
                    title={locale.bubbleDetectResetLearning.replace("{count}", learning.examples.length)}
                    disabled={!learning.examples.length}
                    onClick={resetLearning}
                  >
                    <FiRotateCcw size={14} />
                  </button>
                </div>
              </div>
              <div className="bubble-detect-hint">{locale.bubbleTrainerHint}</div>
              <div className="bubble-detect-hint">
                {locale.bubbleTrainerSplitHint
                  .replace("{positive}", learning.splitPositiveSamples)
                  .replace("{negative}", learning.splitNegativeSamples)}
              </div>
              {selectionError && <div className="bubble-detect-selection-error">{locale.bubbleDetectSelectionError}</div>}
              <div className="bubble-detect-count">
                {locale.bubbleTrainerLabels.replace("{positive}", positiveCount).replace("{negative}", negativeCount)}
              </div>
              <div className="bubble-detect-stage hostBrdContrast">
                <img src={snapshot.dataUrl} alt="" draggable={false} />
                {renderOverlay()}
              </div>
            </React.Fragment>
          )}
          {phase === "done" && (
            <div className="bubble-detect-status">
              <FiCheckCircle size={30} />
              <span>{locale.bubbleTrainerDone.replace("{count}", trainedPages)}</span>
              <button className="topcoat-button--large" onClick={pickFiles}>
                <FiRefreshCw size={14} /> {locale.bubbleTrainerPickAgain}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast bubble-detect-footer">
        <button className="topcoat-button--large" onClick={close}>{locale.close}</button>
        {phase === "ready" && (
          <React.Fragment>
            <button className="topcoat-button--large" onClick={skipFile}>{locale.bubbleTrainerSkip}</button>
            <button className="topcoat-button--large--cta" onClick={saveTraining} disabled={!rawBubbles.length}>
              <FiCheckCircle size={15} /> {locale.bubbleTrainerTrain}
            </button>
          </React.Fragment>
        )}
      </div>
    </React.Fragment>
  );
});

export default BubbleDetectTrainerModal;
