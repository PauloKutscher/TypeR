const assert = require("assert");
const { loadAppModule } = require("./loadAppModule.js");

const {
  detectBimodalNeck,
  splitShapeProfile,
  reconstructPhantomBalloon,
} = loadAppModule("app_src/phantomEllipse.js");

const { getShapeProfileGeometry } = loadAppModule("app_src/textShapeR.js");

console.log("Running Double Balloon Centering Tests...\n");

// Helper to generate normalized scanline rows for synthetic double bubble
function generateDoubleBalloonShape(topCenterY, topRadiusX, topRadiusY, bottomCenterY, bottomRadiusX, bottomRadiusY, neckY, neckWidth, bounds) {
  const sampleCount = 21;
  const rows = [];
  for (let i = 0; i < sampleCount; i++) {
    const yRatio = i / (sampleCount - 1);
    const absY = bounds.top + bounds.height * yRatio;
    let w = 0;

    if (absY < neckY) {
      // Upper lobe
      const dy = absY - topCenterY;
      if (Math.abs(dy) <= topRadiusY) {
        const span = topRadiusX * Math.sqrt(Math.max(0, 1 - (dy * dy) / (topRadiusY * topRadiusY)));
        w = Math.max(w, span * 2);
      }
    } else {
      // Lower lobe
      const dy = absY - bottomCenterY;
      if (Math.abs(dy) <= bottomRadiusY) {
        const span = bottomRadiusX * Math.sqrt(Math.max(0, 1 - (dy * dy) / (bottomRadiusY * bottomRadiusY)));
        w = Math.max(w, span * 2);
      }
    }

    // Blend around neck
    const distToNeck = Math.abs(absY - neckY);
    if (distToNeck < 15) {
      const t = distToNeck / 15;
      w = neckWidth * (1 - t) + w * t;
    }

    const normW = Math.max(0, Math.min(1, w / bounds.width));
    const normLeft = Math.max(0, (1 - normW) / 2);
    const normRight = Math.min(1, normLeft + normW);

    rows.push({
      y: yRatio,
      left: normLeft,
      right: normRight,
      width: normRight - normLeft,
    });
  }

  return { bounds, rows };
}

// Case 1: Symmetric Vertical Figure-8 Double Balloon
{
  const bounds = { left: 0, top: 0, right: 120, bottom: 240, width: 120, height: 240, xMid: 60, yMid: 120 };
  const shape = generateDoubleBalloonShape(60, 50, 50, 180, 50, 50, 120, 30, bounds);

  const bimodal = detectBimodalNeck(shape.rows);
  assert.ok(bimodal && bimodal.isDouble, "Case 1: Must detect bimodal double balloon profile");
  assert.ok(bimodal.neckRatio <= 0.65, `Expected neckRatio <= 0.65, got ${bimodal.neckRatio}`);

  const split = splitShapeProfile(shape);
  assert.ok(split.isDouble, "Case 1: splitShapeProfile must return isDouble: true");
  assert.strictEqual(split.lobes.length, 2, "Case 1: must split into exactly 2 lobes");

  const lobeA = split.lobes[0];
  const lobeB = split.lobes[1];

  // Lobe A center should be near (60, 60)
  assert.ok(Math.abs(lobeA.centerX - 60) < 5, `Expected lobeA.centerX ~ 60, got ${lobeA.centerX}`);
  assert.ok(Math.abs(lobeA.centerY - 60) < 15, `Expected lobeA.centerY ~ 60, got ${lobeA.centerY}`);

  // Lobe B center should be near (60, 180)
  assert.ok(Math.abs(lobeB.centerX - 60) < 5, `Expected lobeB.centerX ~ 60, got ${lobeB.centerX}`);
  assert.ok(Math.abs(lobeB.centerY - 180) < 15, `Expected lobeB.centerY ~ 180, got ${lobeB.centerY}`);

  const geom = getShapeProfileGeometry(shape);
  assert.ok(geom.isDouble === true, "Case 1: getShapeProfileGeometry must report isDouble: true");
  assert.strictEqual(geom.lobes.length, 2, "Case 1: getShapeProfileGeometry must return 2 lobes");

  console.log("✓ Case 1: Symmetric Figure-8 Double Balloon passed");
}

// Case 2: Asymmetric Peanut Double Balloon (smaller top, larger bottom)
{
  const bounds = { left: 0, top: 0, right: 140, bottom: 260, width: 140, height: 260, xMid: 70, yMid: 130 };
  const shape = generateDoubleBalloonShape(55, 45, 45, 185, 65, 65, 110, 40, bounds);

  const split = splitShapeProfile(shape);
  assert.ok(split.isDouble, "Case 2: Must detect asymmetric peanut double balloon");
  assert.strictEqual(split.lobes.length, 2);

  const lobeA = split.lobes[0];
  const lobeB = split.lobes[1];

  assert.ok(lobeA.centerY < bounds.height * 0.45, `Expected lobeA in upper half, got ${lobeA.centerY}`);
  assert.ok(lobeB.centerY > bounds.height * 0.55, `Expected lobeB in lower half, got ${lobeB.centerY}`);

  console.log("✓ Case 2: Asymmetric Peanut Double Balloon passed");
}

// Case 3: Single Intact Round Balloon (False Positive Protection)
{
  const sampleCount = 21;
  const rows = [];
  for (let i = 0; i < sampleCount; i++) {
    const yRatio = i / (sampleCount - 1);
    const dy = (yRatio - 0.5) * 2;
    const w = Math.sqrt(Math.max(0, 1 - dy * dy));
    const left = (1 - w) / 2;
    const right = left + w;
    rows.push({ y: yRatio, left, right, width: w });
  }
  const shape = {
    bounds: { left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100, xMid: 50, yMid: 50 },
    rows,
  };

  const bimodal = detectBimodalNeck(shape.rows);
  assert.strictEqual(bimodal, null, "Case 3: Pure round balloon must NOT be classified as double");

  const split = splitShapeProfile(shape);
  assert.strictEqual(split.isDouble, false, "Case 3: splitShapeProfile must return isDouble: false");

  const geom = getShapeProfileGeometry(shape);
  assert.strictEqual(geom.isDouble, undefined, "Case 3: getShapeProfileGeometry must not set isDouble");

  console.log("✓ Case 3: Intact Round Balloon false positive protection passed");
}

// Case 4: Rectangular Narration Box (False Positive Protection)
{
  const sampleCount = 21;
  const rows = [];
  for (let i = 0; i < sampleCount; i++) {
    rows.push({ y: i / (sampleCount - 1), left: 0.02, right: 0.98, width: 0.96 });
  }
  const shape = {
    bounds: { left: 0, top: 0, right: 150, bottom: 200, width: 150, height: 200, xMid: 75, yMid: 100 },
    rows,
  };

  const split = splitShapeProfile(shape);
  assert.strictEqual(split.isDouble, false, "Case 4: Rectangular box must NOT be classified as double");

  console.log("✓ Case 4: Rectangular Box false positive protection passed");
}

// Case 5: High Neck Double Balloon (small top ~30%, large bottom ~70%)
{
  const bounds = { left: 0, top: 0, right: 120, bottom: 300, width: 120, height: 300, xMid: 60, yMid: 150 };
  const shape = generateDoubleBalloonShape(45, 40, 40, 200, 55, 80, 95, 30, bounds);

  const split = splitShapeProfile(shape);
  assert.ok(split.isDouble, "Case 5: Must detect high neck double balloon");
  assert.ok(split.neckY <= 0.45, `Expected neckY <= 0.45, got ${split.neckY}`);
  assert.strictEqual(split.lobes.length, 2);

  console.log("✓ Case 5: High Neck Double Balloon passed");
}

// Case 6: Low Neck Double Balloon (large top ~70%, small bottom ~30%)
{
  const bounds = { left: 0, top: 0, right: 120, bottom: 300, width: 120, height: 300, xMid: 60, yMid: 150 };
  const shape = generateDoubleBalloonShape(100, 55, 80, 255, 40, 40, 205, 30, bounds);

  const split = splitShapeProfile(shape);
  assert.ok(split.isDouble, "Case 6: Must detect low neck double balloon");
  assert.ok(split.neckY >= 0.55, `Expected neckY >= 0.55, got ${split.neckY}`);
  assert.strictEqual(split.lobes.length, 2);

  console.log("✓ Case 6: Low Neck Double Balloon passed");
}

// Case 7: Diagonal / Laterally Shifted Double Balloon
{
  const sampleCount = 21;
  const rows = [];
  for (let i = 0; i < sampleCount; i++) {
    const yRatio = i / (sampleCount - 1);
    if (yRatio < 0.48) {
      // Top lobe shifted left (left=0.05, right=0.65)
      const dy = (yRatio - 0.24) / 0.24;
      const w = 0.60 * Math.sqrt(Math.max(0, 1 - dy * dy));
      rows.push({ y: yRatio, left: 0.05, right: 0.05 + w, width: w });
    } else if (yRatio > 0.52) {
      // Bottom lobe shifted right (left=0.35, right=0.95)
      const dy = (yRatio - 0.76) / 0.24;
      const w = 0.60 * Math.sqrt(Math.max(0, 1 - dy * dy));
      rows.push({ y: yRatio, left: 0.95 - w, right: 0.95, width: w });
    } else {
      // Neck at 0.50
      rows.push({ y: yRatio, left: 0.35, right: 0.65, width: 0.30 });
    }
  }
  const shape = {
    bounds: { left: 0, top: 0, right: 200, bottom: 200, width: 200, height: 200, xMid: 100, yMid: 100 },
    rows,
  };

  const split = splitShapeProfile(shape);
  assert.ok(split.isDouble, "Case 7: Must detect diagonal double balloon");
  assert.ok(split.lobes[0].centerX < split.lobes[1].centerX, "Lobe A must be to the left of Lobe B");

  console.log("✓ Case 7: Diagonal / Laterally Shifted Double Balloon passed");
}

// Case 8: Malformed or Edge-Case Inputs (Safety)
{
  assert.strictEqual(detectBimodalNeck(null), null);
  assert.strictEqual(detectBimodalNeck([]), null);
  assert.strictEqual(detectBimodalNeck([{ y: 0.5, left: 0, right: 1 }]), null);
  assert.strictEqual(splitShapeProfile(null).isDouble, false);
  assert.strictEqual(splitShapeProfile({}).isDouble, false);
  assert.strictEqual(splitShapeProfile({ bounds: { width: 100, height: 100 }, rows: [] }).isDouble, false);

  console.log("✓ Case 8: Malformed and Edge-case input safety passed");
}

console.log("\nAll Double Balloon Centering tests passed successfully!");
