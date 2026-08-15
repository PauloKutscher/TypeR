/**
 * Direct & Robust Manga Balloon Geometry Reconstruction & Centering Engine
 *
 * Implements:
 * 1. Direct Least Squares Ellipse Fitting (Halir & Flusser / Fitzgibbon)
 * 2. Robust Visual Mass Centroid & Profile Symmetry Analysis (for flattened/achatados, squircles, and organic bubbles)
 * 3. Gutter / Scene Cut Detection & Reconstruction (Left, Right, Top, Bottom cuts)
 * 4. Safety tolerance clamping & visible boundary containment
 */

/**
 * Invert a 3x3 matrix in row-major order [0..8]
 */
export function invert3x3(m) {
  const a00 = m[0], a01 = m[1], a02 = m[2];
  const a10 = m[3], a11 = m[4], a12 = m[5];
  const a20 = m[6], a21 = m[7], a22 = m[8];

  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;

  const det = a00 * b01 + a01 * b11 + a02 * b21;
  if (Math.abs(det) < 1e-15) return null;

  const invDet = 1.0 / det;
  return [
    b01 * invDet,
    (-a22 * a01 + a02 * a21) * invDet,
    (a12 * a01 - a02 * a11) * invDet,
    b11 * invDet,
    (a22 * a00 - a02 * a20) * invDet,
    (-a12 * a00 + a02 * a10) * invDet,
    b21 * invDet,
    (-a21 * a00 + a01 * a20) * invDet,
    (a11 * a00 - a01 * a10) * invDet,
  ];
}

/**
 * Multiply two 3x3 matrices A * B in row-major order
 */
export function multiply3x3(A, B) {
  const out = new Float64Array(9);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      out[row * 3 + col] =
        A[row * 3 + 0] * B[0 * 3 + col] +
        A[row * 3 + 1] * B[1 * 3 + col] +
        A[row * 3 + 2] * B[2 * 3 + col];
    }
  }
  return out;
}

/**
 * Solve real roots of a cubic equation: a*x^3 + b*x^2 + c*x + d = 0
 */
export function solveCubicRoots(a, b, c, d) {
  if (Math.abs(a) < 1e-12) return [];
  const b_ = b / a;
  const c_ = c / a;
  const d_ = d / a;

  const p = (3 * c_ - b_ * b_) / 3;
  const q = (2 * b_ * b_ * b_ - 9 * b_ * c_ + 27 * d_) / 27;

  const disc = (q * q) / 4 + (p * p * p) / 27;
  const roots = [];

  if (disc > 1e-12) {
    const sqrtD = Math.sqrt(disc);
    const u = Math.cbrt(-q / 2 + sqrtD);
    const v = Math.cbrt(-q / 2 - sqrtD);
    roots.push(u + v - b_ / 3);
  } else if (Math.abs(disc) <= 1e-12) {
    const u = Math.cbrt(-q / 2);
    roots.push(2 * u - b_ / 3);
    roots.push(-u - b_ / 3);
  } else {
    const r = Math.sqrt(-(p * p * p) / 27);
    const phi = Math.acos(Math.max(-1, Math.min(1, -q / (2 * r))));
    const s = 2 * Math.sqrt(-p / 3);
    roots.push(s * Math.cos(phi / 3) - b_ / 3);
    roots.push(s * Math.cos((phi + 2 * Math.PI) / 3) - b_ / 3);
    roots.push(s * Math.cos((phi + 4 * Math.PI) / 3) - b_ / 3);
  }
  return roots;
}

/**
 * Eigenvalues and real eigenvectors of a 3x3 matrix
 */
export function eigen3x3(M) {
  const m00 = M[0], m01 = M[1], m02 = M[2];
  const m10 = M[3], m11 = M[4], m12 = M[5];
  const m20 = M[6], m21 = M[7], m22 = M[8];

  const c2 = -(m00 + m11 + m22);
  const c1 =
    m00 * m11 - m01 * m10 +
    m00 * m22 - m02 * m20 +
    m11 * m22 - m12 * m21;
  const c0 = -(
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20)
  );

  const roots = solveCubicRoots(1, c2, c1, c0);
  const eigens = [];

  for (let i = 0; i < roots.length; i++) {
    const lambda = roots[i];
    const B = [
      m00 - lambda, m01, m02,
      m10, m11 - lambda, m12,
      m20, m21, m22 - lambda,
    ];

    const cross01 = [
      B[1] * B[5] - B[2] * B[4],
      B[2] * B[3] - B[0] * B[5],
      B[0] * B[4] - B[1] * B[3],
    ];
    const cross02 = [
      B[1] * B[8] - B[2] * B[7],
      B[2] * B[6] - B[0] * B[8],
      B[0] * B[7] - B[1] * B[6],
    ];
    const cross12 = [
      B[4] * B[8] - B[5] * B[7],
      B[5] * B[6] - B[3] * B[8],
      B[3] * B[7] - B[4] * B[6],
    ];

    let v = cross01;
    let norm = Math.hypot(v[0], v[1], v[2]);
    const norm02 = Math.hypot(cross02[0], cross02[1], cross02[2]);
    const norm12 = Math.hypot(cross12[0], cross12[1], cross12[2]);

    if (norm02 > norm) { v = cross02; norm = norm02; }
    if (norm12 > norm) { v = cross12; norm = norm12; }

    if (norm > 1e-10) {
      eigens.push({
        value: lambda,
        vector: [v[0] / norm, v[1] / norm, v[2] / norm],
      });
    }
  }
  return eigens;
}

/**
 * Direct Least Squares Ellipse Fitting (Halir & Flusser / Fitzgibbon)
 */
export function fitEllipseDirect(points) {
  if (!points || points.length < 5) return null;

  let meanX = 0, meanY = 0;
  for (let i = 0; i < points.length; i++) {
    meanX += points[i][0];
    meanY += points[i][1];
  }
  meanX /= points.length;
  meanY /= points.length;

  let scale = 0;
  for (let i = 0; i < points.length; i++) {
    scale += Math.hypot(points[i][0] - meanX, points[i][1] - meanY);
  }
  scale = scale / points.length || 1;

  const S1 = new Float64Array(9);
  const S2 = new Float64Array(9);
  const S3 = new Float64Array(9);

  for (let i = 0; i < points.length; i++) {
    const x = (points[i][0] - meanX) / scale;
    const y = (points[i][1] - meanY) / scale;

    const x2 = x * x;
    const xy = x * y;
    const y2 = y * y;

    S1[0] += x2 * x2; S1[1] += x2 * xy; S1[2] += x2 * y2;
    S1[3] += xy * x2; S1[4] += xy * xy; S1[5] += xy * y2;
    S1[6] += y2 * x2; S1[7] += y2 * xy; S1[8] += y2 * y2;

    S2[0] += x2 * x;  S2[1] += x2 * y;  S2[2] += x2;
    S2[3] += xy * x;  S2[4] += xy * y;  S2[5] += xy;
    S2[6] += y2 * x;  S2[7] += y2 * y;  S2[8] += y2;

    S3[0] += x * x;   S3[1] += x * y;   S3[2] += x;
    S3[3] += y * x;   S3[4] += y * y;   S3[5] += y;
    S3[6] += 1 * x;   S3[7] += 1 * y;   S3[8] += 1;
  }

  const invS3 = invert3x3(S3);
  if (!invS3) return null;

  const S2T = [
    S2[0], S2[3], S2[6],
    S2[1], S2[4], S2[7],
    S2[2], S2[5], S2[8],
  ];
  const T = multiply3x3(invS3, S2T);
  for (let i = 0; i < 9; i++) T[i] = -T[i];

  const S2_T = multiply3x3(S2, T);
  const Q = new Float64Array(9);
  for (let i = 0; i < 9; i++) Q[i] = S1[i] + S2_T[i];

  const M = [
    0.5 * Q[6], 0.5 * Q[7], 0.5 * Q[8],
    -Q[3],     -Q[4],     -Q[5],
    0.5 * Q[0], 0.5 * Q[1], 0.5 * Q[2],
  ];

  const eigens = eigen3x3(M);
  if (!eigens.length) return null;

  let bestA1 = null;
  for (let i = 0; i < eigens.length; i++) {
    const [A, B, C] = eigens[i].vector;
    const cond = 4 * A * C - B * B;
    if (cond > 1e-12) {
      const scaleFactor = 1 / Math.sqrt(cond);
      bestA1 = [A * scaleFactor, B * scaleFactor, C * scaleFactor];
      break;
    }
  }

  if (!bestA1) {
    for (let i = 0; i < eigens.length; i++) {
      const [A, B, C] = eigens[i].vector;
      const cond = 4 * (-A) * (-C) - (-B) * (-B);
      if (cond > 1e-12) {
        const scaleFactor = 1 / Math.sqrt(cond);
        bestA1 = [-A * scaleFactor, -B * scaleFactor, -C * scaleFactor];
        break;
      }
    }
  }

  if (!bestA1) return null;

  const a2 = [
    T[0] * bestA1[0] + T[1] * bestA1[1] + T[2] * bestA1[2],
    T[3] * bestA1[0] + T[4] * bestA1[1] + T[5] * bestA1[2],
    T[6] * bestA1[0] + T[7] * bestA1[1] + T[8] * bestA1[2],
  ];

  const [A, B, C] = bestA1;
  const [D, E, F] = a2;

  const denom = 4 * A * C - B * B;
  if (denom <= 1e-12) return null;

  const cxScaled = (B * E - 2 * C * D) / denom;
  const cyScaled = (B * D - 2 * A * E) / denom;

  const centerX = cxScaled * scale + meanX;
  const centerY = cyScaled * scale + meanY;

  const K = (2 * (A * E * E + C * D * D - B * D * E - denom * F)) / denom;
  const term = Math.hypot(A - C, B);

  const denomA = A + C - term;
  const denomB = A + C + term;

  if (denomA <= 0 || denomB <= 0) return null;

  const semiMajorScaled = Math.sqrt(Math.abs(K / denomA));
  const semiMinorScaled = Math.sqrt(Math.abs(K / denomB));

  const a = semiMajorScaled * scale;
  const b = semiMinorScaled * scale;
  const angle = 0.5 * Math.atan2(B, A - C);

  return {
    centerX,
    centerY,
    a: Math.max(a, b),
    b: Math.min(a, b),
    angle,
    coeff: [A, B, C, D, E, F],
    scale,
    meanX,
    meanY,
  };
}

/**
 * Filter straight cut segments (gutters) and concave corners
 */
export function extractIntactArcPoints(points) {
  if (!points || points.length < 6) return points || [];
  const n = points.length;

  let shoelace = 0;
  for (let i = 0; i < n; i++) {
    const nextIdx = (i + 1) % n;
    shoelace += points[i][0] * points[nextIdx][1] - points[nextIdx][0] * points[i][1];
  }
  const winding = shoelace >= 0 ? 1 : -1;

  const inliers = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const v1x = curr[0] - prev[0];
    const v1y = curr[1] - prev[1];
    const v2x = next[0] - curr[0];
    const v2y = next[1] - curr[1];

    const len1 = Math.hypot(v1x, v1y) || 1e-6;
    const len2 = Math.hypot(v2x, v2y) || 1e-6;

    const cross = ((v1x * v2y - v1y * v2x) / (len1 * len2)) * winding;
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);

    const isStraight = Math.abs(cross) < 0.08 && dot > 0.96;
    const isConcave = cross < -0.05;

    if (!isStraight && !isConcave) {
      inliers.push(curr);
    }
  }

  return inliers.length >= 6 ? inliers : points;
}

/**
 * Robust Profile Centering & Cut Analysis
 * Accurately centers:
 * - Round / Elliptical bubbles
 * - Flattened / Achatados (squircles, super-ellipses, boxy ovals)
 * - Cut bubbles (scene gutters, action frames, diagonals, characters)
 * - Hand-drawn / organic asymmetrical bubbles
 */

/**
 * Detect rectangular or square narration/thought boxes
 */
export function isRectangularShape(shapeData) {
  if (!shapeData || !shapeData.bounds) return false;
  const bounds = shapeData.bounds;
  const rows = shapeData.rows;
  const polygons = shapeData.polygons;

  if (polygons && polygons.length > 0) {
    const poly = polygons[0];
    if (poly.length >= 4 && poly.length <= 8) {
      let nearEdgeCount = 0;
      for (let i = 0; i < poly.length; i++) {
        const x = poly[i][0];
        const y = poly[i][1];
        const nearLeft = Math.abs(x - bounds.left) < 6;
        const nearRight = Math.abs(x - bounds.right) < 6;
        const nearTop = Math.abs(y - bounds.top) < 6;
        const nearBottom = Math.abs(y - bounds.bottom) < 6;
        if (nearLeft || nearRight || nearTop || nearBottom) nearEdgeCount++;
      }
      if (nearEdgeCount >= poly.length - 1) return true;
    }
  }

  if (rows && rows.length >= 5) {
    let fullWidthRows = 0;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].left < 0.06 && rows[i].right > 0.94) {
        fullWidthRows++;
      }
    }
    if (fullWidthRows / rows.length >= 0.85) return true;
  }

  return false;
}

export function analyzeMangaBalloonGeometry(shapeData) {
  if (!shapeData || !shapeData.bounds) return null;
  if (isRectangularShape(shapeData)) {
    return {
      centerX: 0.5,
      centerY: 0.5,
      offsetX: 0,
      offsetY: 0,
      pixelOffsetX: 0,
      pixelOffsetY: 0,
      isCut: false,
      cutType: "none",
      isRectangular: true,
    };
  }
  const bounds = shapeData.bounds;
  const width = bounds.width;
  const height = bounds.height;
  if (width <= 0 || height <= 0) return null;

  let rows = shapeData.rows;
  const polygons = shapeData.polygons;

  if ((!rows || rows.length < 5) && polygons && polygons.length > 0) {
    rows = [];
    const poly = polygons[0];
    const sampleCount = 21;
    for (let r = 0; r < sampleCount; r++) {
      const yRatio = r / (sampleCount - 1);
      const y = bounds.top + height * yRatio;
      let minX = null, maxX = null;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
          if (minX === null || x < minX) minX = x;
          if (maxX === null || x > maxX) maxX = x;
        }
      }
      if (minX !== null && maxX > minX) {
        rows.push({
          y: yRatio,
          left: Math.max(0, Math.min(1, (minX - bounds.left) / width)),
          right: Math.max(0, Math.min(1, (maxX - bounds.left) / width)),
          width: Math.max(0, Math.min(1, (maxX - minX) / width)),
        });
      } else {
        rows.push({ y: yRatio, left: 0.5, right: 0.5, width: 0 });
      }
    }
  }

  if (!rows || rows.length < 5) return null;

  const n = rows.length;
  const midpoints = [];
  const widths = [];
  const lefts = [];
  const rights = [];
  let totalWeight = 0;
  let weightedYSum = 0;
  let weightedXSum = 0;

  let maxRowWidth = 0;

  for (let i = 0; i < n; i++) {
    const r = rows[i];
    const w = Math.max(0, r.right - r.left);
    const mid = (r.left + r.right) / 2;

    widths.push(w);
    lefts.push(r.left);
    rights.push(r.right);
    midpoints.push(mid);

    if (w > maxRowWidth) {
      maxRowWidth = w;
    }

    if (w > 0.05) {
      const weight = Math.pow(w, 1.5);
      totalWeight += weight;
      weightedYSum += r.y * weight;
      weightedXSum += mid * weight;
    }
  }

  if (totalWeight <= 0) return null;

  const visualCentroidX = weightedXSum / totalWeight;
  const visualCentroidY = weightedYSum / totalWeight;

  const validIndices = [];
  for (let i = 1; i < n - 1; i++) {
    if (widths[i] > 0.2) validIndices.push(i);
  }

  let leftFlatCount = 0;
  let rightFlatCount = 0;
  let minLeft = 1, maxRight = 0;

  for (let k = 0; k < validIndices.length; k++) {
    const idx = validIndices[k];
    if (lefts[idx] < minLeft) minLeft = lefts[idx];
    if (rights[idx] > maxRight) maxRight = rights[idx];
  }

  for (let k = 0; k < validIndices.length; k++) {
    const idx = validIndices[k];
    if (Math.abs(lefts[idx] - minLeft) < 0.035) leftFlatCount++;
    if (Math.abs(rights[idx] - maxRight) < 0.035) rightFlatCount++;
  }

  const leftCutRatio = validIndices.length ? leftFlatCount / validIndices.length : 0;
  const rightCutRatio = validIndices.length ? rightFlatCount / validIndices.length : 0;

  const isLeftCut = leftCutRatio >= 0.55 && rightCutRatio < 0.4;
  const isRightCut = rightCutRatio >= 0.55 && leftCutRatio < 0.4;

  const topWidth = widths[0] || 0;
  const bottomWidth = widths[n - 1] || 0;
  const isTopCut = topWidth > maxRowWidth * 0.65;
  const isBottomCut = bottomWidth > maxRowWidth * 0.65;

  let targetNormX = visualCentroidX;
  let targetNormY = visualCentroidY;

  if (isLeftCut && !isRightCut) {
    const estimatedHalfW = maxRight - minLeft;
    targetNormX = Math.max(0.15, maxRight - estimatedHalfW * 0.85);
  } else if (isRightCut && !isLeftCut) {
    const estimatedHalfW = maxRight - minLeft;
    targetNormX = Math.min(0.85, minLeft + estimatedHalfW * 0.85);
  } else {
    const sortedMids = [...midpoints].sort((a, b) => a - b);
    const medianMid = sortedMids[Math.floor(sortedMids.length / 2)];
    targetNormX = visualCentroidX * 0.6 + medianMid * 0.4;
  }

  if (isBottomCut && !isTopCut) {
    targetNormY = Math.min(0.7, visualCentroidY * 0.75 + 0.5 * 0.25 + 0.15);
  } else if (isTopCut && !isBottomCut) {
    targetNormY = Math.max(0.3, visualCentroidY * 0.75 + 0.5 * 0.25 - 0.15);
  } else {
    targetNormY = visualCentroidY;
  }

  const rawOffsetX = targetNormX - 0.5;
  const rawOffsetY = targetNormY - 0.5;

  const maxShiftX = 0.35;
  const maxShiftY = 0.35;
  const offsetX = Math.max(-maxShiftX, Math.min(maxShiftX, rawOffsetX));
  const offsetY = Math.max(-maxShiftY, Math.min(maxShiftY, rawOffsetY));

  return {
    centerX: 0.5 + offsetX,
    centerY: 0.5 + offsetY,
    offsetX,
    offsetY,
    pixelOffsetX: offsetX * width,
    pixelOffsetY: offsetY * height,
    isCut: isLeftCut || isRightCut || isTopCut || isBottomCut,
    cutType: isLeftCut ? "left" : isRightCut ? "right" : isTopCut ? "top" : isBottomCut ? "bottom" : "none",
  };
}

/**
 * Generate normalized phantom profile rows
 */
export function generateEllipseProfileRows(ellipse, bounds, visibleRows = null, sampleCount = 21) {
  if (!ellipse || !bounds || bounds.width <= 0 || bounds.height <= 0) return null;

  const rows = [];
  const { centerX, centerY, a, b, angle } = ellipse;
  const cosA = Math.cos(-(angle || 0));
  const sinA = Math.sin(-(angle || 0));

  for (let i = 0; i < sampleCount; i++) {
    const yRatio = sampleCount <= 1 ? 0.5 : i / (sampleCount - 1);
    const y = bounds.top + bounds.height * yRatio;

    const dy = y - centerY;
    const P = (cosA * cosA) / (a * a) + (sinA * sinA) / (b * b);
    const Q = dy * ((-sinA * cosA) / (a * a) + (sinA * cosA) / (b * b));
    const R = dy * dy * ((sinA * sinA) / (a * a) + (cosA * cosA) / (b * b)) - 1;

    const discr = Q * Q - P * R;
    if (discr >= 0 && P > 1e-12) {
      const sqrtD = Math.sqrt(discr);
      const dx1 = (-Q - sqrtD) / P;
      const dx2 = (-Q + sqrtD) / P;

      const xLeft = Math.min(centerX + dx1, centerX + dx2);
      const xRight = Math.max(centerX + dx1, centerX + dx2);

      let normLeft = Math.max(0, Math.min(1, (xLeft - bounds.left) / bounds.width));
      let normRight = Math.max(0, Math.min(1, (xRight - bounds.left) / bounds.width));

      if (visibleRows && visibleRows[i]) {
        const vis = visibleRows[i];
        normLeft = Math.max(vis.left, normLeft);
        normRight = Math.min(vis.right, normRight);
      }

      rows.push({
        y: yRatio,
        left: normLeft,
        right: normRight,
        width: Math.max(0, normRight - normLeft),
      });
    } else if (visibleRows && visibleRows[i]) {
      rows.push({ ...visibleRows[i] });
    } else {
      const normCenter = Math.max(0, Math.min(1, (centerX - bounds.left) / bounds.width));
      rows.push({
        y: yRatio,
        left: normCenter,
        right: normCenter,
        width: 0,
      });
    }
  }

  return rows;
}

/**
 * Main reconstruction function: Hybrid robust centering for manga balloons
 */
export function reconstructPhantomBalloon(shapeData) {
  if (!shapeData || !shapeData.bounds) return null;

  const bounds = shapeData.bounds;
  if (isRectangularShape(shapeData)) {
    return {
      ellipse: null,
      centerX: 0.5,
      centerY: 0.5,
      offsetX: 0,
      offsetY: 0,
      pixelOffsetX: 0,
      pixelOffsetY: 0,
      phantomWidth: bounds.width,
      phantomHeight: bounds.height,
      hasCompletion: false,
      phantomRows: shapeData.rows,
      isRectangular: true,
    };
  }

  const robustAnalysis = analyzeMangaBalloonGeometry(shapeData);
  if (!robustAnalysis) return null;
  const polygons = shapeData.polygons || [];
  let points = [];

  if (polygons.length > 0) {
    for (let p = 0; p < polygons.length; p++) {
      if (polygons[p].length >= points.length) {
        points = polygons[p];
      }
    }
  } else if (shapeData.rows && shapeData.rows.length >= 6) {
    const rows = shapeData.rows;
    for (let i = 0; i < rows.length; i++) {
      points.push([bounds.left + bounds.width * rows[i].left, bounds.top + bounds.height * rows[i].y]);
    }
    for (let i = rows.length - 1; i >= 0; i--) {
      points.push([bounds.left + bounds.width * rows[i].right, bounds.top + bounds.height * rows[i].y]);
    }
  }

  let ellipse = null;
  if (points.length >= 6) {
    const intact = extractIntactArcPoints(points);
    if (intact.length >= 5) {
      ellipse = fitEllipseDirect(intact);
    }
  }

  let finalOffsetX = robustAnalysis.offsetX;
  let finalOffsetY = robustAnalysis.offsetY;

  // If clean ellipse fit with matching aspect ratio is found, use it for curved and diagonal cuts
  if (ellipse) {
    const maxSpan = Math.max(bounds.width, bounds.height);
    const distFromCenter = Math.hypot(ellipse.centerX - bounds.xMid, ellipse.centerY - bounds.yMid);
    const aspectRatio = ellipse.a / (ellipse.b || 1);
    if (distFromCenter < maxSpan * 1.2 && aspectRatio <= 3.5 && aspectRatio >= 0.28) {
      const ellOffsetX = Math.max(-0.35, Math.min(0.35, (ellipse.centerX - bounds.xMid) / bounds.width));
      const ellOffsetY = Math.max(-0.35, Math.min(0.35, (ellipse.centerY - bounds.yMid) / bounds.height));
      finalOffsetX = ellOffsetX;
      finalOffsetY = ellOffsetY;
    }
  }

  const clampedCenterX = bounds.xMid + finalOffsetX * bounds.width;
  const clampedCenterY = bounds.yMid + finalOffsetY * bounds.height;
  const hasCompletion = Math.abs(finalOffsetX) > 0.015 || Math.abs(finalOffsetY) > 0.015;

  const phantomRows = ellipse
    ? generateEllipseProfileRows(
        { ...ellipse, centerX: clampedCenterX, centerY: clampedCenterY },
        bounds,
        shapeData.rows,
        (shapeData.rows && shapeData.rows.length) || 21
      )
    : shapeData.rows;

  return {
    ellipse: ellipse ? { ...ellipse, centerX: clampedCenterX, centerY: clampedCenterY } : null,
    centerX: 0.5 + finalOffsetX,
    centerY: 0.5 + finalOffsetY,
    offsetX: finalOffsetX,
    offsetY: finalOffsetY,
    pixelOffsetX: finalOffsetX * bounds.width,
    pixelOffsetY: finalOffsetY * bounds.height,
    phantomWidth: ellipse ? ellipse.a * 2 : bounds.width,
    phantomHeight: ellipse ? ellipse.b * 2 : bounds.height,
    hasCompletion,
    phantomRows: phantomRows || shapeData.rows,
  };
}
