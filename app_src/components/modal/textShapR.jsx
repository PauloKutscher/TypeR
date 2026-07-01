import "./textShapR.scss";

import React from "react";
import { FiArrowRightCircle, FiCheck, FiRefreshCw, FiX } from "react-icons/fi";

import { locale, setActiveLayerText, getCurrentSelection, getStyleObject, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { getScaledStyle } from "../../textLayerPayload";
import { estimateManualLineCount, generateManualTextShapRVariant, generateTextShapRVariants } from "../../textShapR";

const PROFILE_OPTIONS = [
  { id: "balanced", labelKey: "textShapRProfileBalanced", fallback: "Balanced" },
  { id: "round", labelKey: "textShapRProfileRound", fallback: "Round" },
  { id: "tall", labelKey: "textShapRProfileTall", fallback: "Tall" },
  { id: "wide", labelKey: "textShapRProfileWide", fallback: "Wide" },
];

const MANUAL_SHAPES = [
  { id: "sine", labelKey: "textShapRManualShapeSine", fallback: "Sine" },
  { id: "ellipse", labelKey: "textShapRManualShapeEllipse", fallback: "Ellipse" },
  { id: "diamond", labelKey: "textShapRManualShapeDiamond", fallback: "Diamond" },
];

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const renderMarkdownText = (text, markdownEnabled) => {
  if (!markdownEnabled) return text;
  const parsed = parseMarkdownRuns(text || "");
  if (!parsed.hasFormatting) return parsed.text;
  return parsed.runs.map((run, index) => {
    const style = {};
    if (run.bold) style.fontWeight = "bold";
    if (run.italic) style.fontStyle = "italic";
    return (
      <span key={`textshapr-md-${index}`} style={style}>
        {run.text}
      </span>
    );
  });
};

const TextShapRModal = React.memo(function TextShapRModal() {
  const context = useContext();
  const line = context.state.currentLine || { text: "" };
  const style = context.state.currentStyle || {};
  const textStyle = style.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const styleObject = getStyleObject(textStyle);
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const [applyingId, setApplyingId] = React.useState(null);
  const [profile, setProfile] = React.useState("balanced");
  const [allowHyphenation, setAllowHyphenation] = React.useState(true);
  const [selectedId, setSelectedId] = React.useState(null);
  const [mode, setMode] = React.useState("auto");
  const [manualStatus, setManualStatus] = React.useState("");
  const [manualSettings, setManualSettings] = React.useState(() => {
    const width = 320;
    const height = 280;
    return {
      shape: "sine",
      width,
      height,
      softness: 0.6,
      floor: 0.15,
      lineCount: estimateManualLineCount(line.text, width, height),
    };
  });

  const variants = React.useMemo(
    () => generateTextShapRVariants(line.text, { limit: 10, allowHyphenation, profile }),
    [line.text, allowHyphenation, profile]
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
    () => generateManualTextShapRVariant(line.text, manualSettings),
    [line.text, manualSettings]
  );

  React.useEffect(() => {
    setManualSettings((current) => ({
      ...current,
      lineCount: clamp(current.lineCount || estimateManualLineCount(line.text, current.width, current.height), 1, 8),
    }));
  }, [line.text]);

  const applyVariant = React.useCallback(
    (variant, advance = false) => {
      if (!variant || applyingId) return;
      setSelectedId(variant.id);
      setApplyingId(variant.id);
      const lineStyle = getScaledStyle(context.state.currentStyle, context.state.textScale);
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
    [applyingId, context]
  );

  const updateManualSetting = React.useCallback((field, value) => {
    setManualSettings((current) => ({ ...current, [field]: value }));
  }, []);

  const scanSelection = React.useCallback(() => {
    setManualStatus(locale.textShapRManualScanning || "Scanning selection...");
    getCurrentSelection((selection) => {
      if (!selection) {
        setManualStatus(locale.textShapRManualNoSelection || "No active Photoshop selection.");
        return;
      }
      const width = clamp(Math.round(selection.width || 320), 80, 1200);
      const height = clamp(Math.round(selection.height || 280), 80, 1200);
      setManualSettings((current) => ({
        ...current,
        width,
        height,
        lineCount: estimateManualLineCount(line.text, width, height),
      }));
      setManualStatus((locale.textShapRManualSelectionLoaded || "Selection {width}x{height} loaded.")
        .replace("{width}", width)
        .replace("{height}", height));
    });
  }, [line.text]);

  React.useEffect(() => {
    if (mode === "manual" && !manualStatus) {
      scanSelection();
    }
  }, [manualStatus, mode, scanSelection]);

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
        <div className="app-modal-title">{locale.textShapRTitle || "TextShapR"}</div>
        <div className="textshapr-mode-tabs">
          <button className={mode === "auto" ? "is-active" : ""} onClick={() => setMode("auto")}>
            {locale.textShapRAutoMode || "Auto"}
          </button>
          <button className={mode === "manual" ? "is-active" : ""} onClick={() => setMode("manual")}>
            {locale.textShapRManualMode || "Manual"}
          </button>
        </div>
        <button className="topcoat-icon-button" onClick={close} title={locale.close || "Close"}>
          <FiX size={14} />
        </button>
      </div>
      <div className="app-modal-body textshapr-modal-body">
        {mode === "auto" ? (
          <React.Fragment>
            <div className="textshapr-controls hostBrdBotContrast">
              <div className="textshapr-profile-tabs" role="tablist">
                {PROFILE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={"textshapr-profile-tab" + (profile === option.id ? " is-active" : "")}
                    onClick={() => setProfile(option.id)}
                  >
                    {locale[option.labelKey] || option.fallback}
                  </button>
                ))}
              </div>
              <label className="textshapr-hyphen-toggle">
                <input
                  type="checkbox"
                  checked={allowHyphenation}
                  onChange={(event) => setAllowHyphenation(event.target.checked)}
                />
                <span>{locale.textShapRHyphenToggle || "Hyphenation"}</span>
              </label>
            </div>
            <div className="textshapr-grid">
              {variants.map((variant, index) => (
                <button
                  key={variant.id}
                  type="button"
                  className={
                    "textshapr-tile hostBgdDark" +
                    (applyingId === variant.id ? " is-applying" : "") +
                    (selectedId === variant.id ? " is-selected" : "")
                  }
                  onClick={() => applyVariant(variant)}
                  title={locale.textShapRApply || "Apply this shape"}
                >
                  <span className="textshapr-tile-rank">{index + 1}</span>
                  <span className="textshapr-tile-text" style={styleObject}>
                    <span style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}>
                      {variant.lines.map((variantLine, lineIndex) => (
                        <span key={`${variant.id}-${lineIndex}`} className="textshapr-line">
                          {renderMarkdownText(variantLine, markdownEnabled)}
                        </span>
                      ))}
                    </span>
                  </span>
                  {variant.hyphenCount > 0 && (
                    <span className="textshapr-hyphen">{locale.textShapRHyphenated || "hyphen"}</span>
                  )}
                </button>
              ))}
            </div>
            {!variants.length && (
              <div className="textshapr-empty">{locale.textShapREmpty || "No text available for TextShapR."}</div>
            )}
          </React.Fragment>
        ) : (
          <div className="textshapr-manual">
            <div className="textshapr-manual-toolbar hostBrdBotContrast">
              <div className="textshapr-shape-tabs">
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
                <FiRefreshCw size={13} /> {locale.textShapRManualUseSelection || "Selection"}
              </button>
            </div>
            <ManualPreview
              variant={manualVariant}
              settings={manualSettings}
              styleObject={styleObject}
              markdownEnabled={markdownEnabled}
            />
            <div className="textshapr-manual-status">{manualStatus || (locale.textShapRManualHint || "Use the current Photoshop selection as the bubble size.")}</div>
            <div className="textshapr-manual-controls">
              <ManualSlider label={locale.textShapRManualWidth || "Width"} value={manualSettings.width} min={80} max={1200} step={1} onChange={(value) => updateManualSetting("width", value)} />
              <ManualSlider label={locale.textShapRManualHeight || "Height"} value={manualSettings.height} min={80} max={1200} step={1} onChange={(value) => updateManualSetting("height", value)} />
              <ManualSlider label={locale.textShapRManualLines || "Lines"} value={manualSettings.lineCount} min={1} max={8} step={1} onChange={(value) => updateManualSetting("lineCount", value)} />
              <ManualSlider label={locale.textShapRManualSoftness || "Softness"} value={manualSettings.softness} min={0.2} max={1.2} step={0.01} digits={2} onChange={(value) => updateManualSetting("softness", value)} />
              <ManualSlider label={locale.textShapRManualEdge || "Edge"} value={manualSettings.floor} min={0} max={0.5} step={0.01} digits={2} onChange={(value) => updateManualSetting("floor", value)} />
            </div>
          </div>
        )}
      </div>
      <div className="app-modal-footer hostBrdTopContrast textshapr-footer">
        <div>{locale.textShapRFooter || "Click a shape to test it. Shift+number applies and advances."}</div>
        <div className="textshapr-footer-actions">
          <button className="topcoat-button" onClick={() => applyVariant(mode === "manual" ? manualVariant : selectedVariant)} disabled={!(mode === "manual" ? manualVariant : selectedVariant) || !!applyingId}>
            <FiCheck size={13} /> {locale.textShapRApplyShort || "Apply"}
          </button>
          <button className="topcoat-button--cta" onClick={() => applyVariant(mode === "manual" ? manualVariant : selectedVariant, true)} disabled={!(mode === "manual" ? manualVariant : selectedVariant) || !!applyingId}>
            <FiArrowRightCircle size={13} /> {locale.textShapRApplyNext || "Apply + next"}
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
    <label className="textshapr-manual-slider">
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
    <div className="textshapr-manual-preview">
      <div className="textshapr-manual-stage" style={{ width: previewWidth, height: previewHeight }}>
        <div className="textshapr-manual-bubble" style={bubbleStyle} />
        <div className="textshapr-manual-text" style={styleObject}>
          <span style={{ fontFamily: styleObject.fontFamily || "Tahoma" }}>
            {(variant?.lines || []).map((variantLine, lineIndex) => (
              <span key={`manual-${lineIndex}`} className="textshapr-line">
                {renderMarkdownText(variantLine, markdownEnabled)}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
});

export default TextShapRModal;
