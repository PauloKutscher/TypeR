import React from "react";

import { csInterface, setActiveLayerText, createTextLayersInStoredSelections, getHotkeyPressed, changeActiveLayerTextSize, isHostActionPending, deselectDocument } from "./utils";
import { useContext } from "./context";
import { buildStoredSelectionPayload, getScaledStyle } from "./textLayerPayload";
import { pasteWithBubbleSplit, alignWithBubbleSplit } from "./bubbleActions";

const intervalTime = 50;

const checkShortcut = (state, ref) => {
  return Array.isArray(ref) && ref.length > 0 && ref.every((key) => state.includes(key));
};

// Matching is subset-based, so a modifier-only binding (e.g. default add =
// WIN+CTRL) would always shadow a longer custom binding built on the same
// modifiers. Pick the most specific match instead of the first one.
const bindingOrder = ["add", "apply", "center", "toggleMultiBubble", "next", "previous", "increase", "decrease", "insertText", "nextPage"];
const matchBinding = (state, shortcut) => {
  let best = null;
  let bestLength = 0;
  bindingOrder.forEach((name) => {
    const ref = shortcut[name];
    if (checkShortcut(state, ref) && ref.length > bestLength) {
      best = name;
      bestLength = ref.length;
    }
  });
  return best;
};

const isFormFieldActive = () => {
  const active = document.activeElement;
  if (!active) return false;
  const tagName = active.tagName;
  return active.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
};

const HotkeysListner = React.memo(function HotkeysListner() {
  const context = useContext();
  const contextRef = React.useRef(context);
  contextRef.current = context;

  const keyUpRef = React.useRef(true);
  const lastActionRef = React.useRef(0);
  const hotkeyPollPendingRef = React.useRef(false);

  React.useEffect(() => {
    const checkRepeatTime = (time = 0) => {
      const now = Date.now();
      if (!keyUpRef.current || now - lastActionRef.current < time) return false;
      lastActionRef.current = now;
      keyUpRef.current = false;
      return true;
    };

    const checkState = (state) => {
      if (!state) return;
      const ctx = contextRef.current;
      const realState = state.split("a");
      realState.shift();
      realState.pop();
      const matched = matchBinding(realState, ctx.state.shortcut);
      if (matched === "add") {
        if (!checkRepeatTime()) return;

        const storedSelections = ctx.state.storedSelections || [];

        if (ctx.state.multiBubbleMode && storedSelections.length > 0) {
          const payload = buildStoredSelectionPayload({
            storedSelections,
            lines: ctx.state.lines,
            currentLineIndex: ctx.state.currentLineIndex,
            styles: ctx.state.styles,
            currentStyle: ctx.state.currentStyle,
            textScale: ctx.state.textScale,
          });

          const pointText = ctx.state.pastePointText;
          const padding = ctx.state.internalPadding || 0;
          const direction = ctx.state.direction;
          createTextLayersInStoredSelections(payload.texts, payload.styles, storedSelections, pointText, padding, direction, (ok) => {
            if (ok) {
              ctx.dispatch({ type: "clearSelections" });
              // Drop the live marquee too: leaving it active would make the
              // selection poll re-add it and advance the line
              deselectDocument();
            }
          });
        } else {
          pasteWithBubbleSplit({ state: ctx.state, dispatch: ctx.dispatch });
        }
      } else if (matched === "apply") {
        if (!checkRepeatTime()) return;
        const line = ctx.state.currentLine || { text: "" };
        const style = getScaledStyle(ctx.state.currentStyle, ctx.state.textScale);
        setActiveLayerText(line.text, style, ctx.state.direction, (ok) => {
          if (ok) ctx.dispatch({ type: "nextLine", add: true });
        });
      } else if (matched === "center") {
        if (!checkRepeatTime()) return;
        alignWithBubbleSplit({ state: ctx.state });
      } else if (matched === "toggleMultiBubble") {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "setMultiBubbleMode", value: !ctx.state.multiBubbleMode });
      } else if (matched === "next") {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "nextLine" });
      } else if (matched === "previous") {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "prevLine" });
      } else if (matched === "increase") {
        if (!checkRepeatTime(300)) return;
        changeActiveLayerTextSize(ctx.state.textSizeIncrement || 1);
      } else if (matched === "decrease") {
        if (!checkRepeatTime(300)) return;
        changeActiveLayerTextSize(-(ctx.state.textSizeIncrement || 1));
      } else if (matched === "insertText") {
        if (!checkRepeatTime()) return;
        const line = ctx.state.currentLine || { text: "" };
        setActiveLayerText(line.text, null, ctx.state.direction, (ok) => {
          if (ok) ctx.dispatch({ type: "nextLine", add: true });
        });
      } else if (matched === "nextPage") {
        if (!checkRepeatTime(300)) return;
        ctx.dispatch({ type: "nextPage" });
      } else {
        keyUpRef.current = true;
      }
    };

    const interval = setInterval(() => {
      // Back off while a paste/align/apply runs: polling would queue behind it
      // in the ExtendScript engine and delay the action's completion
      if (contextRef.current.state.modalType || isFormFieldActive() || hotkeyPollPendingRef.current || isHostActionPending() || document.hidden) return;
      hotkeyPollPendingRef.current = true;
      getHotkeyPressed((state) => {
        hotkeyPollPendingRef.current = false;
        checkState(state);
      });
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
