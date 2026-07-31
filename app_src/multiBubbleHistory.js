export const getStoredSelectionLineIndex = (selection, fallbackLineIndex) => (
  selection && typeof selection.lineIndex === "number"
    ? selection.lineIndex
    : fallbackLineIndex
);
