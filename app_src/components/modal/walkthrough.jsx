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
import { alignTextLayerToSelection, createTextLayerInSelection, getDefaultStroke, getDefaultStyle, locale } from "../../utils";

const SAMPLE_SCRIPT = "Page 1\nREG: This bubble is ready.\nSFX: BOOM!\n## translator note";
const DEMO_STYLE_ID = "typer_walkthrough_regular";
const DEMO_STYLE = {
  id: DEMO_STYLE_ID,
  name: "Walkthrough Regular",
  folder: null,
  textProps: getDefaultStyle(),
  prefixes: ["REG:"],
  prefixColor: "#54be78",
  stroke: getDefaultStroke(),
  edited: 1,
};

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

const WalkthroughModal = React.memo(function WalkthroughModal() {
  const context = useContext();
  const [stepIndex, setStepIndex] = React.useState(0);
  const [demoStyleReady, setDemoStyleReady] = React.useState(false);
  const [photoshopLayerDone, setPhotoshopLayerDone] = React.useState(false);
  const [alignDone, setAlignDone] = React.useState(false);
  const [settingDone, setSettingDone] = React.useState({ reopen: false });
  const steps = React.useMemo(getSteps, []);
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const sampleLoaded = hasSampleScript(context.state.text || "");

  const completed = {
    script: sampleLoaded,
    styles: demoStyleReady || context.state.styles.some((style) => style.id === DEMO_STYLE_ID),
    selection: photoshopLayerDone,
    flow: alignDone,
    settings: settingDone.reopen,
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

  const loadSampleScript = () => {
    context.dispatch({ type: "setText", text: SAMPLE_SCRIPT });
    context.dispatch({ type: "setCurrentLineIndex", index: 1 });
  };

  const prepareDemoStyle = () => {
    context.dispatch({ type: "saveStyle", data: DEMO_STYLE });
    context.dispatch({ type: "setCurrentStyleId", id: DEMO_STYLE_ID });
    setDemoStyleReady(true);
  };

  const createPhotoshopTextLayer = () => {
    createTextLayerInSelection(
      "This bubble is ready.",
      DEMO_STYLE,
      context.state.pastePointText,
      context.state.internalPadding || 0,
      context.state.direction,
      (ok) => {
        if (ok) {
          setPhotoshopLayerDone(true);
          context.dispatch({ type: "setCurrentLineIndex", index: 2 });
        }
      }
    );
  };

  const alignPhotoshopTextLayer = () => {
    alignTextLayerToSelection(context.state.resizeTextBoxOnCenter, context.state.internalPadding || 0, (ok) => {
      if (ok) setAlignDone(true);
    });
  };

  const renderPractice = () => {
    if (step.id === "script") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiType size={17} />
            <span>{locale.walkthroughTaskPaste || "Load the sample script into the real TypeR text block."}</span>
            {renderDone(completed.script)}
          </div>
          <pre className="walkthrough-script-preview">{SAMPLE_SCRIPT}</pre>
          <button type="button" className={completed.script ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={loadSampleScript}>
            {completed.script ? locale.walkthroughSampleLoaded || "Sample loaded" : locale.walkthroughUseSample || "Load sample into TypeR"}
          </button>
          {completed.script && (
            <div className="walkthrough-result">
              {locale.walkthroughPasteResult || "The panel now has a page marker, style tags, and an ignored note to practice with."}
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
            <span>{locale.walkthroughTaskStyle || "Create and activate a real demo style with the REG: tag."}</span>
            {renderDone(completed.styles)}
          </div>
          <div className="walkthrough-style-list">
            <button type="button" className={`walkthrough-style${completed.styles ? " m-active" : ""}`} onClick={prepareDemoStyle}>
              {locale.walkthroughStyleRegular || "Walkthrough Regular"}
            </button>
            <div className="walkthrough-tag-pill">REG:</div>
          </div>
          {completed.styles && (
            <div className="walkthrough-result">
              {locale.walkthroughStyleResult || "Lines starting with REG: can now select the demo style automatically."}
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
            <span>{locale.walkthroughTaskSelection || "In Photoshop, draw a selection around a bubble, then click the button below to create a real text layer."}</span>
            {renderDone(completed.selection)}
          </div>
          <button type="button" className={completed.selection ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={createPhotoshopTextLayer}>
            {completed.selection ? locale.walkthroughPhotoshopLayerCreated || "Text layer created" : locale.walkthroughCreateInPhotoshop || "Create text layer in Photoshop"}
          </button>
          {completed.selection && (
            <div className="walkthrough-result">
              {locale.walkthroughSelectionResult || "TypeR created a real text layer in the current Photoshop selection."}
            </div>
          )}
        </div>
      );
    }

    if (step.id === "flow") {
      return (
        <div className="walkthrough-practice">
          <div className="walkthrough-task">
            <FiRotateCw size={17} />
            <span>{locale.walkthroughTaskFlow || "Move or redraw the Photoshop selection, then align the active text layer for real."}</span>
            {renderDone(completed.flow)}
          </div>
          <div className="walkthrough-flow">
            <button type="button" className={completed.flow ? "topcoat-button--large--cta" : "topcoat-button--large"} onClick={alignPhotoshopTextLayer}>
              {completed.flow ? locale.walkthroughAligned || "Aligned" : locale.alignLayer || "Align"}
            </button>
          </div>
          {completed.flow && (
            <div className="walkthrough-result">
              {locale.walkthroughFlowResult || "That is the real loop: select a bubble, create a layer, then align it when needed."}
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="walkthrough-practice">
        <div className="walkthrough-task">
          <FiCheck size={17} />
          <span>{locale.walkthroughTaskSettings || "Confirm where this guide lives. The Done button will unlock immediately after this checkbox."}</span>
          {renderDone(completed.settings)}
        </div>
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
