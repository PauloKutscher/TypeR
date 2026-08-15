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

console.log("All manga balloon centering cases passed with 100% precision!");
