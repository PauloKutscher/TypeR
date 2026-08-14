const MARKDOWN_MARKERS = [
  { token: "***", bold: true, italic: true },
  { token: "___", bold: true, italic: true },
  { token: "**", bold: true, italic: false },
  { token: "__", bold: true, italic: false },
  { token: "*", bold: false, italic: true },
  { token: "_", bold: false, italic: true },
];

const isEscapedMarkdown = (text, index) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
};

const findUnescapedToken = (text, token, start) => {
  let index = text.indexOf(token, start);
  while (index !== -1 && isEscapedMarkdown(text, index)) {
    index = text.indexOf(token, index + 1);
  }
  return index;
};

const findNextMarker = (text, start) => {
  let best = null;
  for (const marker of MARKDOWN_MARKERS) {
    const index = findUnescapedToken(text, marker.token, start);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && marker.token.length > best.marker.token.length)) {
      best = { index, marker };
    }
  }
  return best;
};

const unescapeMarkdownText = (text) => {
  return text.replace(/\\\\/g, "\\").replace(/\\\*/g, "*").replace(/\\_/g, "_");
};

const parseMarkdownRuns = (input) => {
  const text = typeof input === "string" ? input : "";
  const runs = [];
  const overlaySegments = [];

  const pushRun = (segment, style) => {
    if (!segment) return;
    const cleaned = unescapeMarkdownText(segment);
    if (!cleaned) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic) {
      last.text += cleaned;
    } else {
      runs.push({ text: cleaned, bold: style.bold, italic: style.italic });
    }
  };

  const pushOverlaySegment = (segment, style, hidden, marker) => {
    if (!segment) return;
    const last = overlaySegments[overlaySegments.length - 1];
    if (
      last &&
      last.hidden === hidden &&
      last.marker === marker &&
      last.bold === style.bold &&
      last.italic === style.italic
    ) {
      last.text += segment;
    } else {
      overlaySegments.push({ text: segment, bold: style.bold, italic: style.italic, hidden, marker });
    }
  };

  const pushOverlayText = (segment, style) => {
    if (!segment) return;
    let buffer = "";
    for (let i = 0; i < segment.length; i++) {
      const char = segment[i];
      const next = segment[i + 1];
      const isEscaped = char === "\\" && (next === "\\" || next === "*" || next === "_");
      if (isEscaped) {
        if (buffer) {
          pushOverlaySegment(buffer, style, false);
          buffer = "";
        }
        // Keep the backslash width for caret alignment but hide it
        pushOverlaySegment("\\", style, true);
        // Render the escaped character visibly
        pushOverlaySegment(next === "\\" ? "\\" : next, style, false);
        i += 1;
        continue;
      }
      buffer += char;
    }
    if (buffer) {
      pushOverlaySegment(buffer, style, false);
    }
  };

  const walk = (segment, style) => {
    let cursor = 0;
    while (cursor < segment.length) {
      const match = findNextMarker(segment, cursor);
      if (!match) {
        const tail = segment.slice(cursor);
        pushRun(tail, style);
        pushOverlayText(tail, style);
        break;
      }
      if (match.index > cursor) {
        const before = segment.slice(cursor, match.index);
        pushRun(before, style);
        pushOverlayText(before, style);
      }
      const afterOpen = match.index + match.marker.token.length;
      const closeIndex = findUnescapedToken(segment, match.marker.token, afterOpen);
      if (closeIndex === -1) {
        const unmatched = segment.slice(match.index, afterOpen);
        pushRun(unmatched, style);
        pushOverlayText(unmatched, style);
        cursor = afterOpen;
        continue;
      }
      // Opening marker: keep width for alignment
      pushOverlaySegment(match.marker.token, style, true, "open");
      const inner = segment.slice(afterOpen, closeIndex);
      const nextStyle = {
        bold: style.bold || match.marker.bold,
        italic: style.italic || match.marker.italic,
      };
      walk(inner, nextStyle);
      // Closing marker: keep width for alignment
      pushOverlaySegment(match.marker.token, style, true, "close");
      cursor = closeIndex + match.marker.token.length;
    }
  };

  walk(text, { bold: false, italic: false });

  const plainText = runs.map((run) => run.text).join("");
  const hasFormatting = runs.some((run) => run.bold || run.italic);
  return { text: plainText, runs, hasFormatting, overlaySegments };
};

const escapeMarkdownText = (text) => {
  return text.replace(/\\/g, "\\\\").replace(/\*/g, "\\*").replace(/_/g, "\\_");
};

// Two equivalent marker families. Adjacent styled runs alternate between them
// so their markers never merge into an ambiguous run of 3+ of the same
// character (e.g. "**Bold***Italic*" would silently lose the italic flag
// when re-parsed by parseMarkdownRuns).
const MARKDOWN_FAMILIES = {
  asterisk: { bold: "**", italic: "*", both: "***" },
  underscore: { bold: "__", italic: "_", both: "___" },
};

const wrapStyledRun = (text, bold, italic, family) => {
  const marker = bold && italic ? family.both : bold ? family.bold : family.italic;
  return `${marker}${text}${marker}`;
};

const convertDomToMarkdown = (nodes) => {
  const runs = [];
  let pendingBreak = false;
  let hasContent = false;
  // Whitespace-only text (e.g. a lone &nbsp; inside an empty spacer <p>) is
  // buffered instead of pushed immediately: if real content follows on the
  // same line it's a genuine inter-word space and gets flushed as-is; if a
  // block/br boundary follows instead, it was only boundary padding and is
  // discarded so it can't leave a stray space before/after a collapsed break.
  let pendingWhitespace = "";

  const pushRun = (text, style) => {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.bold === style.bold && last.italic === style.italic) {
      last.text += text;
    } else {
      runs.push({ text, bold: style.bold, italic: style.italic });
    }
  };

  const emitBreak = () => {
    pendingWhitespace = "";
    if (hasContent) pendingBreak = true;
  };

  const pushText = (value, style) => {
    if (!value) return;
    // A single DOM text node can itself contain literal newlines (e.g. a
    // grid/table app that uses CSS white-space:pre instead of <br> tags).
    // Route every embedded newline through the same emitBreak() coalescing
    // used for <br>/block boundaries, so it can't bypass the collapse.
    const segments = value.split(/\r\n|\r|\n/);
    segments.forEach((segment, index) => {
      if (index > 0) emitBreak();
      if (!segment) return;
      const isRealContent = segment.trim() !== "";
      if (!isRealContent) {
        pendingWhitespace += segment;
        return;
      }
      if (pendingBreak) {
        pushRun("\n", { bold: false, italic: false });
        pendingBreak = false;
        pendingWhitespace = "";
      } else if (pendingWhitespace) {
        pushRun(pendingWhitespace, { bold: false, italic: false });
        pendingWhitespace = "";
      }
      pushRun(segment, style);
      hasContent = true;
    });
  };

  const walk = (node, style) => {
    if (node.nodeType === 3) {
      const value = (node.nodeValue || "").replace(/\u00a0/g, " ");
      pushText(value, style);
      return;
    }
    if (node.nodeType !== 1) return;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") {
      emitBreak();
      return;
    }

    const nextStyle = { bold: style.bold, italic: style.italic };
    if (tag === "b" || tag === "strong") nextStyle.bold = true;
    if (tag === "i" || tag === "em") nextStyle.italic = true;

    const inlineStyle = node.getAttribute("style") || "";
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(inlineStyle)) nextStyle.bold = true;
    if (/font-weight\s*:\s*(normal|[1-5]00)/i.test(inlineStyle)) nextStyle.bold = false;
    if (/font-style\s*:\s*italic/i.test(inlineStyle)) nextStyle.italic = true;
    if (/font-style\s*:\s*normal/i.test(inlineStyle)) nextStyle.italic = false;

    const isBlock = /^(p|div|li|ul|ol|tr|td|th|table|thead|tbody)$/i.test(tag);
    if (isBlock) emitBreak();
    for (const child of Array.from(node.childNodes)) {
      walk(child, nextStyle);
    }
    if (isBlock) emitBreak();
  };

  for (const node of nodes) {
    walk(node, { bold: false, italic: false });
  }

  let markdown = "";
  let prevStyledFamily = null;
  for (const run of runs) {
    const escaped = escapeMarkdownText(run.text);
    const isStyled = run.bold || run.italic;
    if (!isStyled) {
      markdown += escaped;
      prevStyledFamily = null;
      continue;
    }
    const family = prevStyledFamily === "asterisk" ? "underscore" : "asterisk";
    markdown += wrapStyledRun(escaped, run.bold, run.italic, MARKDOWN_FAMILIES[family]);
    prevStyledFamily = family;
  }

  return markdown.trim();
};

const convertHtmlToMarkdown = (html) => {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return convertDomToMarkdown(Array.from(doc.body.childNodes));
};

export {
  parseMarkdownRuns,
  convertHtmlToMarkdown,
  convertDomToMarkdown,
};
