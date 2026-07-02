import "./textShapeR.scss";

import React from "react";
import { FiArrowRightCircle, FiCheck, FiRefreshCw, FiX } from "react-icons/fi";

import { csInterface, locale, setActiveLayerText, getStyleObject, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { getScaledStyle } from "../../textLayerPayload";
import { estimateManualLineCount, generateManualTextShapeRVariant, generateTextShapeRVariants } from "../../textShapeR";
import TextShapeRFitPreview from "../textShapeRFitPreview";

const PROFILE_OPTIONS = [
  { id: "balanced", labelKey: "textShapeRProfileBalanced", fallback: "Balanced" },
  { id: "round", labelKey: "textShapeRProfileRound", fallback: "Round" },
  { id: "tall", labelKey: "textShapeRProfileTall", fallback: "Tall" },
  { id: "wide", labelKey: "textShapeRProfileWide", fallback: "Wide" },
];

const MANUAL_SHAPES = [
  { id: "selection", labelKey: "textShapeRManualShapeSelection", fallback: "Selection" },
  { id: "sine", labelKey: "textShapeRManualShapeSine", fallback: "Sine" },
  { id: "ellipse", labelKey: "textShapeRManualShapeEllipse", fallback: "Ellipse" },
  { id: "diamond", labelKey: "textShapeRManualShapeDiamond", fallback: "Diamond" },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getSelectionShape = (callback) => {
  const payload = JSON.stringify({ samples: 21 });
  csInterface.evalScript(`getCurrentSelectionShape(${payload})`, (result) => {
    try {
      const data = JSON.parse(result || "{}");
      callback(data && !data.error ? data : null);
    } catch (error) {
      callback(null);
    }
  });
};

const normalizeLayerText = (text) => String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();

const getActiveTextLayerSource = (callback) => {
  csInterface.evalScript("getActiveLayerText()", (result) => {
    try {
      const data = JSON.parse(result || "{}");
      if (!data?.textProps?.layerText) {
        callback(null);
        return;
      }
      callback({
        text: normalizeLayerText(data.textProps.layerText.textKey),
        style: {
          textProps: data.textProps,
          stroke: data.stroke || null,
        },
      });
    } catch (error) {
      callback(null);
    }
  });
};

const renderMarkdownText = (text, markdownEnabled) => {
  if (!markdownEnabled) return text;
  const parsed = parseMarkdownRuns(text || "");
  if (!parsed.hasFormatting) return parsed.text;
  return parsed.runs.map((run, index) => {
    const style = {};
    if (run.bold) style.fontWeight = "bold";
    if (run.italic) style.fontStyle = "italic";
    return (
      <span key={`textshaper-md-${index}`} style={style}>
        {run.text}
      </span>
    );
  });
};

const TextShapeRModal = React.memo(function TextShapeRModal() {
  const context = useContext();
  const line = context.state.currentLine || { text: "" };
  const textBlockStyle = context.state.currentStyle || {};
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const [applyingId, setApplyingId] = React.useState(null);
  const [profile, setProfile] = React.useState("balanced");
  const [allowHyphenation, setAllowHyphenation] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState(null);
  const [textSource, setTextSource] = React.useState("textblock");
  const [layerSource, setLayerSource] = React.useState({
    text: "",
    style: null,
    loading: false,
    error: "",
  });
  const [mode, setMode] = React.useState("auto");
  const [manualStatus, setManualStatus] = React.useState("");
  const sourceText = textSource === "layer" ? layerSource.text : line.text;
  const sourceStyle = textSource === "layer" && layerSource.style ? layerSource.style : textBlockStyle;
  const textStyle = sourceStyle.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const [manualSettings, setManualSettings] = React.useState(() => {
    const width = 320;
    const height = 280;
    return {
      shape: "selection",
      width,
      height,
      shapeProfile: null,
      softness: 0.6,
      floor: 0.15,
      lineCount: estimateManualLineCount(line.text, width, height),
    };
  });

  // Auto mode adapts variants to the active selection outline when one exists
  const [autoShape, setAutoShape] = React.useState(null);
  React.useEffect(() => {
    getSelectionShape((selectionShape) => {
      if (selectionShape?.bounds) setAutoShape(selectionShape);
    });
  }, []);

  const variants = React.useMemo(
    () => generateTextShapeRVariants(sourceText, {
      limit: 10,
      allowHyphenation,
      profile,
      shapeProfile: autoShape,
      width: autoShape?.bounds?.width,
      height: autoShape?.bounds?.height,
    }),
    [sourceText, allowHyphenation, profile, autoShape]
  );

  React.useEffect(() => {
    setSelectedId((currentId) => {
      if (variants.find((variant) => variant.id === currentId)) return currentId;
      return variants[0]?.id || null;
    });
  }, [variants]);

  const close = React.useCallback(() => {
    context.dispatch({ type: "setModal" });
  }, [context.dispatch]);

  const selectedVariant = variants.find((variant) => variant.id === selectedId) || variants[0] || null;
  const manualVariant = React.useMemo(
    () => generateManualTextShapeRVariant(sourceText, manualSettings),
    [sourceText, manualSettings]
  );

  React.useEffect(() => {
    setManualSettings((current) => ({
      ...current,
      lineCount: clamp(current.lineCount || estimateManualLineCount(sourceText, current.width, current.height), 1, 8),
    }));
  }, [sourceText]);

  const refreshLayerSource = React.useCallback(() => {
    setLayerSource((current) => ({ ...current, loading: true, error: "" }));
    getActiveTextLayerSource((source) => {
      if (!source?.text) {
        setLayerSource({
          text: "",
          style: null,
          loading: false,
          error: locale.textShapeRLayerNoText || "Select a Photoshop text layer first.",
        });
        return;
      }
      setLayerSource({
        text: source.text,
        style: source.style,
        loading: false,
        error: "",
      });
      setManualSettings((current) => ({
        ...current,
        lineCount: estimateManualLineCount(source.text, current.width, current.height),
      }));
    });
  }, []);

  const setSourceMode = React.useCallback((source) => {
    setTextSource(source);
    if (source === "layer") {
      refreshLayerSource();
    }
  }, [refreshLayerSource]);

  const applyVariant = React.useCallback(
    (variant, advance = false) => {
      if (!variant || applyingId) return;
      setSelectedId(variant.id);
      setApplyingId(variant.id);
      const lineStyle = getScaledStyle(sourceStyle, context.state.textScale);
      setActiveLayerText(variant.text, lineStyle, context.state.direction, (ok) => {
        setApplyingId(null);
        if (!ok) return;
        setSelectedId(variant.id);
        if (advance) {
          context.dispatch({ type: "setModal" });
          context.dispatch({ type: "nextLine", add: true });
        }
      });
    },
    [applyingId, context, sourceStyle]
  );

  const updateManualSetting = React.useCallback((field, value) => {
    setManualSettings((current) => ({ ...current, [field]: value }));
  }, []);

  const scanSelection = React.useCallback(() => {
    setManualStatus(locale.textShapeRManualScanning || "Scanning selection...");
    getSelectionShape((selectionShape) => {
      if (!selectionShape?.bounds) {
        setManualStatus(locale.textShapeRManualNoSelection || "No active Photoshop selection.");
        return;
      }
      const selection = selectionShape.bounds;
      const width = clamp(Math.round(selection.width || 320), 80, 1200);
      const height = clamp(Math.round(selection.height || 280), 80, 1200);
      setManualSettings((current) => ({
        ...current,
        shape: "selection",
        shapeProfile: selectionShape,
        width,
        height,
        lineCount: estimateManualLineCount(sourceText, width, height),
      }));
      const statusKey = selectionShape.fallback ? "textShapeRManualSelectionBoundsLoaded" : "textShapeRManualSelectionLoaded";
      setManualStatus((locale[statusKey] || locale.textShapeRManualSelectionLoaded || "Selection {width}x{height} loaded.")
        .replace("{width}", width)
        .replace("{height}", height));
    });
  }, [sourceText]);

  React.useEffect(() => {
    if (mode === "manual" && !manualStatus) {
      scanSelection();
    }
  }, [manualStatus, mode, scanSelection]);

  const sourceStatus = textSource === "layer"
    ? layerSource.loading
      ? (locale.textShapeRLayerLoading || "Reading selected layer...")
      : layerSource.error || (layerSource.text ? (locale.textShapeRLayerLoaded || "Selected layer loaded.") : "")
    : "";

  React.useEffect(() => {
    const handleKeyDown = (event) => {
      if (mode !== "auto") return;
      if (!variants.length || applyingId) return;
      const target = event.target;
      const tagName = target && target.tagName;
      if (target?.isContentEditable || tagName === "INPUT" || tagName === "BUTTON" || tagName === "SELECT" || tagName === "TEXTAREA") {
        return;
      }
      const key = event.key;
      let targetIndex = -1;
      if (/^[1-9]$/.test(key)) targetIndex = Number(key) - 1;
      else if (key === "0") targetIndex = 9;
      else if (key === "Enter") {
        event.preventDefault();
        applyVariant(selectedVariant, event.shiftKey);
        return;
      } else {
        return;
      }
      const variant = variants[targetIndex];
      if (!variant) return;
      event.preventDefault();
      applyVariant(variant, event.shiftKey);
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [applyingId, applyVariant, mode, selectedVariant, variants]);

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.textShapeRTitle || "TextShapeR"}</div>
        <div className="textshaper-mode-tabs">
          <button className={mode === "auto" ? "is-active" : ""} onClick={() => setMode("auto")}>
            {locale.textShapeRAutoMode || "Auto"}
          </button>
          <button className={mode === "manual" ? "is-active" : ""} onClick={() => setMode("manual")}>
            {locale.textShapeRManualMode || "Manual"}
          </button>
        </div>
        <button className="topcoat-icon-button" onClick={close} title={locale.close || "Close"}>
          <FiX size={14} />
        </button>
      </div>
      <div className="app-modal-body textshaper-modal-body">
        <div className="textshaper-source-bar hostBrdBotContrast">
          <div className="textshaper-source-tabs" role="tablist">
            <button
              type="button"
              className={textSource === "textblock" ? "is-active" : ""}
              onClick={() => setSourceMode("textblock")}
            >
              {locale.textShapeRSourceTextBlock || "Block"}
            </button>
            <button
              type="button"
              className={textSource === "layer" ? "is-active" : ""}
              onClick={() => setSourceMode("layer")}
            >
              {locale.textShapeRSourceLayer || "Layer"}
            </button>
          </div>
          {textSource === "layer" && (
            <button
              className="topcoat-icon-button"
              type="button"
              onClick={refreshLayerSource}
              disabled={layerSource.loading}
              title={locale.textShapeRLayerRefresh || "Refresh selected layer"}
            >
              <FiRefreshCw size={13} />
            </button>
          )}
          {sourceStatus && <div className="textshaper-source-status">{sourceStatus}</div>}
        </div>
        {mode === "auto" ? (
          <React.Fragment>
            <div className="textshaper-controls hostBrdBotContrast">
              <div className="textshaper-profile-tabs" role="tablist">
                {PROFILE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={"textshaper-profile-tab" + (profile === option.id ? " is-active" : "")}
                    onClick={() => setProfile(option.id)}
                  >
                    {locale[option.labelKey] || option.fallback}
                  </button>
                ))}
              </div>
              <label className="textshaper-hyphen-toggle">
                <input
                  type="checkbox"
                  checked={allowHyphenation}
                  onChange={(event) => setAllowHyphenation(event.target.checked)}
                />
                <span>{locale.textShapeRHyphenToggle || "Hyphenation"}</span>
              </label>
              {autoShape ? (
                <span
                  className="textshaper-shape-badge"
                  title={locale.textShapeRShapeActive || "Shapes follow the current selection outline"}
                >
                  {locale.textShapeRShapeBadge || "Selection"}
                </span>
              ) : null}
            </div>
            <div className="textshaper-grid">
              {variants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={
                    "textshaper-tile hostBgdDark" +
                    (applyingId === variant.id ? " is-applying" : "") +
                    (selectedId === variant.id ? " is-selected" : "")
                  }
                  onClick={() => applyVariant(variant)}
                  title={locale.textShapeRApply || "Apply this shape"}
                >
                  <span className="textshaper-tile-rank">{index + 1}</span>
                  <TextShapeRFitPreview
                    outerClassName="textshaper-tile-text"
                    innerClassName="textshaper-tile-fit"
                    contentKey={`${variant.text}|${markdownEnabled}|${styleObject.fontFamily || ""}`}
                    style={{ ...styleObject, fontFamily: styleObject.fontFamily || "Tahoma" }}
                  >
                    {variant.lines.map((variantLine, lineIndex) => (
                      <span key={`${variant.id}-${lineIndex}`} className="textshaper-line">
                        {renderMarkdownText(variantLine, markdownEnabled)}
                      </span>
                    ))}
                  </TextShapeRFitPreview>
                  {variant.hyphenCount > 0 && (
                    <span className="textshaper-hyphen">{locale.textShapeRHyphenated || "hyphen"}</span>
                  )}
                </button>
              ))}
            </div>
            {!variants.length && (
              <div className="textshaper-empty">{locale.textShapeREmpty || "No text available for TextShapeR."}</div>
            )}
          </React.Fragment>
        ) : (
          <div className="textshaper-manual">
            <div className="textshaper-manual-toolbar hostBrdBotContrast">
              <div className="textshaper-shape-tabs">
                {MANUAL_SHAPES.map((shapeOption) => (
                  <button
                    key={shapeOption.id}
                    type="button"
                    className={manualSettings.shape === shapeOption.id ? "is-active" : ""}
                    onClick={() => updateManualSetting("shape", shapeOption.id)}
                  >
                    {locale[shapeOption.labelKey] || shapeOption.fallback}
                  </button>
                ))}
              </div>
              <button className="topcoat-button" onClick={scanSelection}>
                <FiRefreshCw size={13} /> {locale.textShapeRManualUseSelection || "Selection"}
              </button>
            </div>
            <ManualPreview
              variant={manualVariant}
              settings={manualSettings}
              styleObject={styleObject}
              markdownEnabled={markdownEnabled}
            />
            <div className="textshaper-manual-status">{manualStatus || (locale.textShapeRManualHint || "Use the current Photoshop selection as the bubble size.")}</div>
            <div className="textshaper-manual-controls">
              <ManualSlider label={locale.textShapeRManualWidth || "Width"} value={manualSettings.width} min={80} max={1200} step={1} onChange={(value) => updateManualSetting("width", value)} />
              <ManualSlider label={locale.textShapeRManualHeight || "Height"} value={manualSettings.height} min={80} max={1200} step={1} onChange={(value) => updateManualSetting("height", value)} />
              <ManualSlider label={locale.textShapeRManualLines || "Lines"} value={manualSettings.lineCount} min={1} max={8} step={1} onChange={(value) => updateManualSetting("lineCount", value)} />
              <ManualSlider label={locale.textShapeRManualSoftness || "Softness"} value={manualSettings.softness} min={0.2} max={1.2} step={0.01} digits={2} onChange={(value) => updateManualSetting("softness", value)} />
              <ManualSlider label={locale.textShapeRManualEdge || "Edge"} value={manualSettings.floor} min={0} max={0.5} step={0.01} digits={2} onChange={(value) => updateManualSetting("floor", value)} />
            </div>
          </div>
        )}
      </div>
      <div className="app-modal-footer hostBrdTopContrast textshaper-footer">
        <div>{locale.textShapeRFooter || "Click a shape to test it. Shift+number applies and advances."}</div>
        <div className="textshaper-footer-actions">
          <button className="topcoat-button" onClick={() => applyVariant(mode === "manual" ? manualVariant : selectedVariant)} disabled={!(mode === "manual" ? manualVariant : selectedVariant) || !!applyingId}>
            <FiCheck size={13} /> {locale.textShapeRApplyShort || "Apply"}
          </button>
          <button className="topcoat-button--cta" onClick={() => applyVariant(mode === "manual" ? manualVariant : selectedVariant, true)} disabled={!(mode === "manual" ? manualVariant : selectedVariant) || !!applyingId}>
            <FiArrowRightCircle size={13} /> {locale.textShapeRApplyNext || "Apply + next"}
          </button>
          <button className="topcoat-button" onClick={close}>
            <FiX size={13} /> {locale.close || "Close"}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
});

const ManualSlider = React.memo(function ManualSlider({ label, value, min, max, step, digits = 0, onChange }) {
  const displayValue = digits ? Number(value).toFixed(digits) : Math.round(value);
  return (
    <label className="textshaper-manual-slider">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <b>{displayValue}</b>
    </label>
  );
});

const ManualPreview = React.memo(function ManualPreview({ variant, settings, styleObject, markdownEnabled }) {
  const width = Math.max(80, settings.width || 320);
  const height = Math.max(80, settings.height || 280);
  const scale = Math.min(1, 270 / width, 150 / height);
  const previewWidth = Math.round(width * scale);
  const previewHeight = Math.round(height * scale);
  const shapeRows = Array.isArray(settings.shapeProfile?.rows) ? settings.shapeProfile.rows.filter((row) => row.width > 0) : [];
  const selectionPoints = shapeRows.length
    ? shapeRows
      .map((row) => `${Math.round((row.left || 0) * previewWidth)},${Math.round((row.y || 0) * previewHeight)}`)
      .concat(
        shapeRows
          .slice()
          .reverse()
          .map((row) => `${Math.round((row.right || 0) * previewWidth)},${Math.round((row.y || 0) * previewHeight)}`)
      )
      .join(" ")
    : "";
  const bubbleStyle = {
    width: `${previewWidth}px`,
    height: `${previewHeight}px`,
  };
  if (settings.shape === "diamond") {
    bubbleStyle.transform = "rotate(45deg) scale(0.72)";
  } else {
    bubbleStyle.borderRadius = "50%";
  }

  return (
    <div className="textshaper-manual-preview">
      <div className="textshaper-manual-stage" style={{ width: previewWidth, height: previewHeight }}>
        {settings.shape === "selection" && selectionPoints ? (
          <svg className="textshaper-manual-selection" viewBox={`0 0 ${previewWidth} ${previewHeight}`} preserveAspectRatio="none">
            <polygon points={selectionPoints} />
          </svg>
        ) : (
          <div className="textshaper-manual-bubble" style={bubbleStyle} />
        )}
        <div className="textshaper-manual-text" style={styleObject}>
          <TextShapeRFitPreview
            outerClassName="textshaper-manual-fit-outer"
            innerClassName="textshaper-manual-fit"
            contentKey={`${(variant?.lines || []).join("\n")}|${markdownEnabled}|${styleObject.fontFamily || ""}`}
            style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}
          >
            {(variant?.lines || []).map((variantLine, lineIndex) => (
              <span key={`manual-${lineIndex}`} className="textshaper-line">
                {renderMarkdownText(variantLine, markdownEnabled)}
              </span>
            ))}
          </TextShapeRFitPreview>
        </div>
      </div>
    </div>
  );
});

export default TextShapeRModal;
