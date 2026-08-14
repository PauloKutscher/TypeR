// Writes the "why was this number dropped/kept" report to a file so it can be
// read without CEF remote debugging (the extension ships no .debug file, so
// there is no DevTools port). Runs on the CEP Node runtime (--enable-nodejs in
// the manifest) and, like fontFileExport.js, degrades silently when Node is
// unavailable instead of throwing into the paste handler.

const LOG_NAME = "typer-paste-debug.log";
const MAX_HTML = 8 * 1024;

const getNode = () => {
  const nodeRequire =
    (typeof window !== "undefined" && window.cep_node && window.cep_node.require) ||
    (typeof window !== "undefined" && typeof window.require === "function" ? window.require : null);
  if (!nodeRequire) return null;
  try {
    return { fs: nodeRequire("fs"), path: nodeRequire("path"), os: nodeRequire("os") };
  } catch (e) {
    return null;
  }
};

const LABELS = { page: "PAGE MARKER", drop: "DISCARD", keep: "KEEP" };

const buildReport = (analysis, lines, html) => {
  const out = [];
  out.push(`TypeR paste report — ${new Date().toISOString()}`);
  out.push(`${lines.length} line(s) in, ${analysis.dropped} dropped, ${analysis.keep.length} kept`);
  out.push("");
  out.push("Rule checks:");
  (analysis.checks || []).forEach((check) => out.push(`  - ${check}`));
  out.push("");
  analysis.report.forEach((entry) => {
    const line = lines[entry.index] || {};
    const cell =
      line.cellId === null || line.cellId === undefined
        ? "no cell"
        : `cell ${line.cellId} col ${line.colIndex} pos ${line.posInCell}/${line.cellLineCount}`;
    out.push(`[${LABELS[entry.action]}] ${JSON.stringify(entry.text)} — ${entry.reason} (${cell})`);
  });
  out.push("");
  out.push(`--- raw clipboard HTML (first ${MAX_HTML} bytes) ---`);
  out.push((html || "").slice(0, MAX_HTML));
  return out.join("\n");
};

// Returns the log path when it could be written, otherwise null.
const writePasteDebugReport = (analysis, lines, html) => {
  const node = getNode();
  if (!node) return null;
  try {
    const target = node.path.join(node.os.tmpdir(), LOG_NAME);
    node.fs.writeFileSync(target, buildReport(analysis, lines, html), "utf8");
    return target;
  } catch (e) {
    return null;
  }
};

export { writePasteDebugReport, buildReport };
