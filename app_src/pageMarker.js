// Single source of truth for "this line starts a new page".
//
// Scripts write the marker in many shapes: "Page 43", "Pg43", "PG 43",
// "page43", "Page-43", "Pgs. 43", and the Portuguese "Pag 11", "Pág. 11",
// "Página 11". What they all share is a page word at the START of the line
// followed by a number, so that is what we match. The `^` anchor is what keeps
// "Chapter 43", "Version 43" and a bare "43" out — a number alone never means
// a page. Trailing text is allowed so existing scripts writing
// "Page 43 - Final Chapter" keep working.
const PAGE_MARKER_PATTERN = /^\s*(?:p[áa]ginas?|pages?|p[áa]gs?|pgs?)\s*[.:#\-–—]?\s*([0-9]+)\b/i;

// Returns the page number, or null when the text is not a page marker.
const matchPageMarker = (text) => {
  const match = typeof text === "string" ? text.match(PAGE_MARKER_PATTERN) : null;
  return match ? Number(match[1]) : null;
};

const isPageMarker = (text) => matchPageMarker(text) !== null;

export { PAGE_MARKER_PATTERN, matchPageMarker, isPageMarker };
