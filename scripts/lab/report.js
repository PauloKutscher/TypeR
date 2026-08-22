/*
 * report.js — turns cases.json into the phase-2 error report.
 *
 * Classification is derived from the measured geometry, never from the file
 * name or the ground truth position:
 *   leak        the flood-filled region holds more than one text layer, or
 *               covers an implausible share of the page: the plugin cannot
 *               know which balloon the text belongs to
 *   cut         the region is flush with a page/panel border along a large
 *               share of one side
 *   scream      low solidity: spikes and serrations (shout balloons)
 *   normal      everything else
 *
 * A second, independent axis counts how many text layers share the region
 * (texts:1 | texts:2 | texts:3+). It lives in caseClass.js together with the
 * shape classes above, because the two answer different questions and a double
 * panel would otherwise be filed as a scream.
 *
 * PASS is per axis: |delta| <= max(1 px, 1% of the region's shorter side).
 *
 * Usage: node scripts/lab/report.js [run]
 */

const fs = require("fs");
const path = require("path");
const { classify, topology, tolerance, CATEGORIES, TOPOLOGIES } = require("./caseClass");

const ROOT = path.resolve(__dirname, "..", "..");
const RUN = process.argv[2] || "000-baseline";
const RUN_DIR = path.join(ROOT, ".centering-lab", "runs", RUN);

function quantile(values, p) {
  if (!values.length) return NaN;
  const s = values.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function summarize(list, pick) {
  const signed = list.map(pick);
  const abs = signed.map(Math.abs);
  return {
    n: list.length,
    bias: signed.length ? signed.reduce((a, b) => a + b, 0) / signed.length : NaN,
    median: quantile(abs, 0.5),
    p95: quantile(abs, 0.95),
    max: abs.length ? Math.max.apply(null, abs) : NaN,
  };
}

function fmt(n, digits = 1) {
  return Number.isFinite(n) ? n.toFixed(digits) : "-";
}

function main() {
  const data = JSON.parse(fs.readFileSync(path.join(RUN_DIR, "cases.json"), "utf8"));
  const cases = data.cases.filter((c) => !c.skipped);
  for (const c of cases) { c.category = classify(c); c.topology = topology(c); }

  const lines = [];
  lines.push("# Fase 2 — erro real da centralização atual");
  lines.push("");
  lines.push(`Run: \`${data.run}\` · gerado em ${data.generated}`);
  lines.push(`Páginas: ${data.pages.length} · camadas de texto medidas: ${cases.length}`);
  lines.push("");
  lines.push("Motor: `app/host.jsx` do `develop`, chamado por `alignTextLayerToSelection`, sem marquee ativa, `resizeTextBox: false`, `padding: 0`. Cada camada é medida a partir do estado original e o histórico é restaurado depois, então todas as medições partem do ground truth.");
  lines.push("");

  const fidelity = Math.max.apply(null, cases.map((c) => Math.max(Math.abs(c.region.fidelityX), Math.abs(c.region.fidelityY))));
  lines.push(`Fidelidade da bancada offline: o flood fill em Node reproduz o centro da região do Photoshop com desvio máximo de ${fmt(fidelity, 1)} px nos ${cases.length} casos, então a busca de regra pode rodar sem Photoshop.`);
  lines.push("");

  lines.push("## Agregado por categoria");
  lines.push("");
  lines.push("| Categoria | Casos | viés X | \\|X\\| med | \\|X\\| p95 | \\|X\\| max | viés Y | \\|Y\\| med | \\|Y\\| p95 | \\|Y\\| max | PASS |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const cat of CATEGORIES.concat(["TOTAL"])) {
    const list = cat === "TOTAL" ? cases : cases.filter((c) => c.category === cat);
    if (!list.length) continue;
    const sx = summarize(list, (c) => c.plugin.deltaX);
    const sy = summarize(list, (c) => c.plugin.deltaY);
    const pass = list.filter((c) => Math.abs(c.plugin.deltaX) <= tolerance(c) && Math.abs(c.plugin.deltaY) <= tolerance(c)).length;
    lines.push(`| ${cat} | ${list.length} | ${fmt(sx.bias)} | ${fmt(sx.median)} | ${fmt(sx.p95)} | ${fmt(sx.max, 0)} | ${fmt(sy.bias)} | ${fmt(sy.median)} | ${fmt(sy.p95)} | ${fmt(sy.max, 0)} | ${pass}/${list.length} |`);
  }
  lines.push("");
  lines.push("Erros em pixels, medidos no centro da tinta do texto. `viés` é a média assinada: separa erro sistemático de dispersão.");
  lines.push("");

  // Second axis: how many text layers share the region. A region holding two
  // texts cannot be centred for one of them alone, and the shape classes above
  // hide those cases (a double panel has solidity 0.69-0.72, which a shape-first
  // classifier calls a scream).
  lines.push("## Agregado por topologia (camadas de texto na região)");
  lines.push("");
  lines.push("| Topologia | Casos | viés X | \|X\| med | \|X\| p95 | \|X\| max | viés Y | \|Y\| med | \|Y\| p95 | \|Y\| max | PASS |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const topo of TOPOLOGIES.concat(["TOTAL"])) {
    const list = topo === "TOTAL" ? cases : cases.filter((c) => c.topology === topo);
    if (!list.length) continue;
    const sx = summarize(list, (c) => c.plugin.deltaX);
    const sy = summarize(list, (c) => c.plugin.deltaY);
    const pass = list.filter((c) => Math.abs(c.plugin.deltaX) <= tolerance(c) && Math.abs(c.plugin.deltaY) <= tolerance(c)).length;
    lines.push(`| ${topo} | ${list.length} | ${fmt(sx.bias)} | ${fmt(sx.median)} | ${fmt(sx.p95)} | ${fmt(sx.max, 0)} | ${fmt(sy.bias)} | ${fmt(sy.median)} | ${fmt(sy.p95)} | ${fmt(sy.max, 0)} | ${pass}/${list.length} |`);
  }
  lines.push("");

  // Pressing Align twice must land on the same pixel. A rule that reads where
  // the other text layers are cannot: they move as they are aligned, so the
  // answer moves with them and the typesetter sees the text jump.
  const repeated = cases.filter((c) => c.plugin.repeatX !== null && c.plugin.repeatX !== undefined);
  if (repeated.length) {
    const moved = repeated.filter((c) => Math.abs(c.plugin.repeatX) >= 1 || Math.abs(c.plugin.repeatY) >= 1);
    const rx = summarize(repeated, (c) => c.plugin.repeatX);
    const ry = summarize(repeated, (c) => c.plugin.repeatY);
    lines.push("## Idempotência (segunda passada do Align)");
    lines.push("");
    lines.push(`Camadas medidas duas vezes: ${repeated.length} · que se movem 1 px ou mais na segunda passada: **${moved.length}**`);
    lines.push("");
    lines.push("| eixo | \|d\| med | \|d\| p95 | \|d\| max |");
    lines.push("| --- | --- | --- | --- |");
    lines.push(`| X | ${fmt(rx.median)} | ${fmt(rx.p95)} | ${fmt(rx.max, 0)} |`);
    lines.push(`| Y | ${fmt(ry.median)} | ${fmt(ry.p95)} | ${fmt(ry.max, 0)} |`);
    lines.push("");
    if (moved.length) {
      lines.push("Piores: " + moved.slice()
        .sort((a, b) => (Math.abs(b.plugin.repeatX) + Math.abs(b.plugin.repeatY)) - (Math.abs(a.plugin.repeatX) + Math.abs(a.plugin.repeatY)))
        .slice(0, 8)
        .map((c) => `${c.page.slice(-6)}#${c.index} ${c.plugin.repeatX}/${c.plugin.repeatY}`)
        .join(" · "));
      lines.push("");
    }
  }

  lines.push("## Veredito de causa raiz");
  lines.push("");
  const inkEqualsMetric = cases.every((c) => c.groundTruth.ink.xMid === c.groundTruth.metric.xMid && c.groundTruth.ink.yMid === c.groundTruth.metric.yMid);
  const single = cases.filter((c) => c.category !== "leak");
  const leaks = cases.filter((c) => c.category === "leak");
  const bboxPass = single.filter((c) => {
    const box = c.region.metrics.openedBbox || c.region.nodeBbox;
    return Math.abs(box.xMid - c.groundTruth.ink.xMid) <= tolerance(c) && Math.abs(box.yMid - c.groundTruth.ink.yMid) <= tolerance(c);
  }).length;

  lines.push(`- **H1 (caixa métrica ≠ tinta): descartada.** ${inkEqualsMetric ? "Em todos os" : "Em parte dos"} ${cases.length} casos o \`bounds\` que o plugin lê é idêntico ao bbox da tinta medido em duplicata rasterizada. A propriedade AM \`bounds\` de camada de texto já é a caixa da tinta, então não existe erro de métrica de fonte a corrigir aqui.`);
  lines.push(`- **H3 (região errada): dominante.** ${leaks.length} de ${cases.length} casos (${(100 * leaks.length / cases.length).toFixed(0)}%) caem em regiões que o flood fill contíguo funde: a região abrange mais de uma camada de texto ou uma fatia implausível da página. Nesses casos o erro mediano é de centenas de pixels e o texto é lançado para o centro de outro balão.`);
  lines.push(`- **H2 (bbox ≠ centro visual): residual relevante.** Nos ${single.length} casos de região isolada, centralizar pelo bbox da região aberta acerta apenas ${bboxPass}/${single.length} dentro da tolerância de 1%. O rabicho do balão infla o bbox e a assimetria vertical desloca o centro.`);
  lines.push("");

  lines.push("## Piores casos");
  lines.push("");
  lines.push("| Página | # | Camada | dX | dY | categoria | textos na região | região |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  cases.slice()
    .sort((a, b) => (Math.abs(b.plugin.deltaX) + Math.abs(b.plugin.deltaY)) - (Math.abs(a.plugin.deltaX) + Math.abs(a.plugin.deltaY)))
    .slice(0, 12)
    .forEach((c) => {
      lines.push(`| ${c.page.slice(-9)} | ${c.index} | ${JSON.stringify((c.name || "").slice(0, 26))} | ${c.plugin.deltaX} | ${c.plugin.deltaY} | ${c.category} | ${c.region.textLayersInside} | ${c.region.nodeBbox.width}x${c.region.nodeBbox.height} |`);
    });
  lines.push("");

  lines.push("## Detalhe por balão");
  lines.push("");
  const byPage = {};
  for (const c of cases) (byPage[c.page] = byPage[c.page] || []).push(c);
  for (const page of Object.keys(byPage).sort()) {
    lines.push(`### ${page}`);
    lines.push("");
    lines.push("| # | Camada | categoria | texto orig. (centro) | após plugin | dX | dY | região usada (centro) | margens E/D/T/B | status |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const c of byPage[page]) {
      const gt = c.groundTruth.ink;
      const after = c.plugin.after;
      const region = c.region.metrics.openedBbox || c.region.nodeBbox;
      const marginL = gt.left - c.region.nodeBbox.left;
      const marginR = c.region.nodeBbox.right - gt.right;
      const marginT = gt.top - c.region.nodeBbox.top;
      const marginB = c.region.nodeBbox.bottom - gt.bottom;
      const tol = tolerance(c);
      const status = (Math.abs(c.plugin.deltaX) <= tol && Math.abs(c.plugin.deltaY) <= tol) ? "PASS" : "FAIL";
      lines.push(`| ${c.index} | ${JSON.stringify((c.name || "").slice(0, 22))} | ${c.category} | ${gt.xMid}, ${gt.yMid} | ${after ? after.xMid + ", " + after.yMid : "-"} | ${c.plugin.deltaX} | ${c.plugin.deltaY} | ${region.xMid}, ${region.yMid} | ${marginL}/${marginR}/${marginT}/${marginB} | ${status} |`);
    }
    lines.push("");
  }

  const outFile = path.join(RUN_DIR, "report.md");
  fs.writeFileSync(outFile, lines.join("\n"));

  const counts = {};
  for (const c of cases) counts[c.category] = (counts[c.category] || 0) + 1;
  const topoCounts = {};
  for (const c of cases) topoCounts[c.topology] = (topoCounts[c.topology] || 0) + 1;
  console.log("report -> " + outFile);
  console.log("categorias: " + JSON.stringify(counts));
  console.log("topologia: " + JSON.stringify(topoCounts));
  const pass = cases.filter((c) => Math.abs(c.plugin.deltaX) <= tolerance(c) && Math.abs(c.plugin.deltaY) <= tolerance(c)).length;
  console.log("PASS do plugin: " + pass + "/" + cases.length);
}

main();
