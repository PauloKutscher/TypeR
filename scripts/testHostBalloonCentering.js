const assert = require("assert");
const fs = require("fs");
const path = require("path");

const hostSource = fs.readFileSync(
  path.join(__dirname, "..", "app_src", "host.js"),
  "utf8"
);

assert.match(
  hostSource,
  /function _isRectangularShapeES3\(shapeData\)/,
  "Host must define the rectangular-shape guard used by phantom reconstruction"
);
assert.match(
  hostSource,
  /function _fitPhantomEllipseForSelection\(shapeData\)[\s\S]*?_isRectangularShapeES3\(shapeData\)/,
  "Phantom fitting must use the host rectangular-shape guard"
);
assert.match(
  hostSource,
  /targetNormX = visualCentroidX \* 0\.4 \+ visibleMidX \* 0\.6 - cutShift;/,
  "Host left-cut centering must use the balanced geometry formula"
);
assert.match(
  hostSource,
  /targetNormY = visualCentroidY \* 0\.6 \+ 0\.5 \* 0\.4 \+ 0\.06;/,
  "Host horizontal-cut centering must use the balanced geometry formula"
);
assert.match(
  hostSource,
  /var maxShiftX = 0\.25;[\s\S]*?var maxShiftY = 0\.25;/,
  "Host phantom offsets must use the safe 25% clamp"
);

const positionStart = hostSource.indexOf("function _positionLayerWithinSelection");
const positionEnd = hostSource.indexOf("\nfunction _createMagicWandSelection", positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart, "Host positioning helper must be readable");
const positionSource = hostSource.slice(positionStart, positionEnd);

assert.match(positionSource, /var boundXMid = bounds\.xMid;/);
assert.doesNotMatch(
  positionSource,
  /boundXMid\s*-=/,
  "Italic text must not receive a fixed horizontal offset from its font size"
);

console.log("host balloon centering tests passed");
