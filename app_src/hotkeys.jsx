import React from "react";

import { csInterface, getHotkeyPressed, isHostActionPending, isPanelIdle, isPanelInteracting, notePanelActivity } from "./utils";
import { useContext } from "./context";
import { shortcutCommands } from "./shortcutCommands";

const intervalTime = 50;
// After a few idle minutes the keyboard poll slows to this rate: 20 host
// round-trips per second against an untouched Photoshop is what makes long
// background sessions crawl. The first pressed key restores the fast rate.
const idleIntervalTime = 500;

const checkShortcut = (state, ref) => {
  return Array.isArray(ref) && ref.length > 0 && ref.every((key) => state.includes(key));
};

// Matching is subset-based, so a modifier-only binding (e.g. default add =
// WIN+CTRL) would always shadow a longer custom binding built on the same
// modifiers. Pick the most specific match instead of the first one.
const matchBinding = (state, shortcut) => {
  let best = null;
  let bestLength = 0;
  shortcutCommands.forEach((command) => {
    const ref = shortcut[command.id];
    if (checkShortcut(state, ref) && ref.length > bestLength) {
      best = command;
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
  const lastPollAtRef = React.useRef(0);

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
      // Pressed keys are activity: restore fast polling before matching so a
      // hotkey burst after an idle period is never throttled
      if (realState.length) notePanelActivity();
      const command = matchBinding(realState, ctx.state.shortcut);
      if (!command) {
        keyUpRef.current = true;
        return;
      }
      if (!checkRepeatTime(command.repeatDelay || 0)) return;
      command.handler(ctx);
    };

    const interval = setInterval(() => {
      // Back off while a paste/align/apply runs: polling would queue behind it
      // in the ExtendScript engine and delay the action's completion
      if (contextRef.current.state.modalType || isFormFieldActive() || hotkeyPollPendingRef.current || isHostActionPending() || document.hidden) return;
      // The user is clicking inside the panel: a host round-trip right now
      // would land on Photoshop's main thread while it should be delivering
      // the click, which is exactly what made every button feel laggy
      if (isPanelInteracting()) return;
      if (isPanelIdle() && Date.now() - lastPollAtRef.current < idleIntervalTime) return;
      lastPollAtRef.current = Date.now();
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
