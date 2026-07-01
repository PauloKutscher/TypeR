import "./textShapR.scss";

import React from "react";
import { FiCheck, FiX } from "react-icons/fi";

import { locale, setActiveLayerText, getStyleObject, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";
import { getScaledStyle } from "../../textLayerPayload";
import { generateTextShapRVariants } from "../../textShapR";

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

  const variants = React.useMemo(
    () => generateTextShapRVariants(line.text, { limit: 10, allowHyphenation: true }),
    [line.text]
  );

  const close = React.useCallback(() => {
    context.dispatch({ type: "setModal" });
  }, [context.dispatch]);

  const applyVariant = React.useCallback(
    (variant) => {
      if (!variant || applyingId) return;
      setApplyingId(variant.id);
      const lineStyle = getScaledStyle(context.state.currentStyle, context.state.textScale);
      setActiveLayerText(variant.text, lineStyle, context.state.direction, (ok) => {
        setApplyingId(null);
        if (!ok) return;
        context.dispatch({ type: "setModal" });
        context.dispatch({ type: "nextLine", add: true });
      });
    },
    [applyingId, context]
  );

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.textShapRTitle || "TextShapR"}</div>
        <button className="topcoat-icon-button" onClick={close} title={locale.close || "Close"}>
          <FiX size={14} />
        </button>
      </div>
      <div className="app-modal-body textshapr-modal-body">
        <div className="textshapr-grid">
          {variants.map((variant, index) => (
            <button
              key={variant.id}
              type="button"
              className={"textshapr-tile hostBgdDark" + (applyingId === variant.id ? " is-applying" : "")}
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
        <div>{locale.textShapRFooter || "Choose a shape to apply it to the active Photoshop text layer."}</div>
        <button className="topcoat-button" onClick={close}>
          <FiCheck size={13} /> {locale.close || "Close"}
        </button>
      </div>
    </React.Fragment>
  );
});

export default TextShapRModal;
