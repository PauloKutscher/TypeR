import {
  alignTextLayerToSelection,
  changeActiveLayerTextSize,
  createTextLayerInSelection,
  createTextLayersInStoredSelections,
  deselectDocument,
  setActiveLayerText,
} from "./utils";
import { buildStoredSelectionPayload, getScaledStyle } from "./textLayerPayload";

const createInSelection = (ctx) => {
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

    createTextLayersInStoredSelections(
      payload.texts,
      payload.styles,
      storedSelections,
      ctx.state.pastePointText,
      ctx.state.internalPadding || 0,
      ctx.state.direction,
      (ok) => {
        if (!ok) return;
        ctx.dispatch({ type: "clearSelections" });
        // Prevent the selection monitor from immediately capturing the live
        // marquee again after a successful multi-bubble paste.
        deselectDocument();
      }
    );
    return;
  }

  const line = ctx.state.currentLine || { text: "" };
  const style = getScaledStyle(ctx.state.currentStyle, ctx.state.textScale);
  createTextLayerInSelection(
    line.text,
    style,
    ctx.state.pastePointText,
    ctx.state.internalPadding || 0,
    ctx.state.direction,
    (ok) => {
      if (ok) ctx.dispatch({ type: "nextLine", add: true });
    }
  );
};

const applyLineAndStyle = (ctx) => {
  const line = ctx.state.currentLine || { text: "" };
  const style = getScaledStyle(ctx.state.currentStyle, ctx.state.textScale);
  setActiveLayerText(line.text, style, ctx.state.direction, (ok) => {
    if (ok) ctx.dispatch({ type: "nextLine", add: true });
  });
};

const insertLineText = (ctx) => {
  const line = ctx.state.currentLine || { text: "" };
  setActiveLayerText(line.text, null, ctx.state.direction, (ok) => {
    if (ok) ctx.dispatch({ type: "nextLine", add: true });
  });
};

const switchTab = (ctx, direction) => {
  const tabs = ctx.state.tabs || [];
  if (ctx.state.multiTabEnabled === false || tabs.length < 2) return;
  const currentIndex = tabs.findIndex((tab) => tab.id === ctx.state.currentTabId);
  const baseIndex = currentIndex < 0 ? 0 : currentIndex;
  const nextIndex = (baseIndex + direction + tabs.length) % tabs.length;
  ctx.dispatch({ type: "switchTab", id: tabs[nextIndex].id });
};

// This is the single source of truth for shortcut identity, default keys,
// display label, repeat policy, and runtime behavior.
const shortcutCommands = [
  {
    id: "add",
    label: "shortcut_add",
    defaultKeys: ["WIN", "CTRL"],
    repeatDelay: 0,
    handler: createInSelection,
  },
  {
    id: "apply",
    label: "shortcut_apply",
    defaultKeys: ["WIN", "SHIFT"],
    repeatDelay: 0,
    handler: applyLineAndStyle,
  },
  {
    id: "center",
    label: "shortcut_center",
    defaultKeys: ["WIN", "ALT"],
    repeatDelay: 0,
    handler: (ctx) => alignTextLayerToSelection(
      ctx.state.resizeTextBoxOnCenter,
      ctx.state.internalPadding || 0
    ),
  },
  {
    id: "applyStyle",
    label: "shortcut_applyStyle",
    defaultKeys: [],
    repeatDelay: 0,
    handler: (ctx) => {
      if (ctx.state.currentStyle) {
        setActiveLayerText("", ctx.state.currentStyle, ctx.state.direction);
      }
    },
  },
  {
    id: "previous",
    label: "shortcut_previous",
    defaultKeys: ["CTRL", "TAB"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "prevLine" }),
  },
  {
    id: "next",
    label: "shortcut_next",
    defaultKeys: ["CTRL", "ENTER"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextLine" }),
  },
  {
    id: "previousPage",
    label: "shortcut_previousPage",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "previousPage" }),
  },
  {
    id: "nextPage",
    label: "shortcut_nextPage",
    defaultKeys: ["SHIFT", "X"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextPage" }),
  },
  {
    id: "previousStyle",
    label: "shortcut_previousStyle",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "previousStyle" }),
  },
  {
    id: "nextStyle",
    label: "shortcut_nextStyle",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({ type: "nextStyle" }),
  },
  {
    id: "increase",
    label: "shortcut_increase",
    defaultKeys: ["CTRL", "SHIFT", "PLUS"],
    repeatDelay: 300,
    handler: (ctx) => changeActiveLayerTextSize(ctx.state.textSizeIncrement || 1),
  },
  {
    id: "decrease",
    label: "shortcut_decrease",
    defaultKeys: ["CTRL", "SHIFT", "MINUS"],
    repeatDelay: 300,
    handler: (ctx) => changeActiveLayerTextSize(-(ctx.state.textSizeIncrement || 1)),
  },
  {
    id: "insertText",
    label: "shortcut_insertText",
    defaultKeys: ["WIN", "V"],
    repeatDelay: 0,
    handler: insertLineText,
  },
  {
    id: "toggleMultiBubble",
    label: "shortcut_toggleMultiBubble",
    defaultKeys: ["CTRL", "ALT", "M"],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({
      type: "setMultiBubbleMode",
      value: !ctx.state.multiBubbleMode,
    }),
  },
  {
    id: "removeLastSelection",
    label: "shortcut_removeLastSelection",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => {
      const selections = ctx.state.storedSelections || [];
      if (selections.length) {
        ctx.dispatch({ type: "removeSelection", index: selections.length - 1 });
        // The removed item is normally still the live Photoshop marquee.
        // Drop it so the selection monitor cannot capture it again.
        deselectDocument();
      }
    },
  },
  {
    id: "clearSelections",
    label: "shortcut_clearSelections",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => {
      if ((ctx.state.storedSelections || []).length) {
        ctx.dispatch({ type: "clearSelections" });
        deselectDocument();
      }
    },
  },
  {
    id: "toggleTextShapeR",
    label: "shortcut_toggleTextShapeR",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => ctx.dispatch({
      type: "setInlineTextShapeR",
      value: !ctx.state.inlineTextShapeR,
    }),
  },
  {
    id: "previousTab",
    label: "shortcut_previousTab",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => switchTab(ctx, -1),
  },
  {
    id: "nextTab",
    label: "shortcut_nextTab",
    defaultKeys: [],
    repeatDelay: 300,
    handler: (ctx) => switchTab(ctx, 1),
  },
];

const getDefaultShortcuts = () => shortcutCommands.reduce((shortcuts, command) => {
  shortcuts[command.id] = command.defaultKeys.concat([]);
  return shortcuts;
}, {});

const isMac = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || "");
const shortcutKeyLabels = {
  WIN: isMac ? "Cmd" : "Win",
  CTRL: "Ctrl",
  SHIFT: "Shift",
  ALT: isMac ? "Opt" : "Alt",
  ENTER: "Enter",
  TAB: "Tab",
  SPACE: "Space",
  ESCAPE: "Esc",
  BACKSPACE: "Bksp",
  DELETE: "Del",
  PLUS: "+",
  MINUS: "-",
  EQUAL: "=",
  DIVIDE: "/",
  MULTIPLY: "*",
  ARROWUP: "↑",
  ARROWDOWN: "↓",
  ARROWLEFT: "←",
  ARROWRIGHT: "→",
};

const formatShortcut = (keys) => (keys || [])
  .map((key) => shortcutKeyLabels[String(key).toUpperCase()] || key)
  .join(" + ");

const withShortcutHint = (label, keys) => {
  const shortcut = formatShortcut(keys);
  return shortcut ? `${label} (${shortcut})` : label;
};

export {
  shortcutCommands,
  getDefaultShortcuts,
  shortcutKeyLabels,
  formatShortcut,
  withShortcutHint,
};
