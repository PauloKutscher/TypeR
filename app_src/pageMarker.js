// Single source of truth for "this line starts a new page".
//
// Scripts write the marker in many shapes: "Page 43", "Pg43", "PG 43",
// "page43", "Page-43", "Pgs. 43", and the Portuguese "Pag 11", "Pág. 11",
// "Página 11". What they all share is a page word at the START of the line
// followed by a number, so that is what we match. The `^` anchor is what keeps
// "Chapter 43", "Version 43" and a bare "43" out — a number alone never means
// a page.
//
// What may follow the number is deliberately narrow: end of line, or a colon or
// dash before a title ("Page 43 - Final Chapter"), or a full stop. A line that
// merely mentions a page in the middle of dialogue ("Page 3 notes") is not a
// heading, and letting arbitrary trailing text through turned those into page
// breaks.
const PAGE_MARKER_PATTERN = /^(?:p[áa]ginas?|pages?|p[áa]gs?|pgs?)\s*[.:#\-–—]?\s*([0-9]+)\s*(?:(?::|[-–—])\s*.*|\.)?$/i;

// Headings arrive wrapped as often as they arrive bare: "## Page 12",
// "### Page 12 ###" and "[Page 12]" are all the same marker.
const stripHeadingWrapper = (text) => {
  let heading = text.trim().replace(/^#{1,6}\s+/, "").replace(/\s+#+$/, "").trim();
  if (heading[0] === "[" && heading[heading.length - 1] === "]") {
    heading = heading.slice(1, -1).trim();
  }
  return heading;
};

// Returns the page number, or null when the text is not a page marker.
const parsePageMarker = (text) => {
  if (typeof text !== "string") return null;
  const match = PAGE_MARKER_PATTERN.exec(stripHeadingWrapper(text));
  if (!match) return null;
  const page = Number(match[1]);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
};

const matchPageMarker = parsePageMarker;

const isPageMarker = (text) => parsePageMarker(text) !== null;

export { PAGE_MARKER_PATTERN, parsePageMarker, matchPageMarker, isPageMarker };
