/*
 * caseClass.js — the one place that turns a measured case into a class.
 *
 * Two independent classifications live here, and they answer different
 * questions about the same case:
 *
 *   classify(c)   shape of the region: normal | cut | scream | leak
 *   topology(c)   how many text layers share the region: texts:1 | texts:2 | texts:3+
 *
 * Topology is deliberately evaluated on its own axis rather than folded into
 * classify(): a double panel has solidity 0.69-0.72, below the scream threshold
 * of 0.85, so a shape-first classifier calls it a scream and hides exactly the
 * cases this step exists to fix. Counting texts first is what keeps the two
 * classes apart.
 *
 * Everything reads from the measured geometry in cases.json, never from the
 * file name or the ground truth position.
 */

const LEAK_PAGE_SHARE = 0.15;
const CUT_FLAT_SIDE = 0.35;
const SCREAM_SOLIDITY = 0.85;

function classify(c) {
  const m = c.region.metrics;
  if (c.region.textLayersInside > 1) return "leak";
  if (m.area / (c.canvas.width * c.canvas.height) > LEAK_PAGE_SHARE) return "leak";
  const t = m.touchesCanvas;
  const flat = Math.max(m.straightRuns.flatLeft || 0, m.straightRuns.flatRight || 0);
  if (flat >= CUT_FLAT_SIDE || t.left || t.right || t.top || t.bottom) return "cut";
  if (m.solidity < SCREAM_SOLIDITY) return "scream";
  return "normal";
}

function topology(c) {
  const n = c.region.textLayersInside || 0;
  if (n >= 3) return "texts:3+";
  if (n === 2) return "texts:2";
  return "texts:1";
}

/* PASS is per axis: |delta| <= max(1 px, 1% of the region's shorter side). */
function tolerance(c) {
  return Math.max(1, 0.01 * Math.min(c.region.nodeBbox.width, c.region.nodeBbox.height));
}

const CATEGORIES = ["normal", "cut", "scream", "leak"];
const TOPOLOGIES = ["texts:1", "texts:2", "texts:3+"];

module.exports = {
  classify,
  topology,
  tolerance,
  CATEGORIES,
  TOPOLOGIES,
  LEAK_PAGE_SHARE,
  CUT_FLAT_SIDE,
  SCREAM_SOLIDITY,
};
