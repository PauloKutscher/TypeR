const getMarkerCount = (text, start, end, markerChar) => {
  let before = 0;
  let after = 0;
  while (before < 3 && start - before - 1 >= 0 && text[start - before - 1] === markerChar) before += 1;
  while (after < 3 && end + after < text.length && text[end + after] === markerChar) after += 1;
  return Math.min(before, after);
};

const getSelectedMarkerCount = (text, start, end, markerChar) => {
  let opening = 0;
  let closing = 0;
  while (opening < 3 && start + opening < end && text[start + opening] === markerChar) opening += 1;
  while (closing < 3 && end - closing - 1 >= start && text[end - closing - 1] === markerChar) closing += 1;
  const count = Math.min(opening, closing);
  return end - start > count * 2 ? count : 0;
};

const markerCountToStyle = (count) => ({
  bold: count >= 2,
  italic: count === 1 || count >= 3,
});

const styleToMarker = (style, markerChar = "*") => {
  const count = style.bold && style.italic ? 3 : style.bold ? 2 : style.italic ? 1 : 0;
  return markerChar.repeat(count);
};

const formatMarkdownSelection = (text, start, end, format) => {
  const value = typeof text === "string" ? text : "";
  const safeStart = Math.max(0, Math.min(Number(start) || 0, value.length));
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || 0, value.length));
  if (safeStart === safeEnd || (format !== "bold" && format !== "italic")) {
    return { text: value, selectionStart: safeStart, selectionEnd: safeEnd };
  }

  let markerChar = "*";
  let markerCount = getMarkerCount(value, safeStart, safeEnd, markerChar);
  let markersInsideSelection = false;
  if (!markerCount) {
    const underscoreCount = getMarkerCount(value, safeStart, safeEnd, "_");
    if (underscoreCount) {
      markerChar = "_";
      markerCount = underscoreCount;
    }
  }
  if (!markerCount) {
    markerCount = getSelectedMarkerCount(value, safeStart, safeEnd, markerChar);
    markersInsideSelection = markerCount > 0;
    if (!markerCount) {
      const underscoreCount = getSelectedMarkerCount(value, safeStart, safeEnd, "_");
      if (underscoreCount) {
        markerChar = "_";
        markerCount = underscoreCount;
        markersInsideSelection = true;
      }
    }
  }

  const currentStyle = markerCountToStyle(markerCount);
  const nextStyle = { ...currentStyle, [format]: !currentStyle[format] };
  const nextMarker = styleToMarker(nextStyle, markerChar);
  const selectedText = markersInsideSelection
    ? value.slice(safeStart + markerCount, safeEnd - markerCount)
    : value.slice(safeStart, safeEnd);

  if (markerCount) {
    const outerStart = markersInsideSelection ? safeStart : safeStart - markerCount;
    const outerEnd = markersInsideSelection ? safeEnd : safeEnd + markerCount;
    return {
      text: value.slice(0, outerStart) + nextMarker + selectedText + nextMarker + value.slice(outerEnd),
      selectionStart: outerStart + nextMarker.length,
      selectionEnd: outerStart + nextMarker.length + selectedText.length,
    };
  }

  return {
    text: value.slice(0, safeStart) + nextMarker + selectedText + nextMarker + value.slice(safeEnd),
    selectionStart: safeStart + nextMarker.length,
    selectionEnd: safeEnd + nextMarker.length,
  };
};

export { formatMarkdownSelection };
