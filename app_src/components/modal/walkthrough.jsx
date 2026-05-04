import React from "react";
import { FiX, FiChevronLeft, FiChevronRight, FiCheck, FiSkipForward } from "react-icons/fi";

import { useContext } from "../../context";
import { locale } from "../../utils";

const getSteps = () => [
  {
    title: locale.walkthroughStepPasteTitle || "Paste your script",
    text:
      locale.walkthroughStepPasteText ||
      "Paste the translated script in the text block. TypeR splits it into lines, ignores empty lines, and keeps the active line highlighted.",
    points: [
      locale.walkthroughStepPastePoint1 || "Use Page 1, Page 2 markers to move between pages.",
      locale.walkthroughStepPastePoint2 || "Translator notes can be ignored with prefixes configured in Settings.",
    ],
  },
  {
    title: locale.walkthroughStepStylesTitle || "Create and choose styles",
    text:
      locale.walkthroughStepStylesText ||
      "Create styles from an existing Photoshop text layer or set the values manually. Click a style to make it active.",
    points: [
      locale.walkthroughStepStylesPoint1 || "Style tags at the start of a line pick the matching style automatically.",
      locale.walkthroughStepStylesPoint2 || "Folders keep dialogue, shout, narration, and SFX styles organized.",
    ],
  },
  {
    title: locale.walkthroughStepSelectionTitle || "Select the bubble in Photoshop",
    text:
      locale.walkthroughStepSelectionText ||
      "Draw a selection around the bubble with any selection tool. TypeR uses the selection bounds to place and center the text.",
    points: [
      locale.walkthroughStepSelectionPoint1 || "Paste creates a new styled text layer in the selected area.",
      locale.walkthroughStepSelectionPoint2 || "Align centers the active text layer in the current selection.",
    ],
  },
  {
    title: locale.walkthroughStepFlowTitle || "Typeset quickly",
    text:
      locale.walkthroughStepFlowText ||
      "Use the preview actions or shortcuts to paste, apply, align, and move through the script without leaving the panel.",
    points: [
      locale.walkthroughStepFlowPoint1 || "Paste advances to the next usable line automatically.",
      locale.walkthroughStepFlowPoint2 || "Use multi-bubble mode when several selections should receive consecutive lines.",
    ],
  },
  {
    title: locale.walkthroughStepSettingsTitle || "Tune the workflow",
    text:
      locale.walkthroughStepSettingsText ||
      "Settings control shortcuts, markdown, line numbering, auto-scroll, quick size edits, imports, exports, and saved work states.",
    points: [
      locale.walkthroughStepSettingsPoint1 || "You can reopen this walkthrough from Settings at any time.",
      locale.walkthroughStepSettingsPoint2 || "The Help window keeps the detailed reference guide.",
    ],
  },
];

const WalkthroughModal = React.memo(function WalkthroughModal() {
  const context = useContext();
  const [stepIndex, setStepIndex] = React.useState(0);
  const steps = React.useMemo(getSteps, []);
  const step = steps[stepIndex];
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;

  const close = React.useCallback(() => {
    context.dispatch({ type: "completeWalkthrough" });
  }, [context.dispatch]);

  const previous = () => setStepIndex((index) => Math.max(0, index - 1));
  const next = () => {
    if (isLast) close();
    else setStepIndex((index) => Math.min(steps.length - 1, index + 1));
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
                key={item.title}
                type="button"
                className={`walkthrough-dot${index === stepIndex ? " m-active" : ""}`}
                title={`${index + 1}. ${item.title}`}
                onClick={() => setStepIndex(index)}
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
          <ul>
            {step.points.map((point) => (
              <li key={point}>{point}</li>
            ))}
          </ul>
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
          <button type="button" className="topcoat-button--large--cta" onClick={next}>
            {isLast ? <FiCheck size={16} /> : <FiChevronRight size={16} />}
            {isLast ? locale.walkthroughDone || "Done" : locale.walkthroughNext || "Next"}
          </button>
        </div>
      </div>
    </React.Fragment>
  );
});

export default WalkthroughModal;
