import "./main.scss";

import React from "react";
import { readStorage, writeToStorage, resizeTextArea } from "../../utils";
import { useContext } from "../../context";
import Modal from "../modal/modal";
import TextBlock from "../textBlock/textBlock";
import TabBar from "../tabBar/tabBar";
import PreviewBlock from "../previewBlock/previewBlock";
import StylesBlock from "../stylesBlock/stylesBlock";
import AppFooter from "../footer/footer";

const minMiddleHeight = 100;
const minBottomHeight = 70;

const ResizeableCont = React.memo(function ResizeableCont() {
  const context = useContext();
  const uiLayout = context.state.uiLayout;
  const { order, visible, sizes } = uiLayout;
  const appBlock = React.useRef();
  const bottomBlock = React.useRef();
  const draggingRef = React.useRef(false);
  const resizeStartYRef = React.useRef(0);
  const resizeStartHRef = React.useRef(0);
  const bottomHeightRef = React.useRef(0);
  const appHeightRef = React.useRef(0);

  const topHeight = visible.preview ? sizes.previewHeight : 0;
  // When the styles block sits above the text block, dragging the divider
  // down must grow it instead of shrinking it
  const stylesBelowText = order.indexOf("styles") > order.indexOf("text");

  const startBottomResize = (e) => {
    if (!bottomBlock.current) return;
    resizeStartHRef.current = bottomBlock.current.offsetHeight;
    resizeStartYRef.current = e.pageY;
    draggingRef.current = true;
  };

  const stopBottomResize = () => {
    if (draggingRef.current) {
      writeToStorage({ bottomHeight: bottomHeightRef.current });
      draggingRef.current = false;
    }
  };

  const moveBottomResize = (e) => {
    if (draggingRef.current) {
      e.preventDefault();
      const dy = e.pageY - resizeStartYRef.current;
      const newHeight = resizeStartHRef.current + (stylesBelowText ? -dy : dy);
      setBottomSize(newHeight);
    }
  };

  const setBottomSize = (height) => {
    if (!bottomBlock.current) return;
    if (!visible.text) {
      // Styles block takes the remaining space when the text block is hidden
      bottomBlock.current.style.height = "";
      return;
    }
    const maxBottomHeight = appHeightRef.current - (appHeightRef.current > 450 ? topHeight : 0) - minMiddleHeight;
    bottomHeightRef.current = height || readStorage("bottomHeight") || minBottomHeight;
    if (height < minBottomHeight) bottomHeightRef.current = minBottomHeight;
    if (height > maxBottomHeight) bottomHeightRef.current = maxBottomHeight;
    bottomBlock.current.style.height = bottomHeightRef.current + "px";
    resizeTextArea(!!height);
  };

  const setAppSize = () => {
    appHeightRef.current = document.documentElement.clientHeight;
    appBlock.current.style.height = appHeightRef.current + "px";
    setBottomSize();
  };

  React.useEffect(() => {
    window.addEventListener("resize", setAppSize);
    setAppSize();

    return () => {
      window.removeEventListener("resize", setAppSize);
    };
  }, [visible.preview, visible.text, visible.styles, sizes.previewHeight]);

  // Global interface scale (zoom keeps layout math in CSS pixels)
  React.useEffect(() => {
    const scale = (sizes.uiScale || 100) / 100;
    document.documentElement.style.zoom = scale === 1 ? "" : String(scale);
    window.dispatchEvent(new Event("resize"));
  }, [sizes.uiScale]);

  const divider = visible.text ? (
    <div className="middle-divider hostBgdDark" onMouseDown={startBottomResize}>
      <div className="hostBgdLight"></div>
    </div>
  ) : null;

  const blocks = {
    preview: visible.preview ? (
      <React.Fragment key="preview">
        <div className="top-block preview-block" style={{ height: topHeight }}>
          <PreviewBlock />
        </div>
        <div className="top-divider hostBgdDark"></div>
      </React.Fragment>
    ) : null,
    text: visible.text ? (
      <React.Fragment key="text">
        {visible.tabBar !== false && <TabBar />}
        <div className="middle-block text-block">
          <TextBlock />
        </div>
      </React.Fragment>
    ) : null,
    styles: visible.styles ? (
      <React.Fragment key="styles">
        {stylesBelowText && divider}
        <div className={"bottom-block styles-block" + (visible.text ? "" : " m-grow")} ref={bottomBlock}>
          <StylesBlock />
        </div>
        {!stylesBelowText && divider}
      </React.Fragment>
    ) : null,
  };

  return (
    <div className="app-body" ref={appBlock} onMouseMove={moveBottomResize} onMouseLeave={stopBottomResize} onMouseUp={stopBottomResize}>
      <Modal />
      {order.map((id) => blocks[id])}
      <div className="footer-block hostBrdTopContrast">
        <AppFooter />
      </div>
    </div>
  );
});

export default ResizeableCont;
