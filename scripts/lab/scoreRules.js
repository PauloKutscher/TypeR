/*
 * scoreRules.js — ranks candidate centering rules against the ground truth.
 *
 * A rule is a pair (isolation, centre). Both stages receive only what the
 * plugin can know at runtime: the flood-filled region, the seed point (the
 * current text position, which the plugin already has) and the text ink size.
 * The ground-truth centre is used exclusively to score the result, never as an
 * input, and no rule may look at the page name or index.
 *
 * The seed is the text's current position. In the bench that position happens
 * to be the correct one, so every rule is also scored with the seed jittered by
 * +-40 px in eight directions: a rule that only works with a perfect seed is
 * not usable in production and the jitter column exposes it.
 *
 * Usage: node scripts/lab/scoreRules.js [run] [--jitter] [--detail rule]
 */

const fs = require("fs");
const path = require("path");
const L = require("./labImage");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "000-baseline";
const RUN_DIR = path.join(ROOT, ".centering-lab", "runs", RUN);
const WANT_JITTER = process.argv.includes("--jitter");
const DETAIL = (() => {
  const i = process.argv.indexOf("--detail");
  return i >= 0 ? process.argv[i + 1] : null;
})();

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

/* ---------- isolation stages ---------- */

function dtAt(region, x, y) {
  const dt = L.distanceTransform(region);
  return dt[Math.round(y) * region.width + Math.round(x)] || 0;
}

const isolations = {
  raw: (region) => region,
  pluginOpen: (region) => {
    const shortest = Math.min(region.bbox.width, region.bbox.height);
    const maxRadius = Math.floor(shortest / 2 - 1);
    if (maxRadius <= 0) return region;
    const r = Math.min(Math.max(2, Math.round(shortest * 0.06)), maxRadius);
    const opened = L.open(region, r);
    return opened.count ? opened : region;
  },
  // What the host really does: _SELECTION_OPEN_RATIO is 0.1 with a floor of 4 px
  // and a halving retry while the result is smaller than 200 px². `pluginOpen`
  // above was scored with 0.06 and no retry, so it was not the host's opening.
  hostOpen: (region) => {
    const shortest = Math.min(region.bbox.width, region.bbox.height);
    const maxRadius = Math.floor(shortest / 2 - 1);
    if (maxRadius <= 0) return region;
    let r = Math.min(Math.max(4, Math.round(shortest * 0.1)), maxRadius);
    while (r >= 1) {
      const opened = L.open(region, r);
      if (opened.count && opened.bbox.width * opened.bbox.height >= 200) return opened;
      r = Math.floor(r / 2);
    }
    return region;
  },
  isolate35: (region, ctx) => L.isolate(region, ctx.seedX, ctx.seedY, Math.max(2, Math.round(0.35 * ctx.dtSeed))),
  trim40: (region) => L.trim(region, 0.40),
  trim50: (region) => L.trim(region, 0.50),
  trim60: (region) => L.trim(region, 0.60),
  openThenTrim50: (region) => {
    const shortest = Math.min(region.bbox.width, region.bbox.height);
    const maxRadius = Math.floor(shortest / 2 - 1);
    const r = maxRadius > 0 ? Math.min(Math.max(2, Math.round(shortest * 0.06)), maxRadius) : 0;
    const opened = r > 0 ? L.open(region, r) : region;
    return L.trim(opened.count ? opened : region, 0.50);
  },
};

/* ---------- centre rules ---------- */

function areaCentroid(region) {
  const { mask, width, bbox } = region;
  let sx = 0, sy = 0, n = 0;
  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      if (!mask[y * width + x]) continue;
      sx += x; sy += y; n++;
    }
  }
  return n ? { cx: sx / n, cy: sy / n } : { cx: bbox.xMid, cy: bbox.yMid };
}

function dtMax(region) {
  const dt = L.distanceTransform(region);
  const { bbox, width } = region;
  let best = -1, cx = bbox.xMid, cy = bbox.yMid;
  for (let y = bbox.top; y < bbox.bottom; y++) {
    for (let x = bbox.left; x < bbox.right; x++) {
      const v = dt[y * width + x];
      if (v > best) { best = v; cx = x; cy = y; }
    }
  }
  return { cx, cy };
}

const centres = {
  bbox: (region) => ({ cx: region.bbox.xMid, cy: region.bbox.yMid }),
  centroid: areaCentroid,
  // The tail sits on the side of a balloon far more often than above or below
  // it, so the horizontal centroid follows the tail while the vertical one
  // follows the balloon's real asymmetry. This pair keeps each axis on the
  // estimator that measured better on that axis.
  centroidYbboxX: (region) => ({ cx: region.bbox.xMid, cy: areaCentroid(region).cy }),
  centroidXbboxY: (region) => ({ cx: areaCentroid(region).cx, cy: region.bbox.yMid }),
  inscribedRect: (region, ctx) => {
    const aspect = Math.max(0.05, ctx.textWidth / Math.max(1, ctx.textHeight));
    const best = L.largestInscribedRect(region, aspect);
    return { cx: best.cx, cy: best.cy };
  },
  /*
   * Equal room above and below at the text's own horizontal extent, and equal
   * room left and right at its vertical extent: what a typesetter eyeballs.
   * Iterated twice because moving the block changes which rows and columns it
   * spans.
   */
  fitMargins: (region, ctx) => {
    const { mask, width, bbox } = region;
    let cx = bbox.xMid;
    let cy = bbox.yMid;
    for (let pass = 0; pass < 3; pass++) {
      const halfW = ctx.textWidth / 2;
      const halfH = ctx.textHeight / 2;
      let top = Infinity, bottom = -Infinity;
      for (let x = Math.max(bbox.left, Math.round(cx - halfW)); x <= Math.min(bbox.right - 1, Math.round(cx + halfW)); x++) {
        for (let y = bbox.top; y < bbox.bottom; y++) {
          if (mask[y * width + x]) { if (y < top) top = y; break; }
        }
        for (let y = bbox.bottom - 1; y >= bbox.top; y--) {
          if (mask[y * width + x]) { if (y > bottom) bottom = y; break; }
        }
      }
      let left = Infinity, right = -Infinity;
      for (let y = Math.max(bbox.top, Math.round(cy - halfH)); y <= Math.min(bbox.bottom - 1, Math.round(cy + halfH)); y++) {
        for (let x = bbox.left; x < bbox.right; x++) {
          if (mask[y * width + x]) { if (x < left) left = x; break; }
        }
        for (let x = bbox.right - 1; x >= bbox.left; x--) {
          if (mask[y * width + x]) { if (x > right) right = x; break; }
        }
      }
      if (top <= bottom) cy = (top + bottom + 1) / 2;
      if (left <= right) cx = (left + right + 1) / 2;
    }
    return { cx, cy };
  },
};

/* ---------- scoring ---------- */

function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function summaryOf(sub) {
  return {
    n: sub.length,
    pass: sub.filter((r) => Math.abs(r.dx) <= r.tol && Math.abs(r.dy) <= r.tol).length,
    pass2: sub.filter((r) => Math.abs(r.dx) <= 2 * r.tol && Math.abs(r.dy) <= 2 * r.tol).length,
    medX: quantile(sub.map((r) => Math.abs(r.dx)), 0.5),
    medY: quantile(sub.map((r) => Math.abs(r.dy)), 0.5),
    p95X: quantile(sub.map((r) => Math.abs(r.dx)), 0.95),
    p95Y: quantile(sub.map((r) => Math.abs(r.dy)), 0.95),
  };
}

function loadPages(cases) {
  const pages = {};
  for (const c of cases) {
    if (pages[c.page]) continue;
    const raw = path.join(RUN_DIR, "pages", c.page + ".notext.raw");
    pages[c.page] = L.readRaw(raw, c.canvas.width, c.canvas.height);
  }
  return pages;
}

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "cases.json"), "utf8"));
  const cases = data.cases.filter((c) => !c.skipped);
  for (const c of cases) c.category = classify(c);
  const pages = loadPages(cases);

  const jitters = WANT_JITTER
    ? [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [28, 28], [-28, 28], [28, -28], [-28, -28]]
    : [[0, 0]];

  const results = {};
  for (const isoName of Object.keys(isolations)) {
    for (const cName of Object.keys(centres)) {
      results[isoName + "+" + cName] = [];
    }
  }

  for (const c of cases) {
    const gt = c.groundTruth.ink;
    const tol = Math.max(1, 0.01 * Math.min(c.region.nodeBbox.width, c.region.nodeBbox.height));
    for (const [jx, jy] of jitters) {
      const seedX = Math.round(c.probe.x + jx);
      const seedY = Math.round(c.probe.y + jy);
      const img = pages[c.page];
      if (seedX < 0 || seedY < 0 || seedX >= img.width || seedY >= img.height) continue;
      // A jittered seed can land on ink of the artwork; skip it, the plugin
      // would not sample there either (it samples inside the balloon).
      const region = L.floodFill(img, seedX, seedY, 20);
      if (!region.count || region.count > img.width * img.height * 0.6) continue;
      const ctx = {
        seedX,
        seedY,
        textWidth: gt.width,
        textHeight: gt.height,
        dtSeed: dtAt(region, seedX, seedY),
      };
      for (const [isoName, iso] of Object.entries(isolations)) {
        let isolated;
        try { isolated = iso(region, ctx); } catch (e) { continue; }
        if (!isolated || !isolated.count) continue;
        for (const [cName, centre] of Object.entries(centres)) {
          let point;
          try { point = centre(isolated, ctx); } catch (e) { continue; }
          results[isoName + "+" + cName].push({
            page: c.page,
            index: c.index,
            category: c.category,
            jitter: jx !== 0 || jy !== 0,
            dx: point.cx - gt.xMid,
            dy: point.cy - gt.yMid,
            tol,
          });
        }
      }
    }
  }

  const categories = ["normal", "cut", "scream", "leak"];
  const rows = [];
  for (const [name, list] of Object.entries(results)) {
    const base = list.filter((r) => !r.jitter);
    if (!base.length) continue;
    const row = { name, n: base.length };
    // "scope" is what this phase must fix: closed, cut and scream balloons.
    // Double/overlapping balloons (leak) are out of scope and are scored apart.
    const inScope = base.filter((r) => r.category !== "leak");
    row.scope = summaryOf(inScope);
    for (const cat of categories.concat(["all"])) {
      const sub = cat === "all" ? base : base.filter((r) => r.category === cat);
      row[cat] = sub.length ? summaryOf(sub) : null;
    }
    if (WANT_JITTER) {
      const j = list.filter((r) => r.jitter && r.category !== "leak");
      row.jitterPass = j.length ? j.filter((r) => Math.abs(r.dx) <= r.tol && Math.abs(r.dy) <= r.tol).length / j.length : NaN;
      row.jitterN = j.length;
    }
    rows.push(row);
  }

  rows.sort((a, b) => (b.scope.pass / b.scope.n) - (a.scope.pass / a.scope.n));

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n, d = 1) => String(Number.isFinite(v) ? v.toFixed(d) : "-").padStart(n);
  console.log("\nESCOPO = normal + cut + scream (balao duplo fica fora, pontuado a parte)\n");
  console.log("regra                      | ESCOPO PASS  PASS2% | normal | cut    | medX medY  p95X  p95Y | leak" + (WANT_JITTER ? "  | jitter" : ""));
  console.log("-".repeat(WANT_JITTER ? 120 : 110));
  for (const r of rows) {
    const cell = (c) => (c ? `${String(c.pass).padStart(2)}/${String(c.n).padEnd(3)}` : "  -   ");
    console.log(
      pad(r.name, 26) + " | " +
      String(r.scope.pass).padStart(3) + "/" + pad(r.scope.n, 4) +
      num(100 * r.scope.pass2 / r.scope.n, 6) + "% | " +
      cell(r.normal) + " | " + cell(r.cut) + " | " +
      num(r.scope.medX, 4) + num(r.scope.medY, 5) + num(r.scope.p95X, 6) + num(r.scope.p95Y, 6) + " | " +
      cell(r.leak) +
      (WANT_JITTER ? " | " + num(100 * r.jitterPass, 5) + "%" : "")
    );
  }
  console.log("\nPASS = |dX| e |dY| <= max(1 px, 1% do menor lado). PASS2% = mesma conta com 2%.");
  if (WANT_JITTER) console.log("jitter = PASS no escopo com a semente deslocada em 8 direcoes (+-40 px), " + rows[0].jitterN + " amostras por regra.");

  // Detectors for the out-of-scope case (two overlapping balloons): recall on
  // the cases this phase must refuse versus false alarms on the ones it must
  // handle. Refusing beats dropping the text into the wrong lobe.
  const detectors = {
    bimodalProfile: (region) => !!L.detectTwoLobes(region),
    lobes50: (region) => L.countLobes(region, 0.50).lobes >= 2,
    lobes40: (region) => L.countLobes(region, 0.40).lobes >= 2,
    lobes60: (region) => L.countLobes(region, 0.60).lobes >= 2,
  };
  const score = {};
  for (const name of Object.keys(detectors)) score[name] = { hit: 0, leak: 0, falseAlarm: 0, scope: 0 };
  for (const c of cases) {
    const region = L.floodFill(pages[c.page], Math.round(c.probe.x), Math.round(c.probe.y), 20);
    for (const [name, fn] of Object.entries(detectors)) {
      let flagged = false;
      try { flagged = fn(region); } catch (e) { flagged = false; }
      if (c.category === "leak") { score[name].leak++; if (flagged) score[name].hit++; }
      else { score[name].scope++; if (flagged) score[name].falseAlarm++; }
    }
  }
  console.log("\ndetectores de regiao com mais de um balao:");
  for (const [name, s] of Object.entries(score)) {
    console.log("  " + name.padEnd(16) + " detecta " + String(s.hit).padStart(2) + "/" + s.leak +
      " fora de escopo | falso alarme " + String(s.falseAlarm).padStart(2) + "/" + s.scope + " no escopo");
  }

  if (DETAIL && results[DETAIL]) {
    console.log("\n--- piores casos de " + DETAIL + " ---");
    results[DETAIL].filter((r) => !r.jitter)
      .sort((a, b) => (Math.abs(b.dx) + Math.abs(b.dy)) - (Math.abs(a.dx) + Math.abs(a.dy)))
      .slice(0, 15)
      .forEach((r) => console.log(`  ${r.page.slice(-9)} #${r.index} ${r.category.padEnd(6)} dX=${r.dx.toFixed(1).padStart(7)} dY=${r.dy.toFixed(1).padStart(7)} tol=${r.tol.toFixed(1)}`));
  }

  const outFile = path.join(RUN_DIR, "rules.json");
  fs.writeFileSync(outFile, JSON.stringify({ run: RUN, jitter: WANT_JITTER, rows }, null, 1));
  console.log("\nranking -> " + outFile);
}

main();
