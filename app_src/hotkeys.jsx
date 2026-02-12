import React from "react";
import deepClone from "./deepClone";

import { csInterface, setActiveLayerText, createTextLayerInSelection, createTextLayersInStoredSelections, alignTextLayerToSelection, getHotkeyPressed, changeActiveLayerTextSize } from "./utils";
import { useContext } from "./context";

const CTRL = "CTRL";
const SHIFT = "SHIFT";
const ALT = "ALT";
const WIN = "WIN";

const intervalTime = 50;

const checkShortcut = (state, ref) => {
  return ref.every((key) => state.includes(key));
};

const HotkeysListner = React.memo(function HotkeysListner() {
  const context = useContext();
  const contextRef = React.useRef(context);
  contextRef.current = context;

  const keyUpRef = React.useRef(true);
  const lastActionRef = React.useRef(0);

  React.useEffect(() => {
    const checkRepeatTime = (time = 0) => {
      const now = Date.now();
      if (!keyUpRef.current || now - lastActionRef.current < time) return false;
      lastActionRef.current = now;
      keyUpRef.current = false;
      return true;
    };

    const checkState = (state) => {
      const ctx = contextRef.current;
      const realState = state.split("a");
      realState.shift();
      realState.pop();
      if (checkShortcut(realState, ctx.state.shortcut.add)) {
        if (!checkRepeatTime()) return;

        const storedSelections = ctx.state.storedSelections || [];

        if (ctx.state.multiBubbleMode && storedSelections.length > 0) {
          const texts = [];
          const styles = [];
          const lines = ctx.state.lines || [];
          let nextFallbackIndex = ctx.state.currentLineIndex;

          const resolveStyleForLine = (targetLine, selection) => {
            if (targetLine?.style) {
              return targetLine.style;
            }
            if (selection?.styleId) {
              const storedStyle = ctx.state.styles.find((s) => s.id === selection.styleId);
              if (storedStyle) return storedStyle;
            }
            return ctx.state.currentStyle;
          };

          const resolveLineForSelection = (selection) => {
            if (typeof selection.lineIndex === "number" && selection.lineIndex >= 0) {
              const storedLine = lines[selection.lineIndex];
              if (storedLine && !storedLine.ignore) {
                nextFallbackIndex = Math.max(nextFallbackIndex, selection.lineIndex + 1);
                return storedLine;
              }
            }

            while (nextFallbackIndex < lines.length) {
              const candidate = lines[nextFallbackIndex];
              nextFallbackIndex++;
              if (candidate && !candidate.ignore) {
                return candidate;
              }
            }
            return null;
          };

          for (let i = 0; i < storedSelections.length; i++) {
            const selection = storedSelections[i];
            const targetLine = resolveLineForSelection(selection);
            if (!targetLine) {
              break;
            }

            texts.push(targetLine.text);

            let lineStyle = resolveStyleForLine(targetLine, selection);
            if (lineStyle && ctx.state.textScale) {
              lineStyle = deepClone(lineStyle);
              const txtStyle = lineStyle.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
              if (typeof txtStyle.size === "number") {
                txtStyle.size *= ctx.state.textScale / 100;
              }
              if (typeof txtStyle.leading === "number" && txtStyle.leading) {
                txtStyle.leading *= ctx.state.textScale / 100;
              }
            }
            styles.push(lineStyle);
          }

          const pointText = ctx.state.pastePointText;
          const padding = ctx.state.internalPadding || 0;
          createTextLayersInStoredSelections(texts, styles, storedSelections, pointText, padding, (ok) => {
            if (ok) {
              ctx.dispatch({ type: "clearSelections" });
            }
          });
        } else {
          const line = ctx.state.currentLine || { text: "" };
          let style = ctx.state.currentStyle;
          if (style && ctx.state.textScale) {
            style = deepClone(style);
            const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
            if (typeof txtStyle.size === "number") {
              txtStyle.size *= ctx.state.textScale / 100;
            }
            if (typeof txtStyle.leading === "number" && txtStyle.leading) {
              txtStyle.leading *= ctx.state.textScale / 100;
            }
          }
          const pointText = ctx.state.pastePointText;
          const padding = ctx.state.internalPadding || 0;
          createTextLayerInSelection(line.text, style, pointText, padding, (ok) => {
            if (ok) ctx.dispatch({ type: "nextLine", add: true });
          });
        }
      } else if (checkShortcut(realState, ctx.state.shortcut.apply)) {
        if (!checkRepeatTime()) return;
        const line = ctx.state.currentLine || { text: "" };
        let style = ctx.state.currentStyle;
        if (style && ctx.state.textScale) {
          style = deepClone(style);
          const txtStyle = style.textProps?.layerText.textStyleRange?.[0]?.textStyle || {};
          if (typeof txtStyle.size === "number") {
            txtStyle.size *= ctx.state.textScale / 100;
          }
          if (typeof txtStyle.leading === "number" && txtStyle.leading) {
            txtStyle.leading *= ctx.state.textScale / 100;
          }
        }
        setActiveLayerText(line.text, style, ctx.state.direction, (ok) => {
          if (ok) ctx.dispatch({ type: "nextLine", add: true });
        });
      } else if (checkShortcut(realState, ctx.state.shortcut.center)) {
        if (!checkRepeatTime()) return;
        const padding = ctx.state.internalPadding || 0;
        alignTextLayerToSelection(ctx.state.resizeTextBoxOnCenter, padding);
      } else if (checkShortcut(realState, ctx.state.shortcut.toggleMultiBubble)) {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "setMultiBubbleMode", value: !ctx.state.multiBubbleMode });
      } else if (checkShortcut(realState, ctx.state.shortcut.next)) {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "nextLine" });
      } else if (checkShortcut(realState, ctx.state.shortcut.previous)) {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "prevLine" });
      } else if (checkShortcut(realState, ctx.state.shortcut.increase)) {
        if (!checkRepeatTime(300)) return;
        changeActiveLayerTextSize(ctx.state.textSizeIncrement || 1);
      } else if (checkShortcut(realState, ctx.state.shortcut.decrease)) {
        if (!checkRepeatTime(300)) return;
        changeActiveLayerTextSize(-(ctx.state.textSizeIncrement || 1));
      } else if (checkShortcut(realState, ctx.state.shortcut.insertText)) {
        if (!checkRepeatTime()) return;
        const line = ctx.state.currentLine || { text: "" };
        setActiveLayerText(line.text, null, ctx.state.direction, (ok) => {
          if (ok) ctx.dispatch({ type: "nextLine", add: true });
        });
      } else if (checkShortcut(realState, ctx.state.shortcut.nextPage)) {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "nextPage" });
      } else {
        keyUpRef.current = true;
      }
    };

    const interval = setInterval(() => {
      if (contextRef.current.state.modalType === "settings") return;
      getHotkeyPressed(checkState);
    }, intervalTime);

    const handleKeyDown = (e) => {
      if (e.key === "Escape" && contextRef.current.state.modalType) {
        contextRef.current.dispatch({ type: "setModal" });
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(interval);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  React.useEffect(() => {
    const keyInterests = [{ keyCode: 27 }];
    csInterface.registerKeyEventsInterest(JSON.stringify(keyInterests));
  }, []);

  return <React.Fragment />;
});

export default HotkeysListner;
