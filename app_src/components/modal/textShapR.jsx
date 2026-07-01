import "./textShapR.scss";

import React from "react";
import { FiArrowRightCircle, FiCheck, FiX } from "react-icons/fi";

import { locale, setActiveLayerText, getStyleObject, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { getScaledStyle } from "../../textLayerPayload";
import { generateTextShapRVariants } from "../../textShapR";

const PROFILE_OPTIONS = [
  { id: "balanced", labelKey: "textShapRProfileBalanced", fallback: "Balanced" },
  { id: "round", labelKey: "textShapRProfileRound", fallback: "Round" },
  { id: "tall", labelKey: "textShapRProfileTall", fallback: "Tall" },
  { id: "wide", labelKey: "textShapRProfileWide", fallback: "Wide" },
];

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

  React.useEffect(() => {
    const handleKeyDown = (event) => {
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
  }, [applyingId, applyVariant, selectedVariant, variants]);

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.textShapRTitle || "TextShapR"}</div>
        <button className="topcoat-icon-button" onClick={close} title={locale.close || "Close"}>
          <FiX size={14} />
        </button>
      </div>
      <div className="app-modal-body textshapr-modal-body">
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
      </div>
      <div className="app-modal-footer hostBrdTopContrast textshapr-footer">
        <div>{locale.textShapRFooter || "Click a shape to test it. Shift+number applies and advances."}</div>
        <div className="textshapr-footer-actions">
          <button className="topcoat-button" onClick={() => applyVariant(selectedVariant)} disabled={!selectedVariant || !!applyingId}>
            <FiCheck size={13} /> {locale.textShapRApplyShort || "Apply"}
          </button>
          <button className="topcoat-button--cta" onClick={() => applyVariant(selectedVariant, true)} disabled={!selectedVariant || !!applyingId}>
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

export default TextShapRModal;
