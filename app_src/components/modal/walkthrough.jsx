import React from "react";
import {
  FiCheck,
  FiChevronLeft,
  FiChevronRight,
  FiMousePointer,
  FiRotateCw,
  FiSkipForward,
  FiType,
  FiX,
} from "react-icons/fi";

import { useContext } from "../../context";
import { locale } from "../../utils";

const SAMPLE_SCRIPT = "Page 1\nREG: This bubble is ready.\nSFX: BOOM!\n## translator note";

const hasSampleScript = (value) => /Page\s*1/i.test(value) && /REG:/i.test(value) && /SFX:/i.test(value);

const getSteps = () => [
  {
    id: "script",
    title: locale.walkthroughStepPasteTitle || "Paste your script",
    text:
      locale.walkthroughStepPasteText ||
      "Paste the translated script in the text block. TypeR splits it into lines, ignores empty lines, and keeps the active line highlighted.",
  },
  {
    id: "styles",
    title: locale.walkthroughStepStylesTitle || "Create and choose styles",
    text:
      locale.walkthroughStepStylesText ||
      "Create styles from an existing Photoshop text layer or set the values manually. Click a style to make it active.",
  },
  {
    id: "selection",
    title: locale.walkthroughStepSelectionTitle || "Select the bubble in Photoshop",
    text:
      locale.walkthroughStepSelectionText ||
      "Draw a selection around the bubble with any selection tool. TypeR uses the selection bounds to place and center the text.",
  },
  {
    id: "flow",
    title: locale.walkthroughStepFlowTitle || "Typeset quickly",
    text:
      locale.walkthroughStepFlowText ||
      "Use the preview actions or shortcuts to paste, apply, align, and move through the script without leaving the panel.",
  },
  {
    id: "settings",
    title: locale.walkthroughStepSettingsTitle || "Tune the workflow",
    text:
      locale.walkthroughStepSettingsText ||
      "Settings control shortcuts, markdown, line numbering, auto-scroll, quick size edits, imports, exports, and saved work states.",
  },
];

const Toggle = ({ checked, onChange, label }) => (
  <button type="button" className={`walkthrough-toggle${checked ? " m-on" : ""}`} onClick={onChange}>
    <span className="walkthrough-toggle-knob" />
    <span>{label}</span>
  </button>
);

const WalkthroughModal = React.memo(function WalkthroughModal() {
  const context = useContext();
  const [stepIndex, setStepIndex] = React.useState(0);
  const [script, setScript] = React.useState("");
  const [selectedStyle, setSelectedStyle] = React.useState("");
  const [tagValue, setTagValue] = React.useState("");
  const [selectionStarted, setSelectionStarted] = React.useState(false);
  const [selectionDone, setSelectionDone] = React.useState(false);
  const [flowDone, setFlowDone] = React.useState({ paste: false, next: false, align: false });
  const [settingDone, setSettingDone] = React.useState({ shortcuts: false, tips: false, reopen: false });
  const steps = React.useMemo(getSteps, []);
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const completed = {
    script: hasSampleScript(script),
    styles: selectedStyle === "regular" && tagValue.trim().toUpperCase() === "REG:",
    selection: selectionDone,
    flow: flowDone.paste && flowDone.next && flowDone.align,
    settings: settingDone.shortcuts && settingDone.tips && settingDone.reopen,
  };
  const canContinue = completed[step.id];

  const close = React.useCallback(() => {
    context.dispatch({ type: "completeWalkthrough" });
  }, [context.dispatch]);

  const previous = () => setStepIndex((index) => Math.max(0, index - 1));
  const next = () => {
    if (!canContinue) return;
    if (isLast) close();
    else setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  };

  const goToStep = (index) => {
    if (index <= stepIndex || completed[steps[index - 1]?.id]) {
      setStepIndex(index);
    }
  };

  const renderDone = (done) => (
    <span className={`walkthrough-status${done ? " m-done" : ""}`}>
      {done ? locale.walkthroughDoneStatus || "Done" : locale.walkthroughTodoStatus || "To do"}
    </span>
  );

  const renderPractice = () => {
    if (step.id === "script") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiType size={17} />
            <span>{locale.walkthroughTaskPaste || "Add the sample script, then notice the page marker, style tags, and ignored note."}</span>
            {renderDone(completed.script)}
          </div>
          <textarea
            className="topcoat-textarea walkthrough-script-input"
            value={script}
            onChange={(event) => setScript(event.target.value)}
            placeholder={locale.walkthroughScriptPlaceholder || "Paste or type a few script lines here..."}
          />
          <button type="button" className="topcoat-button--large" onClick={() => setScript(SAMPLE_SCRIPT)}>
            {locale.walkthroughUseSample || "Use sample script"}
          </button>
          {completed.script && (
            <div className="walkthrough-result">
              {locale.walkthroughPasteResult || "TypeR would now select the first usable line and skip the page marker and note."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "styles") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiMousePointer size={17} />
            <span>{locale.walkthroughTaskStyle || "Select the Regular style, then enter the tag that should trigger it."}</span>
            {renderDone(completed.styles)}
          </div>
          <div className="walkthrough-style-list">
            {["regular", "sfx", "narration"].map((styleId) => (
              <button
                key={styleId}
                type="button"
                className={`walkthrough-style${selectedStyle === styleId ? " m-active" : ""}`}
                onClick={() => setSelectedStyle(styleId)}
              >
                {locale[`walkthroughStyle${styleId.charAt(0).toUpperCase()}${styleId.slice(1)}`] || styleId}
              </button>
            ))}
          </div>
          <input
            className="topcoat-text-input--large"
            value={tagValue}
            onChange={(event) => setTagValue(event.target.value)}
            placeholder={locale.walkthroughTagPlaceholder || "Type REG:"}
          />
          {completed.styles && (
            <div className="walkthrough-result">
              {locale.walkthroughStyleResult || "A line starting with REG: would now pick Regular automatically."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "selection") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiMousePointer size={17} />
            <span>{locale.walkthroughTaskSelection || "Press on the mock bubble, drag inside it, then release."}</span>
            {renderDone(completed.selection)}
          </div>
          <div
            className={`walkthrough-canvas${selectionStarted ? " m-dragging" : ""}${selectionDone ? " m-selected" : ""}`}
            onMouseDown={() => setSelectionStarted(true)}
            onMouseUp={() => {
              if (selectionStarted) setSelectionDone(true);
              setSelectionStarted(false);
            }}
            onMouseLeave={() => setSelectionStarted(false)}
          >
            <div className="walkthrough-bubble">
              {selectionDone ? locale.walkthroughSelectionSelected || "Selection ready" : locale.walkthroughSelectionBubble || "Bubble"}
            </div>
            <div className="walkthrough-selection-box" />
          </div>
          {completed.selection && (
            <div className="walkthrough-result">
              {locale.walkthroughSelectionResult || "TypeR can use this selection to create or align a text layer."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "flow") {
      const setFlow = (key) => setFlowDone((value) => ({ ...value, [key]: true }));
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiRotateCw size={17} />
            <span>{locale.walkthroughTaskFlow || "Run the mini workflow in order: Paste, Next line, Align."}</span>
            {renderDone(completed.flow)}
          </div>
          <div className="walkthrough-flow">
            <button type="button" className={flowDone.paste ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={() => setFlow("paste")}>
              {locale.createLayer || "Paste"}
            </button>
            <button
              type="button"
              className={flowDone.next ? "topcoat-button--large--cta" : "topcoat-button--large"}
              onClick={() => flowDone.paste && setFlow("next")}
              disabled={!flowDone.paste}
            >
              {locale.nextLine || "Next line"}
            </button>
            <button
              type="button"
              className={flowDone.align ? "topcoat-button--large--cta" : "topcoat-button--large"}
              onClick={() => flowDone.next && setFlow("align")}
              disabled={!flowDone.next}
            >
              {locale.alignLayer || "Align"}
            </button>
          </div>
          {completed.flow && (
            <div className="walkthrough-result">
              {locale.walkthroughFlowResult || "That is the core loop: select bubble, paste text, advance, align when needed."}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="walkthrough-practice">
        <div className="walkthrough-task">
          <FiCheck size={17} />
          <span>{locale.walkthroughTaskSettings || "Toggle the options you may revisit later, then confirm where this guide lives."}</span>
          {renderDone(completed.settings)}
        </div>
        <Toggle
          checked={settingDone.shortcuts}
          onChange={() => setSettingDone((value) => ({ ...value, shortcuts: !value.shortcuts }))}
          label={locale.settingsTabShortcuts || "Shortcuts"}
        />
        <Toggle
          checked={settingDone.tips}
          onChange={() => setSettingDone((value) => ({ ...value, tips: !value.tips }))}
          label={locale.settingsShowTipsLabel || "Show tips"}
        />
        <label className="walkthrough-confirm">
          <input
            type="checkbox"
            checked={settingDone.reopen}
            onChange={(event) => setSettingDone((value) => ({ ...value, reopen: event.target.checked }))}
          />
          <span>{locale.walkthroughSettingsConfirm || "I can reopen this guide from Settings > General."}</span>
        </label>
      </div>
    );
  };

  return (
    <React.Fragment>
      <div className="app-modal-header hostBrdBotContrast">
        <div className="app-modal-title">{locale.walkthroughTitle || "First-time walkthrough"}</div>
        <button className="topcoat-icon-button--large--quiet" title={locale.close} onClick={close}>
          <FiX size={18} />
        </button>
      </div>
      <div className="app-modal-body">
        <div className="app-modal-body-inner walkthrough">
          <div className="walkthrough-progress" aria-label={locale.walkthroughProgress || "Walkthrough progress"}>
            {steps.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`walkthrough-dot${index === stepIndex ? " m-active" : ""}${completed[item.id] ? " m-done" : ""}`}
                title={`${index + 1}. ${item.title}`}
                onClick={() => goToStep(index)}
                disabled={index > stepIndex && !completed[steps[index - 1]?.id]}
              />
            ))}
          </div>
          <div className="walkthrough-step-count">
            {(locale.walkthroughStepCount || "Step {current} of {total}")
              .replace("{current}", String(stepIndex + 1))
              .replace("{total}", String(steps.length))}
          </div>
          <h2>{step.title}</h2>
          <p>{step.text}</p>
          {renderPractice()}
        </div>
      </div>
      <div className="app-modal-footer hostBrdTopContrast walkthrough-footer">
        <button type="button" className="topcoat-button--large" onClick={close}>
          <FiSkipForward size={16} /> {locale.walkthroughSkip || "Skip"}
        </button>
        <div className="walkthrough-footer-nav">
          <button type="button" className="topcoat-button--large" onClick={previous} disabled={isFirst}>
            <FiChevronLeft size={16} /> {locale.walkthroughBack || "Back"}
          </button>
          <button type="button" className="topcoat-button--large--cta" onClick={next} disabled={!canContinue}>
            {isLast ? <FiCheck size={16} /> : <FiChevronRight size={16} />}
            {isLast ? locale.walkthroughDone || "Done" : locale.walkthroughNext || "Next"}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
});

export default WalkthroughModal;
