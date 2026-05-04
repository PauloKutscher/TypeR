const getNextLineNumberState = ({ linesCounter, isPage, ignore, resetLineCounterOnPage }) => {
  const counterAfterPage = isPage && resetLineCounterOnPage !== false ? 0 : linesCounter;
  if (ignore) {
    return { linesCounter: counterAfterPage, index: 0 };
  }
  const nextCounter = counterAfterPage + 1;
  return { linesCounter: nextCounter, index: nextCounter };
};

export { getNextLineNumberState };
