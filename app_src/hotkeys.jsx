import React from "react";

import { csInterface, getHotkeyPressed, isHostActionPending, isPanelIdle, isPanelInteracting, notePanelActivity, onMouseShortcut, startForegroundWatcher } from "./utils";
import { useContext } from "./context";
import { shortcutCommands } from "./shortcutCommands";

const intervalTime = 75;
// After a few idle minutes the keyboard poll slows to this rate: even 13 host
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

// Mouse bindings are matched on their own so the mouse path can only ever add
// behavior: a keyboard-only binding whose modifiers happen to be held during a
// click (e.g. WIN+CTRL) must not fire a second time through here.
const MOUSE_KEYS = ["MOUSE4", "MOUSE5"];
const hasMouseKey = (ref) => Array.isArray(ref) && ref.some((key) => MOUSE_KEYS.includes(key));

const matchMouseBinding = (state, shortcut) => {
  let best = null;
  let bestLength = 0;
  shortcutCommands.forEach((command) => {
    const ref = shortcut[command.id];
    if (hasMouseKey(ref) && checkShortcut(state, ref) && ref.length > bestLength) {
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
  const context = useContext(() => ({}));

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
      const ctx = { state: context.getState(), dispatch: context.dispatch, getState: context.getState };
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
      if (context.getState().modalType || isFormFieldActive() || hotkeyPollPendingRef.current || isHostActionPending() || document.hidden) return;
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
      if (e.key === "Escape" && context.getState().modalType) {
        context.dispatch({ type: "setModal" });
      }
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearInterval(interval);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  React.useEffect(() => {
    // The watcher normally starts from the first hotkey poll, but mouse
    // bindings must work even while that poll is backing off
    startForegroundWatcher();

    const unsubscribe = onMouseShortcut((state) => {
      const ctxState = context.getState();
      // No isFormFieldActive() guard: a side button never types a character,
      // and the panel's textarea usually holds focus while the user works
      if (ctxState.modalType) return;
      const command = matchMouseBinding(state, ctxState.shortcut);
      if (!command) return;
      const now = Date.now();
      if (now - lastActionRef.current < (command.repeatDelay || 0)) return;
      lastActionRef.current = now;
      command.handler({ state: ctxState, dispatch: context.dispatch, getState: context.getState });
    });

    // CEF maps these buttons to history back/forward, which blanks the panel.
    // Only needed while the cursor is over the panel; the shortcut itself is
    // delivered by the watcher, not by these events.
    const swallowMouseNav = (e) => {
      if (e.button === 3 || e.button === 4) e.preventDefault();
    };
    document.addEventListener("mousedown", swallowMouseNav, true);
    document.addEventListener("mouseup", swallowMouseNav, true);
    document.addEventListener("auxclick", swallowMouseNav, true);

    return () => {
      unsubscribe();
      document.removeEventListener("mousedown", swallowMouseNav, true);
      document.removeEventListener("mouseup", swallowMouseNav, true);
      document.removeEventListener("auxclick", swallowMouseNav, true);
    };
  }, []);

  React.useEffect(() => {
    const keyInterests = [{ keyCode: 27 }];
    csInterface.registerKeyEventsInterest(JSON.stringify(keyInterests));
  }, []);

  return <React.Fragment />;
});

export default HotkeysListner;
