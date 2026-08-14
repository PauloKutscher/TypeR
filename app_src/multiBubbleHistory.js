import { isPageMarker } from "./pageMarker";

const getFirstUsableLineIndexOnCurrentPage = (lines, currentLineIndex) => {
  if (!Array.isArray(lines) || !lines.length) return currentLineIndex;

  const currentPosition = lines.findIndex((line) => line.rawIndex === currentLineIndex);
  if (currentPosition < 0) return currentLineIndex;

  let pageStartPosition = 0;
  for (let index = currentPosition; index >= 0; index -= 1) {
    if (isPageMarker(lines[index].rawText || "")) {
      pageStartPosition = index + 1;
      break;
    }
  }

  for (let index = pageStartPosition; index <= currentPosition; index += 1) {
    if (!lines[index].ignore) return lines[index].rawIndex;
  }

  return currentLineIndex;
};

// Re-clicking a bubble that is already stored produces bounds a pixel or two
// off, which an exact comparison counts as a brand new bubble: the extra entry
// then shifts every text one selection down the list at paste time. Same 5px
// tolerance the host uses to decide a selection did not really change.
export const isDuplicateSelection = (storedSelections, selection, tolerance = 5) => {
  if (!selection || !Array.isArray(storedSelections)) return false;
  return storedSelections.some((stored) => (
    stored &&
    Math.abs(stored.top - selection.top) <= tolerance &&
    Math.abs(stored.left - selection.left) <= tolerance &&
    Math.abs(stored.right - selection.right) <= tolerance &&
    Math.abs(stored.bottom - selection.bottom) <= tolerance
  ));
};

export const getStoredSelectionLineIndex = (selection, fallbackLineIndex, lines = []) => {
  if (!selection || typeof selection.lineIndex !== "number") return fallbackLineIndex;
  if (!Array.isArray(lines) || !lines.length) return selection.lineIndex;

  const firstCurrentPageLineIndex = getFirstUsableLineIndexOnCurrentPage(lines, fallbackLineIndex);
  return selection.lineIndex < firstCurrentPageLineIndex
    ? firstCurrentPageLineIndex
    : selection.lineIndex;
};
