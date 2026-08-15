const assert = require("assert");
const { loadAppModule } = require("./loadAppModule.js");


const {
  fitEllipseDirect,
  extractIntactArcPoints,
  generateEllipseProfileRows,
  reconstructPhantomBalloon,
} = loadAppModule("app_src/phantomEllipse.js");

// 1. Test fitting an intact known ellipse: center=(200, 300), a=100, b=150
const intactPoints = [];
const trueCx = 200;
const trueCy = 300;
const trueA = 100;
const trueB = 150;
for (let deg = 0; deg < 360; deg += 10) {
  const rad = (deg * Math.PI) / 180;
  intactPoints.push([trueCx + trueA * Math.cos(rad), trueCy + trueB * Math.sin(rad)]);
}

const intactFit = fitEllipseDirect(intactPoints);
assert.ok(intactFit !== null, "Intact ellipse must fit successfully");
assert.ok(Math.abs(intactFit.centerX - trueCx) < 0.5, `Expected cx=${trueCx}, got ${intactFit.centerX}`);
assert.ok(Math.abs(intactFit.centerY - trueCy) < 0.5, `Expected cy=${trueCy}, got ${intactFit.centerY}`);
assert.ok(Math.abs(intactFit.a - trueB) < 1.0, `Expected semi-major=${trueB}, got ${intactFit.a}`);
assert.ok(Math.abs(intactFit.b - trueA) < 1.0, `Expected semi-minor=${trueA}, got ${intactFit.b}`);

// 2. Test a manga balloon cut on the left by a vertical gutter:
// True ellipse is at center=(200, 200), radii a=100, b=120.
// The balloon is cut at x = 170 (30px into the balloon).
// The visible bounding box is x in [170, 300] (width 130, mid 235), y in [80, 320] (height 240, mid 200).
// Visible polygon consists of the intact arc on the right (angles from -75° to +75° / 285° to 435°) and a straight vertical cut on x=170.
const cutLeftPoints = [];
for (let deg = -75; deg <= 75; deg += 5) {
  const rad = (deg * Math.PI) / 180;
  cutLeftPoints.push([200 + 100 * Math.cos(rad), 200 + 120 * Math.sin(rad)]);
}
// Straight cut points
cutLeftPoints.push([170, 200 + 120 * Math.sin((75 * Math.PI) / 180)]);
cutLeftPoints.push([170, 200]);
cutLeftPoints.push([170, 200 + 120 * Math.sin((-75 * Math.PI) / 180)]);

const cutLeftShape = {
  bounds: {
    left: 170,
    right: 300,
    top: 80,
    bottom: 320,
    width: 130,
    height: 240,
    xMid: 235,
    yMid: 200,
  },
  polygons: [cutLeftPoints],
};

const cutLeftReconstruction = reconstructPhantomBalloon(cutLeftShape);
assert.ok(cutLeftReconstruction !== null, "Left cut balloon must reconstruct successfully");
assert.ok(cutLeftReconstruction.hasCompletion, "Should detect completion/cut");
// The true center is at x=200. The bounding box xMid is at 235.
// So pixelOffsetX should be ~ -35px (shifting left towards the imaginary balloon center).
assert.ok(
  cutLeftReconstruction.pixelOffsetX < -15,
  `Expected negative pixelOffsetX, got ${cutLeftReconstruction.pixelOffsetX}`
);
assert.ok(
  Math.abs(cutLeftReconstruction.pixelOffsetY) < 5,
  `Expected minimal pixelOffsetY for pure vertical cut, got ${cutLeftReconstruction.pixelOffsetY}`
);

// 3. Test an angled diagonal manga cut (e.g. cut diagonally across bottom-right by an action line):
// True ellipse is at center=(300, 300), radii a=120, b=120.
// Intact arc spans angles 60° to 260°.
const angledCutPoints = [];
for (let deg = 60; deg <= 260; deg += 5) {
  const rad = (deg * Math.PI) / 180;
  angledCutPoints.push([300 + 120 * Math.cos(rad), 300 + 120 * Math.sin(rad)]);
}
// Add diagonal cut closing segment
const pStart = angledCutPoints[angledCutPoints.length - 1];
const pEnd = angledCutPoints[0];
angledCutPoints.push([(pStart[0] + pEnd[0]) / 2, (pStart[1] + pEnd[1]) / 2]);

const angledShape = {
  bounds: {
    left: 180,
    right: 360,
    top: 180,
    bottom: 420,
    width: 180,
    height: 240,
    xMid: 270,
    yMid: 300,
  },
  polygons: [angledCutPoints],
};

const angledReconstruction = reconstructPhantomBalloon(angledShape);
assert.ok(angledReconstruction !== null, "Angled cut balloon must reconstruct successfully");
// Reconstructed center should be close to true center (300, 300)
assert.ok(
  Math.abs(angledReconstruction.ellipse.centerX - 300) < 15,
  `Expected reconstructed centerX ~ 300, got ${angledReconstruction.ellipse.centerX}`
);
assert.ok(
  Math.abs(angledReconstruction.ellipse.centerY - 300) < 15,
  `Expected reconstructed centerY ~ 300, got ${angledReconstruction.ellipse.centerY}`
);

// 4. Test top/bottom cut (e.g. cut by character head/shoulder):
// True ellipse is at center=(200, 200), radii a=100, b=100.
// Cut off the bottom half (y >= 200).
const topArcPoints = [];
for (let deg = 180; deg <= 360; deg += 6) {
  const rad = (deg * Math.PI) / 180;
  topArcPoints.push([200 + 100 * Math.cos(rad), 200 + 100 * Math.sin(rad)]);
}
topArcPoints.push([200, 200]);

const bottomCutShape = {
  bounds: {
    left: 100,
    right: 300,
    top: 100,
    bottom: 200,
    width: 200,
    height: 100,
    xMid: 200,
    yMid: 150,
  },
  polygons: [topArcPoints],
};

const bottomCutReconstruction = reconstructPhantomBalloon(bottomCutShape);
assert.ok(bottomCutReconstruction !== null, "Bottom cut balloon must reconstruct successfully");
// yMid is 150, true center is 200, so pixelOffsetY should be positive. The
// reconstruction intentionally caps the normalized correction at 25% so a
// partial scan cannot move text outside the usable selection.
assert.ok(
  bottomCutReconstruction.pixelOffsetY > 0 && bottomCutReconstruction.pixelOffsetY <= 25,
  `Expected safe positive pixelOffsetY <= 25, got ${bottomCutReconstruction.pixelOffsetY}`
);

// 5. Test clean fallback on rectangular boxes (e.g. narration box with 0 curvature)
const rectanglePoints = [
  [100, 100], [200, 100], [300, 100],
  [300, 150], [300, 200],
  [200, 200], [100, 200],
  [100, 150],
];
const rectShape = {
  bounds: { left: 100, right: 300, top: 100, bottom: 200, width: 200, height: 100, xMid: 200, yMid: 150 },
  polygons: [rectanglePoints],
};
const rectReconstruction = reconstructPhantomBalloon(rectShape);
// Should either be rejected (null) or have near-zero / well-behaved offsets
if (rectReconstruction) {
  assert.ok(Math.abs(rectReconstruction.offsetX) < 0.2);
}

// 6. Test profile row generation
const generatedRows = generateEllipseProfileRows(intactFit, { left: 100, right: 300, top: 150, bottom: 450, width: 200, height: 300 }, null, 21);
assert.ok(Array.isArray(generatedRows) && generatedRows.length === 21);
assert.ok(generatedRows[10].width > generatedRows[0].width);
assert.ok(generatedRows[10].width > generatedRows[20].width);

// 7. Test extreme cut with tolerance & safety clamping (very tall vertical cut):
// True ellipse is very tall (a=80, b=300), but cut off by 70% of its width.
const extremeTallPoints = [];
for (let deg = -50; deg <= 50; deg += 4) {
  const rad = (deg * Math.PI) / 180;
  extremeTallPoints.push([100 + 80 * Math.cos(rad), 400 + 200 * Math.sin(rad)]);
}
extremeTallPoints.push([100, 400 + 200 * Math.sin((50 * Math.PI) / 180)]);
extremeTallPoints.push([100, 400 + 200 * Math.sin((-50 * Math.PI) / 180)]);

const extremeCutShape = {
  bounds: {
    left: 100,
    right: 180,
    top: 200,
    bottom: 600,
    width: 80,
    height: 400,
    xMid: 140,
    yMid: 400,
  },
  polygons: [extremeTallPoints],
};

const extremeReconstruction = reconstructPhantomBalloon(extremeCutShape);
if (extremeReconstruction) {
  // Must be safely clamped within [-0.25, 0.25]
  assert.ok(
    Math.abs(extremeReconstruction.offsetX) <= 0.25,
    `offsetX must be safely clamped <= 0.25, got ${extremeReconstruction.offsetX}`
  );
  assert.ok(
    Math.abs(extremeReconstruction.offsetY) <= 0.25,
    `offsetY must be safely clamped <= 0.25, got ${extremeReconstruction.offsetY}`
  );
  // Reconstructed pixel offset should not exceed 25% of width (20px)
  assert.ok(Math.abs(extremeReconstruction.pixelOffsetX) <= 20.01);
}

// 8. Test visible rows intersection safety in generateEllipseProfileRows
const cutVisibleRows = Array.from({ length: 21 }, (_, i) => ({
  y: i / 20,
  left: 0.3, // cut at left 30%
  right: 1.0,
  width: 0.7,
}));
const safeRows = generateEllipseProfileRows(
  intactFit,
  { left: 100, right: 300, top: 150, bottom: 450, width: 200, height: 300 },
  cutVisibleRows,
  21
);
// On rows with cutVisibleRows, left should never be smaller than 0.3 (should not spill to the cut side)
// 9. Test Flattened / Achatado Squircle Balloon (Super-ellipse)
const squircleRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const dy = Math.abs(2 * y - 1);
  const halfW = Math.pow(Math.max(0, 1 - Math.pow(dy, 4)), 0.25) * 0.48;
  squircleRows.push({ y, left: 0.5 - halfW, right: 0.5 + halfW, width: 2 * halfW });
}
const squircleShape = {
  bounds: { left: 0, right: 300, top: 0, bottom: 200, width: 300, height: 200, xMid: 150, yMid: 100 },
  rows: squircleRows,
};
const squircleReconstruction = reconstructPhantomBalloon(squircleShape);
assert.ok(squircleReconstruction !== null);
assert.ok(Math.abs(squircleReconstruction.offsetX) < 0.02, `Flattened squircle offsetX must be ~0, got ${squircleReconstruction.offsetX}`);
assert.ok(Math.abs(squircleReconstruction.offsetY) < 0.02, `Flattened squircle offsetY must be ~0, got ${squircleReconstruction.offsetY}`);

// 10. Test Organic Hand-drawn Balloon
const organicRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const dy = Math.abs(2 * y - 1);
  const halfW = Math.sqrt(Math.max(0, 1 - dy * dy)) * 0.45;
  const wobble = Math.sin(y * Math.PI * 2) * 0.02;
  organicRows.push({ y, left: 0.5 - halfW + wobble, right: 0.5 + halfW + wobble, width: 2 * halfW });
}
const organicShape = {
  bounds: { left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200, xMid: 100, yMid: 100 },
  rows: organicRows,
};
const organicReconstruction = reconstructPhantomBalloon(organicShape);
assert.ok(organicReconstruction !== null);
assert.ok(Math.abs(organicReconstruction.offsetX) < 0.03);
assert.ok(Math.abs(organicReconstruction.offsetY) < 0.03);

console.log("phantomEllipse tests passed");
