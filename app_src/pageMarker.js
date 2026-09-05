// A page marker occupies its own line; dialogue mentioning a page is text.
export const parsePageMarker = (text) => {
  const match = typeof text === 'string' && /^\s*Page\s+([0-9]+)\s*$/i.exec(text);
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
};
