import React from "react";

// Scales a TextShapeR variant preview down so the whole shape stays visible
// inside its card, and grows it when the user gives the preview more room
const TextShapeRFitPreview = ({ outerClassName, innerClassName, contentKey, style, children }) => {
  const outerRef = React.useRef(null);
  const innerRef = React.useRef(null);
  const [scale, setScale] = React.useState(1);

  React.useLayoutEffect(() => {
    const fit = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;
      const width = inner.offsetWidth;
      const height = inner.offsetHeight;
      if (!width || !height) return;
      // Keep compact suggestions visually consistent: a short variant should
      // not become much larger than a longer sibling just because it fits.
      // The ceiling grows with the card, so expanded previews remain unbounded.
      const breathingRoom = 0.9 + Math.min(0.1, outer.clientHeight / 4000);
      const fittedScale = Math.min(outer.clientWidth / width, outer.clientHeight / height) * breathingRoom;
      const compactScaleCeiling = Math.max(1.5, outer.clientHeight / 36);
      const next = Math.min(fittedScale, compactScaleCeiling);
      setScale((current) => (Math.abs(current - next) > 0.02 ? next : current));
    };
    fit();
    let observer = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(fit);
      observer.observe(outerRef.current);
    } else {
      window.addEventListener("resize", fit);
    }
    return () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", fit);
    };
  }, [contentKey]);

  return (
    <span ref={outerRef} className={outerClassName}>
      <span
        ref={innerRef}
        className={innerClassName}
        style={{ ...style, transform: Math.abs(scale - 1) > 0.02 ? `scale(${scale})` : undefined }}
      >
        {children}
      </span>
    </span>
  );
};

export default TextShapeRFitPreview;
