import "./footer.scss";

import React from "react";
import PropTypes from "prop-types";
import { locale } from "../../utils";
import { useContext } from "../../context";
import HiddenFileInput from "../hiddenFileInput/hiddenFileInput";

const AppFooter = React.memo(function AppFooter() {
  const context = useContext((state) => ({
    images: state.images,
    multiBubbleMode: state.multiBubbleMode,
    inlineTextShapeR: state.inlineTextShapeR,
    uiLayout: state.uiLayout,
    balloonCenteringDebug: state.balloonCenteringDebug,
  }));
  const openSettings = () => {
    context.dispatch({
      type: "setModal",
      modal: "settings",
    });
  };
  const openHelp = () => {
    context.dispatch({
      type: "setModal",
      modal: "help",
    });
  };
  const fileInputRef = React.useRef();

  const openRepository = () => {
    if (context.state.images.length) {
      context.dispatch({ type: "setImages", images: [] });
      return;
    }
    fileInputRef.current?.click();
  };

  const toggleMultiBubble = () => {
    context.dispatch({ type: "setMultiBubbleMode", value: !context.state.multiBubbleMode });
  };

  const toggleInlineTextShapeR = () => {
    context.dispatch({ type: "setInlineTextShapeR", value: !context.state.inlineTextShapeR });
  };

  const toggleBalloonCenteringDebug = () => {
    context.dispatch({ type: "setBalloonCenteringDebug", value: !context.state.balloonCenteringDebug });
  };

  const uiVisible = context.state.uiLayout?.visible || {};
  const footerSizes = context.state.uiLayout?.sizes?.footer || {};
  const footerSize = (key) => (footerSizes[key] || 12) + "px";

  return (
    <React.Fragment>
      {uiVisible.footerHelp !== false && (
      <span className="link" style={{ fontSize: footerSize("help") }} onClick={openHelp}>
        {locale.footerHelp}
      </span>
      )}
      {/* Always visible: this link is the only entry point to the settings
          modal, so it must never be hidden — the toggle that re-enables it
          lives inside the dialog itself. */}
      <span className="link" style={{ fontSize: footerSize("settings") }} onClick={openSettings}>
        {locale.footerSettings}
      </span>
      {uiVisible.footerRepo !== false && (
      <span className="link" style={{ fontSize: footerSize("repo") }} onClick={openRepository}>
        {context.state.images.length
          ? locale.footerDesyncRepo
          : locale.footerOpenRepo}
      </span>
      )}
      {uiVisible.footerTextShapeR !== false && (
      <span
        className="link footer-mode-indicator footer-mode-spacer"
        style={{ fontSize: footerSize("textShapeR") }}
        onClick={toggleInlineTextShapeR}
        title={locale.inlineTextShapeRModeHint || "Shows or hides TextShapeR suggestions directly in the main panel"}
      >
        <span className={`footer-mode-dot ${context.state.inlineTextShapeR ? "is-on" : ""}`} />
        <span className="footer-mode-label">{locale.textShapeRTitle || "TextShapeR"}</span>
        <span className="footer-mode-status">
          {context.state.inlineTextShapeR ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </span>
      )}
      {uiVisible.footerMultiBubble !== false && (
      <span
        className="link footer-mode-indicator footer-mode-adjacent"
        style={{ fontSize: footerSize("multiBubble") }}
        onClick={toggleMultiBubble}
        title={locale.multiBubbleModeHint || "Allows capturing multiple selections to insert multiple texts at once"}
      >
        <span className={`footer-mode-dot ${context.state.multiBubbleMode ? "is-on" : ""}`} />
        <span className="footer-mode-label">Multi-bubble</span>
        <span className="footer-mode-status">
          {context.state.multiBubbleMode ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </span>
      )}
      {uiVisible.footerBalloonDebug !== false && (
      <span
        className="link footer-mode-indicator"
        style={{ fontSize: footerSize("balloonDebug") }}
        onClick={toggleBalloonCenteringDebug}
        title={locale.balloonDebugHint || "Show diagnostic panel for balloon centering geometry and text measurement"}
      >
        <span className={`footer-mode-dot ${context.state.balloonCenteringDebug ? "is-on" : ""}`} />
        <span className="footer-mode-label">{locale.balloonDebugTitle || "Balloon Debug"}</span>
        <span className="footer-mode-status">
          {context.state.balloonCenteringDebug ? (locale.multiBubbleModeOn || "ON") : (locale.multiBubbleModeOff || "OFF")}
        </span>
      </span>
      )}
      <HiddenFileInput ref={fileInputRef} />
    </React.Fragment>
  );
});

export default AppFooter;
