/*
 * Offline laboratory for Tasks 25-29. The solver receives only a traced contour
 * and the active text box; page names, layer indices and other text boxes are
 * used only after prediction, for scoring and holdout reporting.
 *
 * Usage: node scripts/lab/scorePartitions.js [none mid full overlap]
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { classify, topology, tolerance, CATEGORIES, TOPOLOGIES } = require("./caseClass");

const ROOT = path.resolve(__dirname, "..", "..");
const RUNS = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const RUN_NAMES = RUNS.length ? RUNS : ["110-none", "111-mid", "112-full", "113-overlap"];
const SCENARIOS = ["none", "mid", "full", "overlap"];
const SCALES = [48, 32, 24, 16, 12];
const GROUP_TOLERANCES = [4, 8, 12];
const CANDIDATE_LIMITS = [8, 12, 16];
const CHORD_LIMITS = [12, 18, 24];
const MIN_PIECE_SHARE = 0.15;
const MAX_CUTS = 3;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
}

function quantile(values, p) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}

function median(values) { return quantile(values, 0.5); }
function finite(value, fallback = 0) { return Number.isFinite(value) ? value : fallback; }
function clamp(value, low = 0, high = 1) { return Math.max(low, Math.min(high, value)); }
function round(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function fmt(value, digits = 1) { return Number.isFinite(value) ? value.toFixed(digits) : "-"; }
function centre(box) { return { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 }; }
function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function signedArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    twice += a[0] * b[1] - b[0] * a[1];
  }
  return twice / 2;
}

function polygonCentroid(points) {
  let twice = 0, sx = 0, sy = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    twice += cross;
    sx += (a[0] + b[0]) * cross;
    sy += (a[1] + b[1]) * cross;
  }
  return twice ? { x: sx / (3 * twice), y: sy / (3 * twice) } : null;
}

function pointInPolygon(point, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (((a[1] > point.y) !== (b[1] > point.y)) &&
        point.x < (b[0] - a[0]) * (point.y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function polygonBounds(points) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const p of points) {
    left = Math.min(left, p[0]); top = Math.min(top, p[1]);
    right = Math.max(right, p[0]); bottom = Math.max(bottom, p[1]);
  }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function perimeter(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return total;
}

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (sorted.length < 3) return sorted;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function concavity(points, divisor) {
  const n = points.length;
  const span = Math.max(2, Math.round(n / divisor));
  const turns = new Array(n);
  let total = 0;
  for (let i = 0; i < n; i++) {
    const a = points[(i - span + n + n) % n], b = points[i], c = points[(i + span) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    turns[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    total += turns[i];
  }
  const winding = total >= 0 ? 1 : -1;
  return { span, values: turns.map((value) => -winding * value) };
}

function circularDistance(a, b, n) {
  const d = Math.abs(a - b);
  return Math.min(d, n - d);
}

function extractCandidates(points, options = {}) {
  const scales = options.scales || SCALES;
  const tolerance = options.groupTolerance || 8;
  const peaks = [];
  for (const divisor of scales) {
    const result = concavity(points, divisor);
    const radius = Math.max(2, Math.round(result.span / 2));
    for (let i = 0; i < points.length; i++) {
      const depth = result.values[i];
      if (depth < 0.08) continue;
      let top = true;
      for (let k = -radius; k <= radius; k++) {
        if (result.values[(i + k + points.length * 2) % points.length] > depth) { top = false; break; }
      }
      if (top) peaks.push({ index: i, divisor, depth });
    }
  }

  const groups = [];
  for (const peak of peaks.sort((a, b) => b.depth - a.depth)) {
    let group = groups.find((item) => circularDistance(item.index, peak.index, points.length) <= tolerance);
    if (!group) {
      group = { index: peak.index, members: [] };
      groups.push(group);
    }
    const sameScale = group.members.findIndex((item) => item.divisor === peak.divisor);
    if (sameScale < 0) group.members.push(peak);
    else if (group.members[sameScale].depth < peak.depth) group.members[sameScale] = peak;
    const deepest = group.members.reduce((a, b) => a.depth >= b.depth ? a : b);
    group.index = deepest.index;
  }

  return groups.map((group) => {
    const depth = Math.max(...group.members.map((item) => item.depth));
    const persistence = group.members.length / scales.length;
    const spread = Math.max(...group.members.map((item) => circularDistance(group.index, item.index, points.length)), 0);
    return {
      index: group.index,
      point: points[group.index],
      depth,
      depthNorm: clamp(depth / Math.PI),
      angle: depth,
      persistence,
      stability: 1 - clamp(spread / Math.max(1, tolerance)),
      position: group.index / points.length,
      scales: group.members.map((item) => item.divisor).sort((a, b) => b - a),
    };
  }).filter((candidate) => scales.length === 1 ? candidate.depth >= 0.6 : candidate.persistence >= 0.4 || candidate.depth >= 0.6)
    .sort((a, b) => (b.depthNorm + b.persistence + 0.25 * b.stability) - (a.depthNorm + a.persistence + 0.25 * a.stability));
}

function shapeMetrics(points) {
  const area = Math.abs(signedArea(points));
  const hullArea = Math.abs(signedArea(convexHull(points))) || area;
  const length = perimeter(points);
  const box = polygonBounds(points);
  const single = concavity(points, 24).values;
  const residual = single.reduce((sum, value) => sum + Math.max(0, value - 0.08), 0) / Math.max(1, single.length);
  return {
    area,
    solidity: area / Math.max(1, hullArea),
    compactness: 4 * Math.PI * area / Math.max(1, length * length),
    aspect: Math.min(box.width, box.height) / Math.max(1, Math.max(box.width, box.height)),
    residual,
  };
}

function closureFeature(points, a, b) {
  const n = points.length;
  const unitCross = (u, v) => Math.abs(u[0] * v[1] - u[1] * v[0]) /
    Math.max(1e-9, Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1]));
  const chord = [points[b][0] - points[a][0], points[b][1] - points[a][1]];
  const reverse = [-chord[0], -chord[1]];
  const turns = [
    unitCross([points[a][0] - points[(a - 1 + n) % n][0], points[a][1] - points[(a - 1 + n) % n][1]], chord),
    unitCross([points[(a + 1) % n][0] - points[a][0], points[(a + 1) % n][1] - points[a][1]], chord),
    unitCross([points[b][0] - points[(b - 1 + n) % n][0], points[b][1] - points[(b - 1 + n) % n][1]], reverse),
    unitCross([points[(b + 1) % n][0] - points[b][0], points[(b + 1) % n][1] - points[b][1]], reverse),
  ];
  return { score: turns.reduce((sum, value) => sum + value, 0) / turns.length, turns };
}

function chordInside(points, a, b) {
  for (let step = 1; step < 10; step++) {
    const t = step / 10;
    if (!pointInPolygon({
      x: points[a][0] * (1 - t) + points[b][0] * t,
      y: points[a][1] * (1 - t) + points[b][1] * t,
    }, points)) return false;
  }
  return true;
}

function buildDistanceGrid(points, size) {
  const box = polygonBounds(points);
  const padX = Math.max(1, box.width * 0.02), padY = Math.max(1, box.height * 0.02);
  const left = box.left - padX, top = box.top - padY;
  const width = box.width + 2 * padX, height = box.height + 2 * padY;
  const values = new Float32Array(size * size);
  const mask = new Uint8Array(size * size);
  values.fill(1e9);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const p = { x: left + (x + 0.5) * width / size, y: top + (y + 0.5) * height / size };
    if (pointInPolygon(p, points)) mask[y * size + x] = 1;
    else values[y * size + x] = 0;
  }
  const dirs1 = [[-1, 0, 1], [0, -1, 1], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2]];
  const dirs2 = [[1, 0, 1], [0, 1, 1], [1, 1, Math.SQRT2], [-1, 1, Math.SQRT2]];
  const pass = (ys, xs, dirs) => {
    for (const y of ys) for (const x of xs) {
      const index = y * size + x;
      if (!mask[index]) continue;
      for (const [dx, dy, cost] of dirs) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < size && ny < size) values[index] = Math.min(values[index], values[ny * size + nx] + cost);
      }
    }
  };
  pass([...Array(size).keys()], [...Array(size).keys()], dirs1);
  pass([...Array(size).keys()].reverse(), [...Array(size).keys()].reverse(), dirs2);
  const scale = (width / size + height / size) / 2;
  const maxima = [];
  for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
    const value = values[y * size + x];
    if (!mask[y * size + x] || value <= 1) continue;
    let local = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (values[(y + dy) * size + x + dx] > value) local = false;
    }
    if (local) maxima.push({ x: left + (x + 0.5) * width / size, y: top + (y + 0.5) * height / size, radius: value * scale });
  }
  maxima.sort((a, b) => b.radius - a.radius);
  function sample(point) {
    const x = Math.max(0, Math.min(size - 1, Math.floor((point.x - left) * size / width)));
    const y = Math.max(0, Math.min(size - 1, Math.floor((point.y - top) * size / height)));
    return values[y * size + x] * scale;
  }
  return { maxima: maxima.slice(0, 48), sample };
}

function dtFeature(grid, from, to, chordLength) {
  if (!grid) return { score: 0, opposite: 0, neck: 0, ridge: 0 };
  const side = (point) => (point.x - from.x) * (to.y - from.y) - (point.y - from.y) * (to.x - from.x);
  let positive = 0, negative = 0;
  for (const peak of grid.maxima) {
    if (side(peak) >= 0) positive = Math.max(positive, peak.radius);
    else negative = Math.max(negative, peak.radius);
  }
  const small = Math.min(positive, negative), large = Math.max(positive, negative);
  let profile = 0;
  for (let i = 1; i < 10; i++) profile += grid.sample({ x: from.x + (to.x - from.x) * i / 10, y: from.y + (to.y - from.y) * i / 10 });
  profile /= 9;
  const opposite = small > 0 && small / Math.max(1, large) >= 0.25 ? 1 : 0;
  const neck = chordLength / Math.max(1, 2 * small);
  const ridge = profile / Math.max(1, small);
  return { opposite, neck, ridge, score: opposite * (0.6 * (1 - clamp(neck / 1.5)) + 0.4 * (1 - clamp(ridge))) };
}

function nearestAgreement(candidate, other, scale) {
  if (!other.length) return 0.5;
  let best = Infinity;
  for (const item of other) best = Math.min(best, Math.hypot(candidate.point[0] - item.point[0], candidate.point[1] - item.point[1]));
  return 1 - clamp(best / Math.max(1, scale * 0.08));
}

function makeChords(points, candidates, otherCandidates, grid) {
  const n = points.length;
  const base = shapeMetrics(points);
  const scale = Math.sqrt(base.area);
  const chords = [];
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i].index, b = candidates[j].index;
    let gap = Math.abs(a - b); if (gap > n / 2) gap = n - gap;
    if (gap < n * 0.15 || !chordInside(points, a, b)) continue;
    const length = Math.hypot(points[a][0] - points[b][0], points[a][1] - points[b][1]);
    const closure = closureFeature(points, a, b);
    const agreement = (nearestAgreement(candidates[i], otherCandidates, scale) + nearestAgreement(candidates[j], otherCandidates, scale)) / 2;
    const dt = dtFeature(grid, { x: points[a][0], y: points[a][1] }, { x: points[b][0], y: points[b][1] }, length);
    chords.push({
      id: `${Math.min(a, b)}-${Math.max(a, b)}`,
      a: Math.min(a, b), b: Math.max(a, b),
      length: length / Math.max(1, scale),
      endpoint: (candidates[i].depthNorm + candidates[j].depthNorm) / 2,
      persistence: (candidates[i].persistence + candidates[j].persistence) / 2,
      stability: (candidates[i].stability + candidates[j].stability) / 2,
      closure: closure.score,
      turns: closure.turns,
      agreement,
      dt,
    });
  }
  return chords;
}

function orientation(a, b, c) { return Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])); }
function chordsCross(points, a, b) {
  if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) return false;
  const p1 = points[a.a], p2 = points[a.b], q1 = points[b.a], q2 = points[b.b];
  return orientation(p1, p2, q1) !== orientation(p1, p2, q2) && orientation(q1, q2, p1) !== orientation(q1, q2, p2);
}

function splitIndices(count, chords) {
  let pieces = [[...Array(count).keys()]];
  for (const chord of chords) {
    const at = pieces.findIndex((piece) => piece.includes(chord.a) && piece.includes(chord.b));
    if (at < 0) return null;
    const piece = pieces[at];
    let a = piece.indexOf(chord.a), b = piece.indexOf(chord.b);
    if (a > b) [a, b] = [b, a];
    const first = piece.slice(a, b + 1);
    const second = piece.slice(b).concat(piece.slice(0, a + 1));
    if (first.length < 3 || second.length < 3) return null;
    pieces.splice(at, 1, first, second);
  }
  return pieces;
}

function sourceContours(c) {
  const geometry = c.plugin.geometry;
  if (!geometry) return [];
  const map = new Map();
  for (const outline of geometry.outlines || []) {
    if (outline.contour && outline.contour.length >= 12) map.set(outline.source, {
      name: outline.source,
      points: outline.contour,
      centroid: outline.centroid,
    });
  }
  if (geometry.partition && geometry.partition.contour && geometry.partition.contour.length >= 12) {
    const old = map.get(geometry.source) || {};
    map.set(geometry.source, { name: geometry.source, points: geometry.partition.contour, centroid: old.centroid });
  }
  for (const source of map.values()) if (!source.centroid) source.centroid = polygonCentroid(source.points);
  return [...map.values()];
}

function activeBox(c) {
  const original = c.groundTruth.metric || c.groundTruth.ink;
  const scatter = c.plugin.scatter || {};
  const dx = finite(scatter.dx), dy = finite(scatter.dy);
  return {
    left: original.left + dx, right: original.right + dx,
    top: original.top + dy, bottom: original.bottom + dy,
    width: original.width, height: original.height,
  };
}

const prepareCache = new Map();
const geometryCache = new Map();

function prepareSource(c, source, config) {
  const key = [c._id, source.name, config.multi ? "multi" : "single", config.groupTolerance, config.candidateLimit, config.dtGrid || 0].join("|");
  if (prepareCache.has(key)) return prepareCache.get(key);
  const candidates = extractCandidates(source.points, {
    scales: config.multi ? SCALES : [24],
    groupTolerance: config.groupTolerance,
  }).slice(0, config.candidateLimit);
  const others = sourceContours(c).filter((item) => item.name !== source.name)
    .flatMap((item) => extractCandidates(item.points, { scales: config.multi ? SCALES : [24], groupTolerance: config.groupTolerance }));
  const grid = config.dtGrid ? buildDistanceGrid(source.points, config.dtGrid) : null;
  const prepared = { candidates, chords: makeChords(source.points, candidates, others, grid), base: shapeMetrics(source.points) };
  prepareCache.set(key, prepared);
  return prepared;
}

function chordRank(chord, config) {
  return 0.45 * chord.endpoint + 0.35 * chord.persistence + 0.1 * chord.stability - 0.08 * chord.length +
    (config.closure ? 0.12 * chord.closure : 0) +
    (config.dirty ? 0.06 * (chord.agreement - 0.5) : 0) +
    (config.dtGrid ? 0.1 * chord.dt.score : 0);
}

function cutGeometry(c, source, chords, prepared) {
  const signature = chords.map((chord) => chord.id).sort().join("+");
  const key = `${c._id}|${source.name}|${signature}`;
  if (geometryCache.has(key)) return geometryCache.get(key);
  const indices = splitIndices(source.points.length, chords);
  if (!indices || indices.length !== chords.length + 1) return null;
  const pieces = indices.map((piece) => ({ indices: piece, points: piece.map((index) => source.points[index]) }));
  const totalArea = prepared.base.area;
  for (const piece of pieces) {
    piece.metrics = shapeMetrics(piece.points);
    piece.centroid = polygonCentroid(piece.points);
    if (!piece.centroid || !pointInPolygon(piece.centroid, piece.points) || piece.metrics.area / totalArea < MIN_PIECE_SHARE) return null;
  }
  const average = (key) => pieces.reduce((sum, piece) => sum + piece.metrics[key], 0) / pieces.length;
  const features = {
    gainSolidity: average("solidity") - prepared.base.solidity,
    gainCompactness: average("compactness") - prepared.base.compactness,
    gainAspect: average("aspect") - prepared.base.aspect,
    gainResidual: prepared.base.residual - average("residual"),
  };
  const result = { signature, pieces, features };
  geometryCache.set(key, result);
  return result;
}

function averageChord(chords, key, nested) {
  if (!chords.length) return 0;
  return chords.reduce((sum, chord) => sum + (nested ? chord[key][nested] : chord[key]), 0) / chords.length;
}

function scoreSet(geometry, chords, config) {
  const f = geometry.features;
  const features = {
    ...f,
    endpoint: averageChord(chords, "endpoint"),
    persistence: averageChord(chords, "persistence"),
    stability: averageChord(chords, "stability"),
    closure: averageChord(chords, "closure"),
    dirtyAgreement: averageChord(chords, "agreement"),
    dt: averageChord(chords, "dt", "score"),
    length: chords.reduce((sum, chord) => sum + chord.length, 0),
    cuts: chords.length,
  };
  const score = 1.4 * f.gainSolidity + 0.8 * f.gainCompactness + 0.3 * f.gainAspect + 0.7 * f.gainResidual +
    0.08 * features.endpoint + 0.06 * features.persistence + 0.03 * features.stability -
    0.05 * features.length - 0.045 * chords.length +
    (config.closure ? 0.12 * features.closure : 0) +
    (config.dirty ? 0.06 * (features.dirtyAgreement - 0.5) : 0) +
    (config.dtGrid ? 0.1 * features.dt : 0);
  return { score, features };
}

function choosePiece(geometry, box) {
  const point = centre(box);
  const matches = geometry.pieces.filter((piece) => pointInPolygon(point, piece.points));
  if (matches.length !== 1) return null;
  return matches[0];
}

function zeroSolution(c, source, preferred) {
  const actual = c.plugin.geometry && c.plugin.geometry.final;
  let target = source.centroid || polygonCentroid(source.points) || (actual && actual.target);
  if (!target) target = centre(activeBox(c));
  if (source.name === preferred && actual && !actual.partition.used && actual.target) target = actual.target;
  return { source: source.name, target, cuts: 0, score: 0, signature: "", piece: "whole", features: null, evaluated: 0 };
}

function solveRaw(c, config, box) {
  const sources = sourceContours(c);
  if (!sources.length) return null;
  const preferred = c.plugin.geometry.source;
  let best = null;
  for (const source of sources) {
    const zero = zeroSolution(c, source, preferred);
    let sourceBest = zero;
    const prepared = prepareSource(c, source, config);
    const chords = prepared.chords.slice().sort((a, b) => chordRank(b, config) - chordRank(a, config)).slice(0, config.chordLimit);
    let evaluated = 0;
    const consider = (set) => {
      if (!set.length) return;
      for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) {
        if (chordsCross(source.points, set[i], set[j])) return;
      }
      const geometry = cutGeometry(c, source, set, prepared);
      if (!geometry) return;
      const piece = choosePiece(geometry, box);
      if (!piece) return;
      evaluated++;
      const scored = scoreSet(geometry, set, config);
      if (scored.score > sourceBest.score) sourceBest = {
        source: source.name,
        target: piece.centroid,
        cuts: set.length,
        score: scored.score,
        signature: geometry.signature,
        piece: piece.indices.join(","),
        features: scored.features,
        evaluated,
      };
    };
    for (let i = 0; i < chords.length; i++) consider([chords[i]]);
    if (config.maxCuts > 1) for (let i = 0; i < chords.length; i++) for (let j = i + 1; j < chords.length; j++) consider([chords[i], chords[j]]);
    if (config.maxCuts > 2) for (let i = 0; i < chords.length; i++) for (let j = i + 1; j < chords.length; j++) for (let k = j + 1; k < chords.length; k++) consider([chords[i], chords[j], chords[k]]);
    sourceBest.evaluated = Math.max(sourceBest.evaluated, evaluated);
    if (sourceBest.score < config.margin) sourceBest = { ...zero, evaluated };
    if (!best || sourceBest.score > best.score + 1e-9 || (Math.abs(sourceBest.score - best.score) <= 1e-9 && source.name === preferred)) best = sourceBest;
  }
  return best;
}

function solve(c, config) {
  const box = activeBox(c);
  const first = solveRaw(c, config, box);
  if (!first) return {
    source: c.plugin.geometry ? c.plugin.geometry.source : "none",
    target: c.plugin.geometry && c.plugin.geometry.final.target ? c.plugin.geometry.final.target : centre(box),
    cuts: 0, score: 0, signature: "", piece: "whole", features: null,
    evaluated: 0, fixedPoint: true, fixedRejected: false, fallback: "noContour",
  };
  if (!first || !first.cuts) return { ...first, fixedPoint: true, fixedRejected: false };
  const at = centre(box);
  const dx = first.target.x - at.x, dy = first.target.y - at.y;
  const moved = { ...box, left: box.left + dx, right: box.right + dx, top: box.top + dy, bottom: box.bottom + dy };
  const second = solveRaw(c, config, moved);
  const fixed = !!second && first.source === second.source && first.signature === second.signature && first.piece === second.piece && distance(first.target, second.target) <= 0.5;
  if (fixed) return { ...first, fixedPoint: true, fixedRejected: false };
  const preferred = c.plugin.geometry.source;
  const source = sourceContours(c).find((item) => item.name === preferred) || sourceContours(c)[0];
  return { ...zeroSolution(c, source, preferred), fixedPoint: false, fixedRejected: true, fallback: "fixedPoint" };
}

function baselineRow(c) {
  const g = c.plugin.geometry;
  const after = c.plugin.after;
  return {
    case: c, scenario: c.scenario, category: c.category, topology: c.topology,
    dx: c.plugin.deltaX, dy: c.plugin.deltaY,
    target: c.plugin.alignResult && after ? { x: after.xMid, y: after.yMid } : g && g.final.target,
    cuts: c.plugin.partition ? c.plugin.partition.cuts : 0,
    used: c.plugin.partition ? c.plugin.partition.used : false,
    source: g ? g.source : "",
    repeat: Math.max(Math.abs(finite(c.plugin.repeatX)), Math.abs(finite(c.plugin.repeatY))),
  };
}

function predict(c, config) {
  if (c.plugin.alignResult && c.plugin.after) return {
    ...baselineRow(c),
    target: { x: c.plugin.after.xMid, y: c.plugin.after.yMid },
    fixedPoint: true, fixedRejected: false, evaluated: 0,
  };
  const solution = solve(c, config);
  const gt = c.groundTruth.ink;
  const actualTarget = c.plugin.geometry && c.plugin.geometry.final.target;
  const offsetX = actualTarget ? c.plugin.deltaX - (actualTarget.x - gt.xMid) : 0;
  const offsetY = actualTarget ? c.plugin.deltaY - (actualTarget.y - gt.yMid) : 0;
  return {
    case: c, scenario: c.scenario, category: c.category, topology: c.topology,
    dx: solution.target.x - gt.xMid + offsetX,
    dy: solution.target.y - gt.yMid + offsetY,
    target: solution.target,
    cuts: solution.cuts,
    source: solution.source,
    signature: solution.signature,
    piece: solution.piece,
    score: solution.score,
    features: solution.features,
    fixedPoint: solution.fixedPoint,
    fixedRejected: solution.fixedRejected,
    evaluated: solution.evaluated,
  };
}

function metrics(rows) {
  const absX = rows.map((row) => Math.abs(row.dx)), absY = rows.map((row) => Math.abs(row.dy));
  return {
    n: rows.length,
    medX: median(absX), p95X: quantile(absX, 0.95), maxX: absX.length ? Math.max(...absX) : NaN,
    medY: median(absY), p95Y: quantile(absY, 0.95), maxY: absY.length ? Math.max(...absY) : NaN,
    pass: rows.filter((row) => Math.abs(row.dx) <= tolerance(row.case) && Math.abs(row.dy) <= tolerance(row.case)).length,
    cuts: rows.reduce((sum, row) => sum + row.cuts, 0),
    falseCuts: rows.filter((row) => row.topology === "texts:1" && row.cuts).length,
    repeat: rows.filter((row) => row.repeat >= 1).length,
  };
}

function metricWorse(candidate, base, ceiling = 1) {
  return ["medX", "p95X", "medY", "p95Y"].some((key) => candidate[key] > base[key] + ceiling);
}

function runGate(candidate, baseline, pages, final, task24Keys) {
  const allowed = (row) => pages.has(row.case.page);
  const failures = [];
  let tailGain = 0;
  for (const scenario of SCENARIOS) {
    const cand = candidate.filter((row) => row.scenario === scenario && allowed(row));
    const base = baseline.filter((row) => row.scenario === scenario && allowed(row));
    const singles = cand.filter((row) => row.topology === "texts:1");
    for (const row of singles) {
      const old = base.find((item) => item.case._key === row.case._key);
      if (row.cuts || !old || distance(row.target, old.target) > 0.5) { failures.push(`${scenario}:texts:1`); break; }
    }
    for (const category of ["normal", "cut", "scream"]) {
      const a = metrics(cand.filter((row) => row.category === category));
      const b = metrics(base.filter((row) => row.category === category));
      if (a.n && metricWorse(a, b)) failures.push(`${scenario}:${category}`);
    }
    for (const group of ["texts:2", "texts:3+"]) {
      const a = metrics(cand.filter((row) => row.topology === group));
      const b = metrics(base.filter((row) => row.topology === group));
      if (a.n && metricWorse(a, b)) failures.push(`${scenario}:${group}`);
      if (group === "texts:3+" && a.n) tailGain += (b.p95X + b.p95Y) - (a.p95X + a.p95Y);
    }
    const catastrophic = cand.some((row) => {
      const old = base.find((item) => item.case._key === row.case._key);
      const now = Math.hypot(row.dx, row.dy), before = Math.hypot(old.dx, old.dy);
      return now > before + 100 && now > before * 2 + 20;
    });
    if (catastrophic) failures.push(`${scenario}:catastrophic`);
  }
  if (!(tailGain > 1)) failures.push("texts:3+:noTailGain");
  if (final) {
    const improve = (keys) => {
      const a = candidate.filter((row) => keys.has(row.case._key));
      const b = baseline.filter((row) => keys.has(row.case._key));
      return a.reduce((sum, row) => sum + Math.hypot(row.dx, row.dy), 0) < b.reduce((sum, row) => sum + Math.hypot(row.dx, row.dy), 0);
    };
    const page11 = new Set(candidate.filter((row) => row.case.page === "11" && row.topology === "texts:3+").map((row) => row.case._key));
    if (!improve(page11)) failures.push("11:aggregate");
    if (!improve(task24Keys)) failures.push("task24:aggregate");
  }
  return { pass: failures.length === 0, failures: [...new Set(failures)], tailGain };
}

function rankConfig(predictions) {
  const relevant = predictions.filter((row) => row.topology === "texts:3+");
  const byPage = new Map();
  for (const row of relevant) {
    const key = `${row.scenario}|${row.case.page}`;
    if (!byPage.has(key)) byPage.set(key, []);
    byPage.get(key).push(row);
  }
  const worst = Math.max(...[...byPage.values()].map((rows) => Math.max(metrics(rows).p95X, metrics(rows).p95Y)), Infinity);
  const all = metrics(relevant);
  const cuts = predictions.reduce((sum, row) => sum + row.cuts, 0);
  const cost = predictions.reduce((sum, row) => sum + row.evaluated, 0) / Math.max(1, predictions.length);
  return [worst, all.medX + all.medY, cuts, cost];
}

function compareTuple(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function extractionProfile(cases) {
  const rows = [];
  for (const toleranceValue of GROUP_TOLERANCES) {
    const counts = [];
    for (const c of cases) {
      const preferred = sourceContours(c).find((source) => source.name === c.plugin.geometry.source);
      if (preferred) counts.push(extractCandidates(preferred.points, { scales: SCALES, groupTolerance: toleranceValue }).length);
    }
    rows.push({ tolerance: toleranceValue, mean: counts.reduce((a, b) => a + b, 0) / counts.length, p95: quantile(counts, 0.95), max: Math.max(...counts) });
  }
  let groupTolerance = 8;
  for (let i = 0; i < rows.length - 1; i++) if (Math.abs(rows[i].mean - rows[i + 1].mean) <= 0.5) { groupTolerance = rows[i].tolerance; break; }
  const chosen = rows.find((row) => row.tolerance === groupTolerance);
  const candidateLimit = CANDIDATE_LIMITS.find((limit) => chosen.p95 <= limit) || 16;
  return { rows, groupTolerance, candidateLimit };
}

function predictionAgreement(a, b) {
  let same = 0;
  for (const row of a) {
    const other = b.find((item) => item.case._id === row.case._id);
    if (other && row.source === other.source && row.signature === other.signature && distance(row.target, other.target) <= 0.5) same++;
  }
  return same / Math.max(1, a.length);
}

function auc(values) {
  const positive = values.filter((item) => item.label), negative = values.filter((item) => !item.label);
  if (!positive.length || !negative.length) return NaN;
  let wins = 0;
  for (const a of positive) for (const b of negative) wins += a.value > b.value ? 1 : a.value === b.value ? 0.5 : 0;
  return wins / (positive.length * negative.length);
}

function selfTest() {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.strictEqual(Math.abs(signedArea(square)), 100);
  assert.deepStrictEqual(polygonCentroid(square), { x: 5, y: 5 });
  assert.ok(pointInPolygon({ x: 5, y: 5 }, square));
  assert.deepStrictEqual(splitIndices(8, [{ a: 0, b: 4 }]).map((piece) => piece.length), [5, 5]);
  assert.ok(chordsCross(square, { a: 0, b: 2 }, { a: 1, b: 3 }), "crossing chords must be rejected");
}

function tableLine(label, rows) {
  const value = metrics(rows);
  return `| ${label} | ${value.n} | ${fmt(value.medX)}/${fmt(value.p95X)}/${fmt(value.maxX, 0)} | ${fmt(value.medY)}/${fmt(value.p95Y)}/${fmt(value.maxY, 0)} | ${value.pass}/${value.n} | ${value.cuts} | ${value.falseCuts} | ${value.repeat} |`;
}

function main() {
  selfTest();
  const started = performance.now();
  const datasets = RUN_NAMES.map((run, index) => {
    const dir = path.join(ROOT, ".centering-lab", "runs", run);
    return { run, scenario: SCENARIOS[index] || run, data: readJson(path.join(dir, "cases.json")), info: readJson(path.join(dir, "run.json")) };
  });
  const cases = [];
  for (const dataset of datasets) for (const c of dataset.data.cases.filter((item) => !item.skipped)) {
    c.scenario = dataset.scenario;
    c.category = classify(c);
    c.topology = topology(c);
    c._key = `${dataset.scenario}|${c.page}|${c.index}`;
    c._id = c._key;
    cases.push(c);
  }
  const baseline = cases.map(baselineRow);
  const trainingCases = cases.filter((c) => c.page !== "11");
  const trainingPages = new Set(trainingCases.map((c) => c.page));
  const allPages = new Set(cases.map((c) => c.page));
  const profile = extractionProfile(trainingCases);

  const chordProbe = CHORD_LIMITS.map((chordLimit) => {
    const config = { name: `probe-${chordLimit}`, variant: "combined", multi: true, maxCuts: 3, groupTolerance: profile.groupTolerance, candidateLimit: profile.candidateLimit, chordLimit, margin: 0.08, closure: false, dirty: false, dtGrid: 0 };
    return { chordLimit, predictions: trainingCases.map((c) => predict(c, config)) };
  });
  let chordLimit = 18;
  const chordAgreement = [];
  for (let i = 0; i < chordProbe.length - 1; i++) {
    const agreement = predictionAgreement(chordProbe[i].predictions, chordProbe[i + 1].predictions);
    chordAgreement.push({ from: chordProbe[i].chordLimit, to: chordProbe[i + 1].chordLimit, agreement });
    if (agreement >= 0.95) { chordLimit = chordProbe[i].chordLimit; break; }
  }

  const featureSets = [
    { variant: "multi", multi: true, maxCuts: 1 },
    { variant: "global", multi: false, maxCuts: 3 },
    { variant: "combined", multi: true, maxCuts: 3 },
    { variant: "combined+closure", multi: true, maxCuts: 3, closure: true },
    { variant: "combined+dirty", multi: true, maxCuts: 3, dirty: true },
    { variant: "combined+dt128", multi: true, maxCuts: 3, dtGrid: 128 },
    { variant: "combined+dt256", multi: true, maxCuts: 3, dtGrid: 256 },
    { variant: "combined+all", multi: true, maxCuts: 3, closure: true, dirty: true, dtGrid: 128 },
  ];
  const configs = [];
  for (const features of featureSets) for (const margin of [0.04, 0.08, 0.12, 0.16]) configs.push({
    ...features,
    name: `${features.variant}@${margin}`,
    groupTolerance: profile.groupTolerance,
    candidateLimit: profile.candidateLimit,
    chordLimit,
    margin,
    closure: !!features.closure,
    dirty: !!features.dirty,
    dtGrid: features.dtGrid || 0,
  });

  const overlap = baseline.filter((row) => row.scenario === "overlap" && row.topology === "texts:3+" && row.source === "clean");
  const noneByLayer = new Map(baseline.filter((row) => row.scenario === "none").map((row) => [`${row.case.page}|${row.case.index}`, row]));
  const task24 = overlap.map((row) => {
    const old = noneByLayer.get(`${row.case.page}|${row.case.index}`);
    return { row, worsening: Math.hypot(row.dx, row.dy) - (old ? Math.hypot(old.dx, old.dy) : 0) };
  }).sort((a, b) => b.worsening - a.worsening).slice(0, 5);
  const task24Keys = new Set(task24.map((item) => item.row.case._key));

  const evaluated = [];
  for (const config of configs) {
    const before = performance.now();
    const predictions = cases.map((c) => predict(c, config));
    const training = predictions.filter((row) => row.case.page !== "11");
    const gate = runGate(training, baseline, trainingPages, false, task24Keys);
    evaluated.push({ config, predictions, training, gate, rank: rankConfig(training), ms: performance.now() - before });
  }
  const eligible = evaluated.filter((item) => item.gate.pass).sort((a, b) => compareTuple(a.rank, b.rank));
  const frozen = eligible[0] || null;
  const finalGate = frozen ? runGate(frozen.predictions, baseline, allPages, true, task24Keys) : { pass: false, failures: ["noTrainingWinner"] };
  const winner = frozen && finalGate.pass ? frozen : null;

  const variantBest = [];
  for (const variant of ["multi", "global", "combined", "combined+closure", "combined+dirty", "combined+dt128", "combined+dt256", "combined+all"]) {
    const rows = evaluated.filter((item) => item.config.variant === variant).sort((a, b) => compareTuple(a.rank, b.rank));
    if (rows[0]) variantBest.push(rows[0]);
  }

  const dt128 = evaluated.find((item) => item.config.variant === "combined+dt128" && item.config.margin === 0.08);
  const dt256 = evaluated.find((item) => item.config.variant === "combined+dt256" && item.config.margin === 0.08);
  const dtAgreement = dt128 && dt256 ? predictionAgreement(dt128.training, dt256.training) : NaN;

  const featureConfig = { ...configs.find((c) => c.variant === "combined+all"), margin: 0 };
  const featureRows = trainingCases.map((c) => predict(c, featureConfig)).filter((row) => row.features);
  const featureStats = {};
  for (const key of ["endpoint", "persistence", "closure", "dirtyAgreement", "dt"]) {
    const samples = featureRows.map((row) => {
      const source = sourceContours(row.case).find((item) => item.name === row.source);
      const zero = zeroSolution(row.case, source, row.case.plugin.geometry.source);
      const gt = row.case.groundTruth.ink;
      const zeroError = Math.hypot(zero.target.x - gt.xMid, zero.target.y - gt.yMid);
      return { value: row.features[key], label: Math.hypot(row.dx, row.dy) + 1 < zeroError };
    });
    featureStats[key] = {
      auc: auc(samples),
      positiveMedian: median(samples.filter((item) => item.label).map((item) => item.value)),
      negativeMedian: median(samples.filter((item) => !item.label).map((item) => item.value)),
      n: samples.length,
    };
  }

  let replayMax = 0, targetFidelity = 0, replayCount = 0;
  for (const c of cases) {
    const g = c.plugin.geometry;
    if (g && g.partition && g.partition.engineCentroid && g.partition.centroid) {
      replayMax = Math.max(replayMax, distance(g.partition.engineCentroid, g.partition.centroid));
      replayCount++;
    }
    if (g && g.final.target && !c.plugin.alignResult) {
      const gt = c.groundTruth.ink;
      targetFidelity = Math.max(targetFidelity, Math.abs(c.plugin.deltaX - (g.final.target.x - gt.xMid)), Math.abs(c.plugin.deltaY - (g.final.target.y - gt.yMid)));
    }
  }

  const lines = [];
  lines.push("# Tasks 25-29 — laboratório de partições globais", "");
  lines.push(`Runs: ${datasets.map((item) => `\`${item.run}\``).join(", ")} · ${cases.length / datasets.length} falas por cenário · bundle \`${datasets[0].info.hostSha1}\`.`);
  lines.push(`Reprodução offline: ${replayCount} cortes comparáveis, desvio máximo de peça/centroide ${fmt(replayMax, 3)} px; alvo real versus movimento ${fmt(targetFidelity, 3)} px.`);
  lines.push("");
  lines.push("## Task 25 — baseline exato", "");
  for (const dataset of datasets) {
    const rows = baseline.filter((row) => row.scenario === dataset.scenario);
    lines.push(`### ${dataset.scenario}`, "", `Tempo: ${dataset.info.seconds}s · SHA-1: \`${dataset.info.hostSha1}\``, "");
    lines.push("| categoria | n | X med/p95/max | Y med/p95/max | PASS | cortes | falsos cortes | 2ª passada ≥1 px |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const label of CATEGORIES) {
      const selected = rows.filter((row) => row.category === label);
      if (selected.length) lines.push(tableLine(label, selected));
    }
    lines.push(tableLine("TOTAL", rows), "");
    lines.push("| topologia | n | X med/p95/max | Y med/p95/max | PASS | cortes | falsos cortes | 2ª passada ≥1 px |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const label of TOPOLOGIES) lines.push(tableLine(label, rows.filter((row) => row.topology === label)));
    lines.push("");
  }
  lines.push("### As 12 falas das três regiões de quatro balões", "");
  lines.push("| caso | none | mid | full | overlap |", "| --- | --- | --- | --- | --- |");
  const fourKeys = [...new Set(cases.filter((c) => c.scenario === "full" && c.topology === "texts:3+").map((c) => `${c.page}|${c.index}`))];
  for (const key of fourKeys) {
    const cells = SCENARIOS.map((scenario) => {
      const row = baseline.find((item) => `${item.case.page}|${item.case.index}` === key && item.scenario === scenario);
      return row ? `${fmt(Math.abs(row.dx), 0)}/${fmt(Math.abs(row.dy), 0)} · c${row.cuts} · ${row.source}` : "-";
    });
    lines.push(`| ${key.replace("|", "#")} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push("## Task 26 — H25-A/F, concavidade multi-escala", "");
  lines.push("| agrupamento | candidatos méd/p95/max |", "| ---: | ---: |");
  for (const row of profile.rows) lines.push(`| ${row.tolerance} pontos | ${fmt(row.mean, 2)}/${row.p95}/${row.max} |`);
  lines.push("", `Faixa estável congelada sem usar \`11.psd\`: agrupamento ${profile.groupTolerance}, limite ${profile.candidateLimit}. Fechamento por tangentes permaneceu apenas como configuração separada.`, "");
  lines.push("## Task 27 — H25-B, busca global", "");
  lines.push("| limite de cordas | concordância com o próximo |", "| ---: | ---: |");
  for (const item of chordAgreement) lines.push(`| ${item.from} → ${item.to} | ${(100 * item.agreement).toFixed(1)}% |`);
  lines.push("", `Limite congelado: ${chordLimit}. Zero cortes conserva score 0; margens avaliadas: 0,04/0,08/0,12/0,16.`, "");
  lines.push("| variante | margem | texts:3+ X med/p95 | Y med/p95 | falsos cortes | fixed-point recusados | gate treino |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |");
  const currentTraining = baseline.filter((row) => row.case.page !== "11" && row.topology === "texts:3+");
  const currentM = metrics(currentTraining);
  lines.push(`| atual | - | ${fmt(currentM.medX)}/${fmt(currentM.p95X)} | ${fmt(currentM.medY)}/${fmt(currentM.p95Y)} | 0 | - | baseline |`);
  for (const item of variantBest) {
    const selected = item.training.filter((row) => row.topology === "texts:3+");
    const value = metrics(selected);
    lines.push(`| ${item.config.variant} | ${item.config.margin} | ${fmt(value.medX)}/${fmt(value.p95X)} | ${fmt(value.medY)}/${fmt(value.p95Y)} | ${item.training.filter((row) => row.topology === "texts:1" && row.cuts).length} | ${item.training.filter((row) => row.fixedRejected).length} | ${item.gate.pass ? "PASS" : item.gate.failures.slice(0, 3).join(", ")} |`);
  }
  lines.push("");
  lines.push("## Task 28 — H25-C/E, DT e clean/dirty", "");
  lines.push(`Ranking DT 128 versus 256: ${(100 * dtAgreement).toFixed(1)}% de soluções idênticas no treino.`, "");
  lines.push("| feature | AUC | mediana melhora | mediana não melhora | n |", "| --- | ---: | ---: | ---: | ---: |");
  for (const [name, value] of Object.entries(featureStats)) lines.push(`| ${name} | ${fmt(value.auc, 3)} | ${fmt(value.positiveMedian, 3)} | ${fmt(value.negativeMedian, 3)} | ${value.n} |`);
  lines.push("");
  lines.push("## Task 29 — fixed-point, LOPO e holdout", "");
  lines.push(`Configurações que passaram todos os gates nas 13 páginas de treino: ${eligible.length}/${evaluated.length}.`);
  if (frozen) lines.push(`Configuração congelada antes de revelar \`11.psd\`: \`${frozen.config.name}\` · rank ${frozen.rank.map((value) => fmt(value, 2)).join("/")}.`);
  lines.push(`Holdout/final: ${finalGate.pass ? "PASS" : "REJEITADO — " + finalGate.failures.join(", ")}.`);
  lines.push(`Casos da Task 24 usados no gate: ${[...task24Keys].join(", ") || "nenhum"}.`, "");
  lines.push(winner ? `**Vencedor:** \`${winner.config.name}\`.` : "**Resultado negativo:** nenhuma variante venceu de forma robusta; `app_src/host.js` permanece inalterado e não há estado/histerese novo.");
  lines.push("");

  const elapsed = performance.now() - started;
  const summary = {
    generated: new Date().toISOString(),
    runs: datasets.map((item) => ({ run: item.run, scenario: item.scenario, seconds: item.info.seconds, hostSha1: item.info.hostSha1 })),
    fidelity: { replayCount, replayMax, targetFidelity },
    chosen: { groupTolerance: profile.groupTolerance, candidateLimit: profile.candidateLimit, chordLimit },
    extraction: profile.rows,
    chordAgreement,
    dtAgreement,
    featureStats,
    configs: evaluated.map((item) => ({ name: item.config.name, gate: item.gate, rank: item.rank, ms: item.ms })),
    frozen: frozen && frozen.config,
    finalGate,
    winner: winner && winner.config,
    task24: [...task24Keys],
    elapsedMs: elapsed,
  };
  const reportFile = path.join(ROOT, ".centering-lab", "partition-report.md");
  const scoreFile = path.join(ROOT, ".centering-lab", "partition-scores.json");
  fs.writeFileSync(reportFile, lines.join("\n"));
  fs.writeFileSync(scoreFile, JSON.stringify(summary, null, 2));
  console.log(`report=${reportFile}`);
  console.log(`scores=${scoreFile}`);
  console.log(`winner=${winner ? winner.config.name : "none"} train=${eligible.length}/${evaluated.length} elapsed=${(elapsed / 1000).toFixed(1)}s`);
}

main();
