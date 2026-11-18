import { box } from "./geometry";

// Where a text is centred in a bubble: the point Align and the smart paste put
// the centre of its ink box on. Chosen against where typesetters set their
// texts: 1,514 single bubbles and 842 chambers of typeset PSDs (two series of
// Amagami chapters), 931 single bubbles and 660 chambers of lettered pages.
//
// The body first: the outline opened (contracted, then grown back) by 14% of
// its short side, which cuts the tail off, as Align did with Photoshop's
// Contract and Expand.
// - A single bubble: the body's centroid, its centre of mass. The centre of
//   the body's box, which Align used, follows every bump of the outline and
//   the whole stub of a thick tail the opening could not cut; the centroid
//   weighs them by their area.
// - A chamber of a double or triple bubble: halfway between the body's
//   centroid and the centre of its box. The cut at the neck takes a chamber's
//   end away and pulls its centroid from the neck; typesetters set the text
//   nearer the neck, as if the lobe went on under the other one, and the box
//   of a lobe cut on a corner is still the lobe's.
// Null when nothing is left of the body.
const BODY_OPEN = 0.14;
const CHAMBER_BOX = 0.5;
const BODY_GRID = 160;

// Squared distance of every cell to the nearest cell that is 0 (Felzenszwalb)
const distanceMap = (mask, w, h) => {
  const INF = 1e12;
  const out = new Float64Array(w * h);
  const n = Math.max(w, h);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const pass = (length) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < length; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < length; q++) {
      while (z[k + 1] < q) k++;
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
  };
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = mask[y * w + x] ? INF : 0;
    pass(h);
    for (let y = 0; y < h; y++) out[y * w + x] = d[y];
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) f[x] = out[y * w + x];
    pass(w);
    for (let x = 0; x < w; x++) out[y * w + x] = d[x];
  }
  return out;
};

export const bodyCentre = (poly, chamber = false) => {
  if (!poly || poly.length < 3) return null;
  const b = box(poly);
  if (!(b.width > 0) || !(b.height > 0)) return null;
  // A grid of at most BODY_GRID cells a side, at least one empty cell around
  // the bubble, the bubble's box in its middle: a symmetric outline fills
  // symmetric cells. Cell x spans [originX + x * step, originX + (x + 1) * step]
  const step = Math.max(1, Math.max(b.width, b.height) / BODY_GRID);
  const w = Math.ceil(b.width / step) + 2;
  const h = Math.ceil(b.height / step) + 2;
  const originX = b.left - (w * step - b.width) / 2;
  const originY = b.top - (h * step - b.height) / 2;
  const inside = new Uint8Array(w * h);
  const crossings = [];
  for (let y = 0; y < h; y++) crossings.push([]);
  for (let j = 0; j < poly.length; j++) {
    const a = poly[j];
    const c = poly[(j + 1) % poly.length];
    if (a[1] === c[1]) continue;
    // One row of slack at each end: a scan line that passes right on a vertex
    // (pixel outlines have whole coordinates) is decided by the test below,
    // not by a rounding of its row number
    const from = Math.max(0, Math.ceil((Math.min(a[1], c[1]) - originY) / step - 0.5) - 1);
    const to = Math.min(h - 1, Math.floor((Math.max(a[1], c[1]) - originY) / step - 0.5) + 1);
    for (let y = from; y <= to; y++) {
      const scan = originY + (y + 0.5) * step;
      if ((a[1] <= scan && c[1] > scan) || (c[1] <= scan && a[1] > scan)) {
        crossings[y].push(a[0] + ((scan - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
      }
    }
  }
  for (let y = 0; y < h; y++) {
    const cross = crossings[y];
    cross.sort((p, q) => p - q);
    for (let j = 0; j + 1 < cross.length; j += 2) {
      // Cells whose centre lies between the two crossings
      const left = Math.max(0, Math.ceil((cross[j] - originX) / step - 0.5));
      const right = Math.min(w - 1, Math.floor((cross[j + 1] - originX) / step - 0.5));
      for (let x = left; x <= right; x++) inside[y * w + x] = 1;
    }
  }
  const depth = distanceMap(inside, w, h);
  const short = Math.min(b.width, b.height) / step;
  let radius = Math.min(Math.floor(short / 2 - 1), Math.max(2, Math.round(short * BODY_OPEN)));
  const outsideCore = new Uint8Array(w * h);
  let reach = null;
  // A radius that leaves no core is halved, as Align's opening was
  for (; radius >= 1 && !reach; radius = Math.floor(radius / 2)) {
    const r2 = radius * radius;
    let any = false;
    for (let i = 0; i < outsideCore.length; i++) {
      outsideCore[i] = depth[i] > r2 ? 0 : 1;
      if (!outsideCore[i]) any = true;
    }
    if (any) reach = { map: distanceMap(outsideCore, w, h), r2 };
  }
  if (!reach) return null;
  // The body: what the core covers once grown back. Its centroid and its box
  // (cell edges)
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  let boxLeft = Infinity;
  let boxRight = -Infinity;
  let boxTop = Infinity;
  let boxBottom = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (reach.map[y * w + x] > reach.r2) continue;
      sumX += x + 0.5;
      sumY += y + 0.5;
      count++;
      if (x < boxLeft) boxLeft = x;
      if (x + 1 > boxRight) boxRight = x + 1;
      if (y < boxTop) boxTop = y;
      if (y + 1 > boxBottom) boxBottom = y + 1;
    }
  }
  if (!count) return null;
  let cx = sumX / count;
  let cy = sumY / count;
  if (chamber) {
    cx += ((boxLeft + boxRight) / 2 - cx) * CHAMBER_BOX;
    cy += ((boxTop + boxBottom) / 2 - cy) * CHAMBER_BOX;
  }
  return { x: originX + cx * step, y: originY + cy * step };
};
