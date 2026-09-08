/*
 * overlayPartition.js — draw what the split saw, so a residual can be read
 * instead of guessed.
 *
 * One SVG per case: the traced region, every corner the pair search found with
 * how deep it turns, every chord it could have cut with the guard that refused
 * it, the piece it kept, the active layer's box, the target it produced and the
 * centre the typesetter had chosen. A case where the piece is the wrong balloon
 * and a case where the piece is right and the centre is off look nothing alike
 * here, and told apart on numbers alone they look the same.
 *
 * Reads a dump written by `replayPartition.js --json`.
 *
 * Usage:
 *   node scripts/lab/overlayPartition.js --dump .centering-lab/replay.json --worst 20
 *   node scripts/lab/overlayPartition.js --dump ... --case "110-none 11#3"
 */

const fs = require("fs");
const path = require("path");
const { liftFrom } = require("./liftHost");

const ROOT = path.resolve(__dirname, "..", "..");
const HOST = liftFrom(fs.readFileSync(path.join(ROOT, "app_src", "host.js"), "utf8"), { resample: () => (p) => p });
const T = HOST.tuning;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
}

/* The same corner detection `_findCuspPair` runs, with its intermediate values kept. */
function cornerProfile(points) {
  const n = points.length;
  const span = Math.max(2, Math.round(n / T._CUSP_SPAN_DIVISOR));
  const turn = [];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const back = points[(i - span + n + n) % n], here = points[i], ahead = points[(i + span) % n];
    const ux = here[0] - back[0], uy = here[1] - back[1];
    const vx = ahead[0] - here[0], vy = ahead[1] - here[1];
    turn[i] = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    total += turn[i];
  }
  const winding = total >= 0 ? 1 : -1;
  const concavity = turn.map((t) => -winding * t);
  const tops = [];
  for (let i = 0; i < n; i++) {
    if (concavity[i] < T._CUSP_ASSIST_CONCAVITY) continue;
    let top = true;
    for (let k = -span; k <= span; k++) if (concavity[(i + k + n + n) % n] > concavity[i]) { top = false; break; }
    if (top) tops.push(i);
  }
  return { span, concavity, tops, n };
}

/* Every pair the search could have taken, in the order it takes them, with the guard that refused it. */
function pairAudit(points, box) {
  const { concavity, tops, n } = cornerProfile(points);
  const size = Math.sqrt(Math.abs(HOST.signedArea(points)) || 1);
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const rows = [];
  for (let a = 0; a < tops.length; a++) {
    for (let b = a + 1; b < tops.length; b++) {
      const ia = tops[a], ib = tops[b];
      const deepA = concavity[ia] >= T._CUSP_CONCAVITY, deepB = concavity[ib] >= T._CUSP_CONCAVITY;
      let gap = Math.abs(ia - ib); if (gap > n / 2) gap = n - gap;
      const length = Math.hypot(points[ia][0] - points[ib][0], points[ia][1] - points[ib][1]);
      const assisted = !deepA || !deepB;
      const row = { ia, ib, ca: concavity[ia], cb: concavity[ib], gap, length, neck: length / size, assisted, reject: "" };
      if (!deepA && !deepB) row.reject = "noDeep";
      else if (gap < n * T._CUSP_MIN_GAP) row.reject = "gap";
      else if (assisted && length > T._CUSP_MAX_NECK * size) row.reject = "neck";
      if (!row.reject) {
        const pieces = HOST.splitContourAtChord(points, ia, ib);
        if (!pieces) row.reject = "noPiece";
        else {
          const chosen = HOST.pieceOnSideOf(pieces, points[ia], points[ib], cx, cy);
          if (!chosen) row.reject = "noSide";
          else {
            row.share = chosen.share;
            row.piece = chosen.points;
            if (chosen.share < T._CUSP_MIN_PIECE_SHARE) row.reject = "shareLow";
            else if (chosen.share > 1 - T._CUSP_MIN_PIECE_SHARE && length > T._CUSP_SHARE_WAIST * size) row.reject = "shareHigh";
            else row.centre = HOST.areaCentroid(chosen.points);
          }
        }
      }
      rows.push(row);
    }
  }
  rows.sort((p, q) => p.length - q.length);
  return { rows, tops, concavity, size, n };
}

/* Run the shipped split, keeping the piece of every pass. */
function passes(points, box) {
  const out = [];
  let current = points;
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  for (let pass = 0; pass < T._CUSP_MAX_CUTS; pass++) {
    const pieceArea = Math.abs(HOST.signedArea(current));
    const pair = HOST.findCuspPair(current);
    if (!pair || pair.a < 0) { out.push({ stop: pair ? "shallow" : "noCusp" }); break; }
    const pieces = HOST.splitContourAtChord(current, pair.a, pair.b);
    if (!pieces) { out.push({ stop: "noPiece" }); break; }
    const chosen = HOST.pieceOnSideOf(pieces, current[pair.a], current[pair.b], cx, cy);
    if (!chosen) { out.push({ stop: "noSide" }); break; }
    const waist = pair.length <= T._CUSP_SHARE_WAIST * Math.sqrt(pieceArea > 0 ? pieceArea : 1);
    if (chosen.share < T._CUSP_MIN_PIECE_SHARE || (chosen.share > 1 - T._CUSP_MIN_PIECE_SHARE && !waist)) {
      out.push({ stop: "share", chord: [current[pair.a], current[pair.b]], share: chosen.share });
      break;
    }
    out.push({
      chord: [current[pair.a], current[pair.b]],
      share: chosen.share,
      piece: chosen.points,
      centre: HOST.areaCentroid(chosen.points),
    });
    current = chosen.points;
  }
  return out;
}

function svg(row, box, audit, passList) {
  const pts = row.rec.contour;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const grow = (x, y) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); };
  for (const p of pts) grow(p[0], p[1]);
  grow(box.left, box.top); grow(box.right, box.bottom);
  grow(row.truth.x, row.truth.y);
  const pad = 40;
  minX -= pad; minY -= pad; maxX += pad; maxY += pad;
  const w = maxX - minX, h = maxY - minY;
  const poly = (p, cls) => `<polygon class="${cls}" points="${p.map((q) => q[0].toFixed(1) + "," + q[1].toFixed(1)).join(" ")}"/>`;
  const cross = (p, cls, label) => p ? `<g class="${cls}"><line x1="${p.x - 14}" y1="${p.y}" x2="${p.x + 14}" y2="${p.y}"/><line x1="${p.x}" y1="${p.y - 14}" x2="${p.x}" y2="${p.y + 14}"/><text x="${p.x + 16}" y="${p.y - 6}">${label}</text></g>` : "";

  const parts = [];
  parts.push(poly(pts, "region"));
  for (const pass of passList) if (pass.piece) parts.push(poly(pass.piece, "piece"));
  for (const r of audit.rows) {
    const a = pts[r.ia], b = pts[r.ib];
    const cls = r.reject ? "chordRej" : "chordOk";
    parts.push(`<line class="${cls}" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`);
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    parts.push(`<text class="lbl" x="${mx}" y="${my}">${r.reject || "share " + r.share.toFixed(2)}</text>`);
  }
  for (const i of audit.tops) {
    const deep = audit.concavity[i] >= T._CUSP_CONCAVITY;
    parts.push(`<circle class="${deep ? "cuspDeep" : "cuspSoft"}" cx="${pts[i][0]}" cy="${pts[i][1]}" r="${(6 + 10 * audit.concavity[i]).toFixed(1)}"/>`);
    parts.push(`<text class="lbl" x="${pts[i][0] + 8}" y="${pts[i][1] + 16}">${i}:${audit.concavity[i].toFixed(2)}</text>`);
  }
  parts.push(`<rect class="box" x="${box.left}" y="${box.top}" width="${box.right - box.left}" height="${box.bottom - box.top}"/>`);
  parts.push(cross(row.truth, "truth", "typesetter"));
  const engine = row.engines[Object.keys(row.engines)[0]];
  parts.push(cross(engine.target, "target", "alvo " + engine.error.toFixed(0) + "px"));
  parts.push(cross(row.rec.regionCentroid, "centroid", "centroide da região"));

  const legend = [
    `${row.run} ${row.key}`,
    `erro ${engine.error.toFixed(1)} px · cortes ${engine.cuts} · ${engine.skip || "sem recusa"} · região ${row.rec.source}`,
    `contorno n=${audit.n} · size ${audit.size.toFixed(0)} · gap mínimo ${(audit.n * T._CUSP_MIN_GAP).toFixed(0)} · corda máxima assistida ${(T._CUSP_MAX_NECK * audit.size).toFixed(0)} · cintura ${(T._CUSP_SHARE_WAIST * audit.size).toFixed(0)}`,
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${Math.min(1400, w)}">
<style>
 text{font:${Math.max(11, w / 90).toFixed(0)}px sans-serif}
 .region{fill:#eef2f7;stroke:#33455c;stroke-width:${(w / 500).toFixed(2)}}
 .piece{fill:#b8e0c2;fill-opacity:.55;stroke:#227a42;stroke-width:${(w / 600).toFixed(2)}}
 .chordOk{stroke:#1a7f37;stroke-width:${(w / 350).toFixed(2)}}
 .chordRej{stroke:#c0392b;stroke-width:${(w / 700).toFixed(2)};stroke-dasharray:${(w / 120).toFixed(1)} ${(w / 200).toFixed(1)}}
 .cuspDeep{fill:#c0392b;fill-opacity:.75}
 .cuspSoft{fill:#e0a800;fill-opacity:.6}
 .box{fill:none;stroke:#1f6fb2;stroke-width:${(w / 500).toFixed(2)};stroke-dasharray:${(w / 100).toFixed(1)} ${(w / 150).toFixed(1)}}
 .truth line{stroke:#000;stroke-width:${(w / 350).toFixed(2)}} .truth text{fill:#000}
 .target line{stroke:#8e44ad;stroke-width:${(w / 350).toFixed(2)}} .target text{fill:#8e44ad}
 .centroid line{stroke:#7f8c8d;stroke-width:${(w / 500).toFixed(2)}} .centroid text{fill:#7f8c8d}
 .lbl{fill:#555}
</style>
${parts.join("\n")}
<g>${legend.map((l, i) => `<text x="${minX + 8}" y="${minY + 18 + i * 18}" style="font-size:${Math.max(12, w / 80).toFixed(0)}px">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`).join("")}</g>
</svg>`;
}

function activeBoxOf(row) {
  const page = row.key.slice(0, row.key.lastIndexOf("#"));
  const index = Number(row.key.slice(row.key.lastIndexOf("#") + 1));
  const rep = readJson(path.join(ROOT, ".centering-lab", "runs", row.run, "out", page + ".json"));
  const layer = rep.layers.find((l) => l.index === index);
  const s = layer.scatter || { dx: 0, dy: 0 };
  const b = layer.before.metric;
  return { left: b.left + s.dx, right: b.right + s.dx, top: b.top + s.dy, bottom: b.bottom + s.dy };
}

function main() {
  const argv = process.argv.slice(2);
  const arg = (n, d) => { const i = argv.indexOf("--" + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
  const rows = readJson(arg("dump", path.join(ROOT, ".centering-lab", "replay.json")));
  const outDir = arg("out", path.join(ROOT, ".centering-lab", "overlays"));
  fs.mkdirSync(outDir, { recursive: true });
  const only = arg("case", "");
  const engineName = Object.keys(rows[0].engines)[0];
  let picked = rows.filter((r) => r.rec.contour && r.truth);
  if (only) picked = picked.filter((r) => (r.run + " " + r.key) === only || r.key === only);
  else {
    picked.sort((a, b) => b.engines[engineName].error - a.engines[engineName].error);
    picked = picked.slice(0, Number(arg("worst", "20")));
  }
  const table = [];
  for (const row of picked) {
    const box = activeBoxOf(row);
    const audit = pairAudit(row.rec.contour, box);
    const passList = passes(row.rec.contour, box);
    const name = (row.run + "_" + row.key).replace(/[^\w#~.-]+/g, "_") + ".svg";
    fs.writeFileSync(path.join(outDir, name), svg(row, box, audit, passList));
    const e = row.engines[engineName];
    table.push({
      key: row.run + " " + row.key,
      error: e.error,
      cuts: e.cuts,
      skip: e.skip || "",
      corners: audit.tops.length,
      deepCorners: audit.tops.filter((i) => audit.concavity[i] >= T._CUSP_CONCAVITY).length,
      rejected: audit.rows.filter((r) => r.reject).map((r) => r.reject),
      bestRejected: audit.rows.filter((r) => r.reject)[0] || null,
      svg: name,
    });
  }
  console.log("caso".padEnd(52) + " erro   cortes recusa        esquinas(fundas) motivos de rejeição");
  for (const t of table) {
    const counts = {};
    for (const r of t.rejected) counts[r] = (counts[r] || 0) + 1;
    console.log(
      t.key.padEnd(52) + " " + t.error.toFixed(1).padStart(6) + "  " + String(t.cuts).padStart(2) + "    " +
      (t.skip || "-").padEnd(14) + " " + String(t.corners).padStart(2) + "(" + t.deepCorners + ")            " +
      Object.keys(counts).map((k) => k + ":" + counts[k]).join(" ")
    );
  }
  console.log("\noverlays em " + outDir);
}

main();
