import "./textBlock.scss";

import React from "react";
import PropTypes from "prop-types";
import { FiArrowRightCircle, FiTarget } from "react-icons/fi";

import config from "../../config";
import { locale, setActiveLayerText, resizeTextArea, scrollToLine, openFile, convertHtmlToMarkdown, parseMarkdownRuns } from "../../utils";
import { useContext } from "../../context";

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Extracted memoized line component to avoid re-rendering every line on each render
const LineItem = React.memo(function LineItem({ line, direction, isCurrent, dispatch, renderHighlightedText, lineNum }) {
  const className = "text-line" +
    (line.ignore ? " m-empty" : "") +
    (isCurrent ? " m-current" : "") +
    (line.rawText.match(/Page [0-9]+/i) ? " m-page" : "");

  const handleSelect = React.useCallback(() => {
    dispatch({ type: "setCurrentLineIndex", index: line.rawIndex });
  }, [dispatch, line.rawIndex]);

  const handleInsert = React.useCallback(() => {
    setActiveLayerText(line.text, null, direction, (ok) => {
      if (ok) {
        dispatch({ type: "nextLine", add: true });
      }
    });
  }, [dispatch, line.text, direction]);

  return (
    <div className={className}>
      <div className="text-line-num" title={String(lineNum || "")}>{lineNum}</div>
      <div className="text-line-select" title={line.ignore ? "" : locale.selectLine}>
        {line.ignore ? " " : <FiTarget size={14} onClick={handleSelect} />}
      </div>
      <div className="text-line-text" dir={direction}>
        {line.ignorePrefix ? (
          <React.Fragment>
            <span className="text-line-ignore-prefix">{line.ignorePrefix}</span>
            {renderHighlightedText(line.rawText.slice(line.ignorePrefix.length))}
          </React.Fragment>
        ) : line.stylePrefix ? (
          <React.Fragment>
            <span className="text-line-style-prefix" style={{ background: line.style?.prefixColor || config.defaultPrefixColor }}>
              {line.stylePrefix}
            </span>
            {renderHighlightedText(line.rawText.slice(line.stylePrefix.length))}
          </React.Fragment>
        ) : (
          renderHighlightedText(line.rawText)
        )}
      </div>
      <div className="text-line-insert" title={line.ignore ? "" : locale.insertText}>
        {line.ignore ? " " : <FiArrowRightCircle size={14} onClick={handleInsert} />}
      </div>
    </div>
  );
});
LineItem.propTypes = {
  line: PropTypes.object.isRequired,
  direction: PropTypes.string.isRequired,
  isCurrent: PropTypes.bool.isRequired,
  dispatch: PropTypes.func.isRequired,
  renderHighlightedText: PropTypes.func.isRequired,
  lineNum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
};

const TextBlock = React.memo(function TextBlock() {
  const context = useContext();
  const direction = context.state.direction || "ltr";
  const markdownEnabled = context.state.interpretMarkdown !== false;
  const [focused, setFocused] = React.useState(false);
  const lastOpenedPath = React.useRef(null);
  const textAreaRef = React.useRef(null);

  // Fix: only resize when text changes, not on every render
  React.useEffect(resizeTextArea, [context.state.text]);

  React.useEffect(() => {
    scrollToLine(context.state.currentLineIndex, 1000);
  }, [context.state.currentLineIndex]);

  const ignoreTags = React.useMemo(
    () => (context.state.ignoreTags || []).filter((tag) => tag),
    [context.state.ignoreTags]
  );
  const ignoreTagsPattern = React.useMemo(() => {
    if (!ignoreTags.length) return null;
    const pattern = ignoreTags.map((tag) => escapeRegExp(tag)).join("|");
    return pattern || null;
  }, [ignoreTags]);

  // Memoize the RegExp so it's not recreated on every renderHighlightedText call
  const ignoreTagsRegex = React.useMemo(() => {
    if (!ignoreTagsPattern) return null;
    return new RegExp(`(${ignoreTagsPattern})`, "g");
  }, [ignoreTagsPattern]);

  const renderMarkdownText = React.useCallback(
    (text, keyPrefix = "md") => {
      if (!markdownEnabled) return text;
      const parsed = parseMarkdownRuns(text);
      if (!parsed.hasFormatting) {
        return parsed.text;
      }
      return parsed.runs.map((run, index) => {
        const runStyle = {};
        if (run.bold) runStyle.fontWeight = "bold";
        if (run.italic) runStyle.fontStyle = "italic";
        return (
          <span key={`${keyPrefix}-${index}`} style={runStyle}>
            {run.text}
          </span>
        );
      });
    },
    [markdownEnabled]
  );

  const renderMarkdownOverlay = React.useCallback(
    (text) => {
      if (!markdownEnabled) return text;
      const parsed = parseMarkdownRuns(text || "");
      const segments = parsed.overlaySegments || [];
      if (!segments.length) return text;
      return segments.map((segment, index) => {
        const style = {};
        if (segment.bold) style.fontWeight = "bold";
        if (segment.italic) style.fontStyle = "italic";
        if (segment.hidden) style.visibility = "hidden";
        return (
          <span key={`overlay-${index}`} style={style}>
            {segment.text || " "}
          </span>
        );
      });
    },
    [markdownEnabled]
  );

  const renderHighlightedText = React.useCallback(
    (text) => {
      if (text === undefined || text === null || text === "") {
        return <span>{" "}</span>;
      }
      if (!ignoreTagsRegex) {
        return <span>{renderMarkdownText(text)}</span>;
      }
      const parts = text.split(ignoreTagsRegex);
      const nodes = parts.map((part, index) => {
        if (!part) return null;
        if (index % 2 === 1) {
          return (
            <span key={`ignore-${index}`} className="text-line-ignore-tag">
              {part}
            </span>
          );
        }
        return (
          <React.Fragment key={`text-${index}`}>
            {renderMarkdownText(part, `md-${index}`)}
          </React.Fragment>
        );
      });
      const hasContent = nodes.some((node) => node !== null);
      if (!hasContent) {
        return <span>{" "}</span>;
      }
      return nodes;
    },
    [ignoreTagsRegex, renderMarkdownText]
  );

  React.useEffect(() => {
    let pageIndex = 0;
    let currentPage = 0;
    for (const line of context.state.lines) {
      if (line.ignore) {
        const page = line.rawText.match(/Page ([0-9]+)/i);
        if (page && context.state.images[page[1] - 1]) {
          const img = context.state.images[page[1] - 1];
          currentPage = context.state.images.indexOf(img);
        }
      }
      if (line.rawIndex === context.state.currentLineIndex) {
        pageIndex = currentPage;
        break;
      }
    }
    const image = context.state.images[pageIndex];
    if (image && image.path !== lastOpenedPath.current) {
      openFile(image.path, context.state.autoClosePSD);
      lastOpenedPath.current = image.path;
      context.dispatch({ type: "setLastOpenedImagePath", path: image.path });
    }
  }, [context.state.currentLineIndex, context.state.autoClosePSD, context.state.images, context.state.lines]);

  // Precompute line numbers (handles the cumulative page counter)
  const linesWithNums = React.useMemo(() => {
    let currentPage = 0;
    return context.state.lines.map((line) => {
      let lineNum;
      if (line.ignore) {
        const page = line.rawText.match(/Page ([0-9]+)/i);
        if (page && context.state.images[page[1] - 1]) {
          const currentImage = context.state.images[page[1] - 1];
          currentPage = context.state.images.indexOf(currentImage);
          lineNum = currentImage.name;
        } else {
          lineNum = " ";
        }
      } else {
        lineNum = line.index;
      }
      return { line, lineNum };
    });
  }, [context.state.lines, context.state.images]);

  const handlePaste = React.useCallback(
    (event) => {
      const clipboard = event.clipboardData;
      if (!clipboard) return;
      if (!markdownEnabled) return;
      const html = clipboard.getData("text/html");
      if (!html) return;
      const markdown = convertHtmlToMarkdown(html);
      if (!markdown) return;
      const plainText = clipboard.getData("text/plain") || "";
      if (markdown === plainText) return;

      event.preventDefault();
      const currentText = context.state.text || "";
      const textArea = textAreaRef.current;
      const start = textArea ? textArea.selectionStart : currentText.length;
      const end = textArea ? textArea.selectionEnd : currentText.length;
      const nextText = currentText.slice(0, start) + markdown + currentText.slice(end);
      context.dispatch({ type: "setText", text: nextText });
      requestAnimationFrame(() => {
        if (!textArea) return;
        const cursor = start + markdown.length;
        textArea.selectionStart = cursor;
        textArea.selectionEnd = cursor;
      });
    },
    [context.state.text, context.dispatch, markdownEnabled]
  );

  const handleTextChange = React.useCallback(
    (e) => context.dispatch({ type: "setText", text: e.target.value }),
    [context.dispatch]
  );

  // Parsing the whole script for the overlay is costly; only redo it when the
  // text itself changes, not on every unrelated context update
  const overlayContent = React.useMemo(
    () => renderMarkdownOverlay(context.state.text || ""),
    [renderMarkdownOverlay, context.state.text]
  );
  const handleFocus = React.useCallback(() => setFocused(true), []);
  const handleBlur = React.useCallback(() => setFocused(false), []);

  return (
    <React.Fragment>
      <div className="text-lines">
        {linesWithNums.map(({ line, lineNum }) => (
          <LineItem
            key={line.rawIndex}
            line={line}
            direction={direction}
            isCurrent={context.state.currentLineIndex === line.rawIndex}
            dispatch={context.dispatch}
            renderHighlightedText={renderHighlightedText}
            lineNum={lineNum}
          />
        ))}
      </div>
      <div className={"text-area-overlay" + (focused ? " m-hidden" : "")} dir={direction}>
        {overlayContent}
      </div>
      <textarea
        ref={textAreaRef}
        className={"text-area" + (focused ? " m-focused" : "")}
        dir={direction}
        value={context.state.text}
        onChange={handleTextChange}
        onPaste={handlePaste}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
      {!context.state.lines.length && !focused && (
        <div className="text-message" dir={direction}>
          <div>{locale.pasteTextHint}</div>
        </div>
      )}
    </React.Fragment>
  );
});

export default TextBlock;
