const assert = require("assert");
const { loadAppModule } = require("./loadAppModule.js");

const {
  analyzeMangaBalloonGeometry,
  isRectangularShape,
  reconstructPhantomBalloon,
} = loadAppModule("app_src/phantomEllipse.js");

console.log("Running Manga Balloon Centering Tests...");

// Case 1: Pure Round / Elliptical Balloon
const circleRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const rad = Math.asin(Math.max(-1, Math.min(1, 2 * y - 1)));
  const halfW = Math.cos(rad) * 0.5;
  circleRows.push({ y, left: 0.5 - halfW, right: 0.5 + halfW, width: 2 * halfW });
}
const circleRes = analyzeMangaBalloonGeometry({ bounds: { left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200, xMid: 100, yMid: 100 }, rows: circleRows });
assert.ok(Math.abs(circleRes.offsetX) < 0.01, `Circle offsetX should be ~0, got ${circleRes.offsetX}`);
assert.ok(Math.abs(circleRes.offsetY) < 0.01, `Circle offsetY should be ~0, got ${circleRes.offsetY}`);
console.log("✓ Case 1: Pure Round Balloon passed");

// Case 2: Flattened / Achatado Balloon (Squircle / Super-ellipse)
const squircleRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const dy = Math.abs(2 * y - 1);
  const halfW = Math.pow(Math.max(0, 1 - Math.pow(dy, 4)), 0.25) * 0.48;
  squircleRows.push({ y, left: 0.5 - halfW, right: 0.5 + halfW, width: 2 * halfW });
}
const squircleRes = analyzeMangaBalloonGeometry({ bounds: { left: 0, right: 300, top: 0, bottom: 200, width: 300, height: 200, xMid: 150, yMid: 100 }, rows: squircleRows });
assert.ok(Math.abs(squircleRes.offsetX) < 0.01, `Squircle offsetX should be ~0, got ${squircleRes.offsetX}`);
assert.ok(Math.abs(squircleRes.offsetY) < 0.01, `Squircle offsetY should be ~0, got ${squircleRes.offsetY}`);
console.log("✓ Case 2: Flattened / Achatado Squircle passed");

// Case 3: Left Cut Balloon (Vertical Gutter on Left)
const leftCutRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const rad = Math.asin(Math.max(-1, Math.min(1, 2 * y - 1)));
  const intactRight = 0.5 + Math.cos(rad) * 0.5;
  const cutLeft = 0.0;
  leftCutRows.push({ y, left: cutLeft, right: intactRight, width: intactRight - cutLeft });
}
const leftCutRes = analyzeMangaBalloonGeometry({ bounds: { left: 0, right: 150, top: 0, bottom: 200, width: 150, height: 200, xMid: 75, yMid: 100 }, rows: leftCutRows });
assert.ok(leftCutRes.isCut, "Should detect left cut");
assert.strictEqual(leftCutRes.cutType, "left");
assert.ok(leftCutRes.offsetX < 0, `Left cut should shift center leftwards, got ${leftCutRes.offsetX}`);
assert.ok(Math.abs(leftCutRes.offsetX) <= 0.05, `Left cut shift must respect 5% safety, got ${leftCutRes.offsetX}`);
console.log("✓ Case 3: Left Cut Balloon (Gutter) passed, offset:", leftCutRes.offsetX);

// Case 4: Right Cut Balloon (Vertical Gutter on Right)
const rightCutRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const rad = Math.asin(Math.max(-1, Math.min(1, 2 * y - 1)));
  const intactLeft = 0.5 - Math.cos(rad) * 0.5;
  const cutRight = 1.0;
  rightCutRows.push({ y, left: intactLeft, right: cutRight, width: cutRight - intactLeft });
}
const rightCutRes = analyzeMangaBalloonGeometry({ bounds: { left: 0, right: 150, top: 0, bottom: 200, width: 150, height: 200, xMid: 75, yMid: 100 }, rows: rightCutRows });
assert.ok(rightCutRes.isCut, "Should detect right cut");
assert.strictEqual(rightCutRes.cutType, "right");
assert.ok(rightCutRes.offsetX > 0, `Right cut should shift center rightwards, got ${rightCutRes.offsetX}`);
assert.ok(Math.abs(rightCutRes.offsetX) <= 0.05, `Right cut shift must respect 5% safety, got ${rightCutRes.offsetX}`);
console.log("✓ Case 4: Right Cut Balloon (Gutter) passed, offset:", rightCutRes.offsetX);

// Case 5: Hand-drawn / Slightly Asymmetrical Balloon
const organicRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const dy = Math.abs(2 * y - 1);
  const halfW = Math.sqrt(Math.max(0, 1 - dy * dy)) * 0.45;
  const wobble = Math.sin(y * Math.PI * 2) * 0.02;
  organicRows.push({ y, left: 0.5 - halfW + wobble, right: 0.5 + halfW + wobble, width: 2 * halfW });
}
const organicRes = analyzeMangaBalloonGeometry({ bounds: { left: 0, right: 200, top: 0, bottom: 200, width: 200, height: 200, xMid: 100, yMid: 100 }, rows: organicRows });
assert.ok(Math.abs(organicRes.offsetX) < 0.03, `Organic balloon should be centered near 0, got ${organicRes.offsetX}`);
assert.ok(Math.abs(organicRes.offsetY) < 0.03, `Organic balloon should be centered near 0, got ${organicRes.offsetY}`);
console.log("✓ Case 5: Organic Hand-drawn Balloon passed");

// Case 5b: An intact balloon with a short speech tail. The tail must not be
// classified as a scene cut or force the ellipse fitter to invent a shift.
const tailRows = [];
for (let i = 0; i <= 20; i++) {
  const y = i / 20;
  const halfW = Math.sqrt(Math.max(0, 1 - Math.pow(2 * y - 1, 2))) * 0.42;
  let left = 0.5 - halfW;
  const right = 0.5 + halfW;
  if (i === 11) left = 0.02;
  tailRows.push({ y, left, right, width: right - left });
}
const tailRes = analyzeMangaBalloonGeometry({
  bounds: { left: 0, right: 240, top: 0, bottom: 240, width: 240, height: 240, xMid: 120, yMid: 120 },
  rows: tailRows,
});
assert.strictEqual(tailRes.isCut, false, "A short speech tail is not a scene cut");
assert.ok(Math.abs(tailRes.offsetX) < 0.03, `Speech-tail balloon must not tilt, got ${tailRes.offsetX}`);
assert.strictEqual(tailRes.offsetY, 0, "An intact balloon must use its geometric vertical center");
console.log("✓ Case 5b: Intact balloon with speech tail passed");

// Case 6: Rectangular / Square Narration Box
const rectRows = [];
for (let i = 0; i <= 20; i++) {
  rectRows.push({ y: i / 20, left: 0.0, right: 1.0, width: 1.0 });
}
const rectShape = { bounds: { left: 0, right: 200, top: 0, bottom: 400, width: 200, height: 400, xMid: 100, yMid: 200 }, rows: rectRows };
assert.ok(isRectangularShape(rectShape), "isRectangularShape should return true for box");
const rectRes = analyzeMangaBalloonGeometry(rectShape);
assert.strictEqual(rectRes.offsetX, 0, "Rectangular box must have offsetX = 0");
assert.strictEqual(rectRes.offsetY, 0, "Rectangular box must have offsetY = 0");
const rectRecon = reconstructPhantomBalloon(rectShape);
assert.strictEqual(rectRecon.offsetX, 0);
assert.strictEqual(rectRecon.offsetY, 0);
assert.strictEqual(rectRecon.isRectangular, true);
assert.strictEqual(rectRecon.hasCompletion, false);
console.log("✓ Case 6: Rectangular Narration Box passed");

// Case 7: malformed inverted path profile from a rectangular selection.
// Photoshop can occasionally return a self-intersecting path whose top and
// bottom spans are wide while the middle collapses. It must not become a cut.
const malformedRectRows = [
  { y: 0.00, left: 0.00, right: 0.99, width: 0.99 },
  { y: 0.0625, left: 0.02, right: 0.93, width: 0.91 },
  { y: 0.125, left: 0.05, right: 0.80, width: 0.75 },
  { y: 0.1875, left: 0.08, right: 0.68, width: 0.60 },
  { y: 0.25, left: 0.11, right: 0.56, width: 0.45 },
  { y: 0.3125, left: 0.14, right: 0.17, width: 0.03 },
  { y: 0.375, left: 0.17, right: 0.20, width: 0.03 },
  { y: 0.50, left: 0.23, right: 0.25, width: 0.02 },
  { y: 0.625, left: 0.17, right: 0.20, width: 0.03 },
  { y: 0.6875, left: 0.14, right: 0.17, width: 0.03 },
  { y: 0.75, left: 0.11, right: 0.56, width: 0.45 },
  { y: 0.8125, left: 0.08, right: 0.68, width: 0.60 },
  { y: 0.875, left: 0.05, right: 0.80, width: 0.75 },
  { y: 0.9375, left: 0.02, right: 0.93, width: 0.91 },
  { y: 1.00, left: 0.00, right: 0.99, width: 0.99 },
];
const malformedRect = {
  bounds: { left: 0, right: 160, top: 0, bottom: 263, width: 160, height: 263, xMid: 80, yMid: 131.5 },
  rows: malformedRectRows,
};
assert.ok(isRectangularShape(malformedRect), "Malformed rectangle profile must be neutralized");
const malformedRectRes = analyzeMangaBalloonGeometry(malformedRect);
assert.strictEqual(malformedRectRes.offsetX, 0, "Malformed rectangle must not receive horizontal cut offset");
assert.strictEqual(malformedRectRes.offsetY, 0, "Malformed rectangle must not receive vertical cut offset");
assert.strictEqual(malformedRectRes.isCut, false, "Malformed rectangle must not be treated as cut");
console.log("✓ Case 7: Malformed rectangular path profile passed");

// Case 8: Intact vertical manga balloon with a speech tail (diagnostics regression case)
// An intact speech balloon with speech tail must never trigger isCut, hasCompletion,
// or non-zero offsets.
const userReportedRows = [
  { y: 0.0000, left: 0.4478, right: 0.4495, width: 0.0017 },
  { y: 0.0625, left: 0.4498, right: 0.4535, width: 0.0037 },
  { y: 0.1250, left: 0.4538, right: 0.4575, width: 0.0037 },
  { y: 0.1875, left: 0.3798, right: 0.4577, width: 0.0779 },
  { y: 0.2500, left: 0.2286, right: 0.3709, width: 0.1424 },
  { y: 0.3125, left: 0.0000, right: 0.2197, width: 0.2210 },
  { y: 0.3750, left: 0.0000, right: 0.0684, width: 0.1111 },
  { y: 0.4375, left: 0.0000, right: 0.2009, width: 0.2429 },
  { y: 0.5000, left: 0.0000, right: 0.3750, width: 0.4043 },
  { y: 0.5625, left: 0.3853, right: 0.5368, width: 0.1515 },
  { y: 0.6250, left: 0.5391, right: 0.5771, width: 0.0380 },
  { y: 0.6875, left: 0.5795, right: 0.6175, width: 0.0380 },
  { y: 0.7500, left: 0.6198, right: 0.6578, width: 0.0380 },
  { y: 0.8125, left: 0.6602, right: 0.6982, width: 0.0380 },
  { y: 0.8750, left: 0.7005, right: 0.7385, width: 0.0380 },
  { y: 0.9375, left: 0.7409, right: 0.7599, width: 0.0190 },
  { y: 1.0000, left: 0.5000, right: 0.5000, width: 0.0000 },
];
const userReportedShape = {
  bounds: { left: 660, top: 46, right: 812, bottom: 255, width: 152, height: 209, xMid: 736, yMid: 150.5 },
  rows: userReportedRows,
};
const userReportedGeo = analyzeMangaBalloonGeometry(userReportedShape);
assert.strictEqual(userReportedGeo.isCut, false, "Speech tail must not trigger isCut");
assert.strictEqual(userReportedGeo.offsetX, 0, "Intact balloon with tail must have offsetX = 0");
assert.strictEqual(userReportedGeo.offsetY, 0, "Intact balloon with tail must have offsetY = 0");
const userReportedRecon = reconstructPhantomBalloon(userReportedShape);
assert.strictEqual(userReportedRecon.hasCompletion, false, "Intact balloon with tail must have hasCompletion = false");
assert.strictEqual(userReportedRecon.offsetX, 0, "Intact balloon with tail must have recon offsetX = 0");
assert.strictEqual(userReportedRecon.offsetY, 0, "Intact balloon with tail must have recon offsetY = 0");
console.log("✓ Case 8: User diagnostic speech tail balloon passed");

console.log("All manga balloon centering cases passed with 100% precision!");
