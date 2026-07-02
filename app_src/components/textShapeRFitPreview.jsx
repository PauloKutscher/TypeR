import React from "react";

// Scales a TextShapeR variant preview down so the whole shape stays visible
// inside its card instead of being clipped by overflow
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
      const next = Math.min(1, outer.clientWidth / width, outer.clientHeight / height);
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
        style={{ ...style, transform: scale < 1 ? `scale(${scale})` : undefined }}
      >
        {children}
      </span>
    </span>
  );
};

export default TextShapeRFitPreview;
