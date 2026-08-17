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
  /var maxShiftX = 0\.05;[\s\S]*?var maxShiftY = 0\.05;/,
  "Host phantom offsets must use the safe 5% clamp"
);
assert.match(
  hostSource,
  /var partialArcEvidence = polygons\.length > 0 && angleCoverage < Math\.PI \* 1\.85;/,
  "Ellipse fitting must require evidence of a partial arc"
);

const positionStart = hostSource.indexOf("function _positionLayerWithinSelection");
const positionEnd = hostSource.indexOf("\nfunction _createMagicWandSelection", positionStart);
assert.ok(positionStart >= 0 && positionEnd > positionStart, "Host positioning helper must be readable");
const positionSource = hostSource.slice(positionStart, positionEnd);

assert.match(positionSource, /var boundXMid = bounds\.xMid;/);
assert.match(positionSource, /var boundYMid = bounds\.yMid;/);
assert.doesNotMatch(
  positionSource,
  /isItalic|italicCorrection|textSizePx|fontStyleName/,
  "Square narration centering must not apply italic or DPI heuristics"
);
assert.match(
  hostSource,
  /if \(!state\.phantomGeometryProvided && phantomOffsetX === 0 && phantomOffsetY === 0\)/,
  "A provided zero geometry result must not trigger a second host-side fit"
);
assert.match(
  hostSource,
  /selection = _checkSelection\(\{ adaptiveOpen: !state\.phantomGeometryProvided \}\);/,
  "Provided geometry must use the same selection frame that was sampled"
);
assert.match(
  hostSource,
  /state\.phantomGeometryProvided = !!\(data && data\.phantomGeometryProvided === true\)/,
  "Host must preserve whether geometry was explicitly supplied"
);
assert.match(
  hostSource,
  /function _buildPathShapeRows\(polygons, sampleCount, referenceBounds\)[\s\S]*?\(left - frameLeft\) \/ width[\s\S]*?_buildPathShapeRows\(polygons, sampleCount, bounds\)/,
  "Path scan rows must use the same coordinate frame as the selection bounds"
);
assert.match(
  hostSource,
  /function _getCurrentRenderedTextBounds\(\)[\s\S]*?_changeToPointText\(\)[\s\S]*?_getCurrentTextLayerBounds\(\)/,
  "Positioning must be able to measure the rendered wrapped glyph bounds"
);
assert.match(
  hostSource,
  /function _createTextLayersInStoredSelections\(\)[\s\S]*?phantomOffsetX[\s\S]*?phantomOffsetY[\s\S]*?useSafetyMargin[\s\S]*?_positionLayerWithinSelection\(selection, bounds, phantomOffsetX, phantomOffsetY, useSafetyMargin\)/,
  "Multi-bubble batch paste must apply geometric offsets and strict safety margin checks"
);
assert.match(
  hostSource,
  /function getSelectionChanged\(\)[\s\S]*?phantomOffsetX[\s\S]*?phantomOffsetY[\s\S]*?isCut[\s\S]*?isRectangular/,
  "Selection capture must sample and store geometric analysis for each selection"
);
assert.match(
  hostSource,
  /if \(!adjustedSelection \|\| adjustedSelection\.width < 2 \|\| adjustedSelection\.height < 2 \|\| adjustedSelection\.width \* adjustedSelection\.height < 4\)/,
  "Selection check must accept small valid selections without arbitrary 200px threshold"
);
assert.match(
  hostSource,
  /if \(curDocW > 0 && curDocH > 0 && selection\.width >= curDocW \* 0\.96 && selection\.height >= curDocH \* 0\.96\)/,
  "Centering fallback must prevent magic wand leaks to whole canvas"
);

console.log("host balloon centering tests passed");


