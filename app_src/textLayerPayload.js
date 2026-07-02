import deepClone from "./deepClone";

const getScaledStyle = (style, textScale) => {
  if (!style || !textScale) return style;
  const scaledStyle = deepClone(style);
  const textStyle = scaledStyle.textProps?.layerText?.textStyleRange?.[0]?.textStyle || {};
  const ratio = textScale / 100;
  if (typeof textStyle.size === "number") {
    textStyle.size *= ratio;
  }
  if (typeof textStyle.leading === "number" && textStyle.leading) {
    textStyle.leading *= ratio;
  }
  return scaledStyle;
};

const buildStoredSelectionPayload = ({
  storedSelections = [],
  lines = [],
  currentLineIndex = 0,
  styles = [],
  currentStyle = null,
  textScale = null,
}) => {
  const texts = [];
  const layerStyles = [];
  let nextFallbackIndex = currentLineIndex;

  const resolveStyleForLine = (targetLine, selection) => {
    if (selection?.styleId) {
      const storedStyle = styles.find((style) => style.id === selection.styleId);
      if (storedStyle) return storedStyle;
    }
    if (targetLine?.usedStyle) return targetLine.usedStyle;
    if (targetLine?.style) return targetLine.style;
    return currentStyle;
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
    if (!targetLine) break;
    texts.push(targetLine.text);
    layerStyles.push(getScaledStyle(resolveStyleForLine(targetLine, selection), textScale));
  }

  return { texts, styles: layerStyles };
};

export { getScaledStyle, buildStoredSelectionPayload };
