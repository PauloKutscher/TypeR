/*
 * buildCases.js — turns the Photoshop measurement reports into one dataset.
 *
 * Input:  .centering-lab/runs/<run>/out/*.json  (measured by measureCentering.jsx)
 *         .centering-lab/runs/<run>/pages/*.notext.raw
 * Output: .centering-lab/runs/<run>/cases.json
 *
 * Ground truth is the original ink centre of each text layer. It is stored for
 * scoring only; the candidate rules in scoreRules.js never receive it.
 *
 * Usage: node scripts/lab/buildCases.js [run]
 */

const fs = require("fs");
const path = require("path");
const L = require("./labImage");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN = process.argv[2] || "000-baseline";
const RUN_DIR = path.join(ROOT, ".centering-lab", "runs", RUN);

/* Same radius formula the plugin uses for its morphological opening. */
const MIN_SELECTION_OPEN_RADIUS = 2;
const SELECTION_OPEN_RATIO = 0.06;

function openRadius(box) {
  const shortest = Math.min(box.width, box.height);
  const maxRadius = Math.floor(shortest / 2 - 1);
  if (maxRadius <= 0) return 0;
  return Math.min(Math.max(MIN_SELECTION_OPEN_RADIUS, Math.round(shortest * SELECTION_OPEN_RATIO)), maxRadius);
}

function convexHull(points) {
  const pts = points.slice().sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

/* Descriptive geometry of a region mask. No decisions here, only numbers. */
function regionMetrics(region, canvas) {
  const rows = L.maskRows(region).filter((r) => r.left >= 0);
  const pts = [];
  for (const r of rows) {
    pts.push([r.left, r.y]);
    pts.push([r.right, r.y]);
  }
  const hull = convexHull(pts);
  const hullArea = hull.length >= 3 ? polygonArea(hull) : region.count;
  const r = openRadius(region.bbox);
  const opened = L.open(region, r);

  const widths = rows.map((row) => row.width);
  const maxWidth = widths.length ? Math.max.apply(null, widths) : 0;
  const meanWidth = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : 0;

  const edge = 2;
  return {
    area: region.count,
    bbox: region.bbox,
    bboxFill: region.count / Math.max(1, region.bbox.width * region.bbox.height),
    solidity: region.count / Math.max(1, hullArea),
    hullVertices: hull.length,
    openRadius: r,
    openedBbox: opened.count ? opened.bbox : null,
    openedArea: opened.count,
    openedLoss: 1 - opened.count / Math.max(1, region.count),
    rowCount: rows.length,
    maxRowWidth: maxWidth,
    meanRowWidth: meanWidth,
    widthRatio: maxWidth ? meanWidth / maxWidth : 0,
    touchesCanvas: {
      left: region.bbox.left <= edge,
      top: region.bbox.top <= edge,
      right: region.bbox.right >= canvas.width - edge,
      bottom: region.bbox.bottom >= canvas.height - edge,
    },
    straightRuns: straightRuns(rows),
  };
}

/*
 * Two shape descriptors for the sides of a region:
 *  - longestRun: rows in a row whose left/right x barely moves. On a tall
 *    high-resolution balloon a curve also moves less than a pixel per row, so
 *    this alone does not separate "cut" from "round".
 *  - flat: fraction of rows whose left (or right) x sits within 2 px of the
 *    extreme. A balloon cut by a panel border is flush with that border over a
 *    large share of its height; a round balloon touches its extreme only near
 *    the middle.
 */
function straightRuns(rows) {
  function longest(key) {
    let best = 0;
    let run = 1;
    for (let i = 1; i < rows.length; i++) {
      if (Math.abs(rows[i][key] - rows[i - 1][key]) <= 1) run++;
      else run = 1;
      if (run > best) best = run;
    }
    return rows.length ? best / rows.length : 0;
  }
  function flat(key, extreme) {
    if (!rows.length) return 0;
    const values = rows.map((r) => r[key]);
    const target = extreme === "min" ? Math.min.apply(null, values) : Math.max.apply(null, values);
    let hits = 0;
    for (const v of values) if (Math.abs(v - target) <= 2) hits++;
    return hits / rows.length;
  }
  return {
    left: longest("left"),
    right: longest("right"),
    flatLeft: flat("left", "min"),
    flatRight: flat("right", "max"),
  };
}

/*
 * Does this text belong to this region? Measured over the 66 layers of the
 * reference pages, two predicates:
 *
 *   centre of the ink inside the mask     26/66
 *   >=20% of the ink box inside the mask  66/66
 *
 * The point test fails because at runtime the plugin hides only the layer it is
 * centring; the glyphs of the others are still painted, so the centre of their
 * ink lands on a letter and falls outside the region. The box test is the
 * predicate the host will use, so it is the one the bench must classify with.
 */
const TEXT_IN_REGION_OVERLAP = 0.20;

function boxOverlapFraction(region, box) {
  const left = Math.max(0, Math.round(box.left));
  const top = Math.max(0, Math.round(box.top));
  const right = Math.min(region.width, Math.round(box.right));
  const bottom = Math.min(region.height, Math.round(box.bottom));
  const area = (box.right - box.left) * (box.bottom - box.top);
  if (area <= 0 || right <= left || bottom <= top) return 0;
  let hits = 0;
  for (let y = top; y < bottom; y++) {
    const row = y * region.width;
    for (let x = left; x < right; x++) {
      if (region.mask[row + x]) hits++;
    }
  }
  return hits / area;
}

function main() {
  const outDir = path.join(RUN_DIR, "out");
  // The composites live once for the whole lab now. Runs made before that
  // still carry their own copy.
  const ownPages = path.join(RUN_DIR, "pages");
  const pageDir = fs.existsSync(ownPages) ? ownPages : path.join(RUN_DIR, "..", "..", "pages");
  const reports = fs.readdirSync(outDir).filter((f) => f.endsWith(".json")).sort();
  const cases = [];
  const pages = [];

  for (const file of reports) {
    const rep = JSON.parse(fs.readFileSync(path.join(outDir, file), "utf8"));
    const stem = path.basename(file, ".json");
    const rawPath = path.join(pageDir, stem + ".notext.raw");
    if (!fs.existsSync(rawPath)) {
      console.error("missing raw for " + stem);
      continue;
    }
    // Only the first run of a series dumps the composites; the later ones reuse
    // them, and then the size has to come from the document instead.
    const size = rep.raw || rep.doc;
    const img = L.readRaw(rawPath, size.width, size.height);
    const canvas = { width: size.width, height: size.height };
    pages.push({ page: stem, doc: rep.doc, layers: rep.layers.length });

    const measured = [];
    for (const layer of rep.layers) {
      if (layer.skipped) {
        cases.push({ page: stem, index: layer.index, name: layer.name, skipped: layer.skipped });
        continue;
      }
      const gt = layer.before.ink || layer.before.metric;
      const probe = layer.region.trueRegion && layer.region.trueRegion.probe;
      if (!gt || !probe) {
        cases.push({ page: stem, index: layer.index, name: layer.name, skipped: "noGeometry" });
        continue;
      }
      const region = L.floodFill(img, probe.x, probe.y, rep.options.wandTolerance);
      measured.push({ layer, gt, probe, region });
    }

    for (const m of measured) {
      // How many text layers live inside the same region? A region that holds
      // two texts cannot be centred for one of them alone, and the partition
      // rules need the boxes themselves, not just the count.
      const inside = [];
      for (let k = 0; k < measured.length; k++) {
        const overlap = boxOverlapFraction(m.region, measured[k].gt);
        if (overlap >= TEXT_IN_REGION_OVERLAP) {
          inside.push({ index: measured[k].layer.index, box: measured[k].gt, overlap: overlap, active: measured[k] === m });
        }
      }
      const metrics = regionMetrics(m.region, canvas);
      const psRegion = m.layer.region.trueRegion.raw;
      cases.push({
        page: stem,
        index: m.layer.index,
        name: m.layer.name,
        canvas,
        text: {
          contents: m.layer.text && m.layer.text.contents,
          size: m.layer.text && m.layer.text.size,
          isPointText: m.layer.isPointText,
          justification: m.layer.text && m.layer.text.justification,
        },
        groundTruth: { ink: m.gt, metric: m.layer.before.metric },
        probe: m.probe,
        plugin: {
          wandRaw: m.layer.region.wandRaw,
          wandOpened: m.layer.region.wandOpened,
          openRadius: m.layer.region.openRadius,
          probe: m.layer.region.pluginProbe,
          shapeLayerBounds: m.layer.region.shapeLayerBounds,
          alignResult: m.layer.align.result,
          deltaX: m.layer.delta.inkX,
          deltaY: m.layer.delta.inkY,
          // How far a second press of Align moves the text. A rule that reads
          // the other layers cannot hold still here.
          repeatX: m.layer.delta.repeatX === undefined ? null : m.layer.delta.repeatX,
          repeatY: m.layer.delta.repeatY === undefined ? null : m.layer.delta.repeatY,
          scatter: m.layer.scatter || null,
          partition: m.layer.region.partition || null,
          geometry: m.layer.region.geometry || null,
          geometry2: m.layer.region.geometry2 || null,
          centroidSkip: m.layer.region.centroidSkip || "",
          engineRegion: m.layer.region.engineRegion || null,
          probe: m.layer.region.probe || null,
          after: m.layer.after.ink,
          restored: m.layer.restored,
        },
        region: {
          photoshopBbox: psRegion,
          nodeBbox: m.region.bbox,
          fidelityX: psRegion ? m.region.bbox.xMid - psRegion.xMid : null,
          fidelityY: psRegion ? m.region.bbox.yMid - psRegion.yMid : null,
          metrics,
          textLayersInside: inside.length,
          textBoxes: inside,
        },
      });
    }
  }

  const dataset = { run: RUN, generated: new Date().toISOString(), pages, cases };
  const outFile = path.join(RUN_DIR, "cases.json");
  fs.writeFileSync(outFile, JSON.stringify(dataset, null, 1));
  console.log("cases: " + cases.length + " (" + cases.filter((c) => c.skipped).length + " skipped) -> " + outFile);
}

main();
