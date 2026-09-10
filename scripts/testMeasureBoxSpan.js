/*
 * The measuring box used while applying text to a box-text layer.
 *
 * _setActiveLayerText drops the text into a box too wide to soft wrap it, reads
 * the real extent and shrinks the box around it. That box used to be 2x the
 * page's longest side on each side — 7680 x 7680 px on a 2700 x 3840 page — and
 * the type engine charges for its area: measured on the reference pages, one
 * apply cost 4 s to 45 s, against 389 ms for the same apply on a point layer,
 * which skips the pass. Sizing the box from the text instead took the same 96
 * applies from 18.3 s to 0.8 s each with every line break, ink bound and result
 * identical (scripts/lab/diagMeasureBox.jsx, scripts/lab/compareMeasureBox.js).
 *
 * An estimate that comes out too small would soft wrap the text and the extent
 * would then describe the box instead of the text — a silently wrong line break
 * on the typesetter's page. These are the guards that keep the estimate an upper
 * bound and keep the fallback that catches it when it is not.
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "app_src/host.js"), "utf8");

const bodyOf = (header) => {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} must exist`);
  const end = source.indexOf("\n}", start);
  assert.ok(end > start, `${header} must be closed`);
  return source.slice(start, end + 2);
};

// The estimator is pure: lift it out and check the bound it promises
const estimatorSource = bodyOf("function _getMeasureBoxSpanForText(text, textSize)");
const context = { result: null };
vm.createContext(context);
vm.runInContext(`${estimatorSource}\nresult = _getMeasureBoxSpanForText;`, context);
const span = context.result;

assert.strictEqual(span("qualquer", 0), null, "no body size means no estimate");
assert.strictEqual(span("qualquer", -3), null);
assert.strictEqual(span("qualquer", null), null);

// Wide enough for the longest line at one em per glyph, with room to spare
const size = 17;
const line = "PROCURAR OS FRAGMENTOS DA PEDRA";
const oneLine = span(line, size);
assert.ok(
  oneLine.width > line.length * size,
  `the box must be wider than the line at one em per glyph: ${oneLine.width} vs ${line.length * size}`
);
// The longest line decides the width, not the total length
const threeLines = span(`${line}\n${line}\n${line}`, size);
assert.strictEqual(threeLines.width, oneLine.width, "extra lines must not widen the box");
assert.ok(threeLines.height > oneLine.height, "extra lines must make it taller");
assert.ok(
  threeLines.height > 3 * size * 2,
  "the height must clear three lines at any plausible leading"
);
// Windows line endings must not count as a character of their own
assert.deepStrictEqual(span(`${line}\r\n${line}`, size), span(`${line}\n${line}`, size));
// Empty text still gets a usable box rather than a zero-width one
assert.ok(span("", size).width > 0 && span("", size).height > 0);

// The estimate is only ever an optimisation: the page-sized box stays the
// ceiling and stays the fallback
const applySource = bodyOf("function _setActiveLayerText()");
assert.ok(
  /if \(estimate\.width >= pageSpan && estimate\.height >= pageSpan\) estimate = null;/.test(applySource),
  "an estimate no smaller than the page-sized box must be dropped, not applied"
);
assert.ok(
  /if \(estimate\.width > pageSpan\) estimate\.width = pageSpan;/.test(applySource) &&
    /if \(estimate\.height > pageSpan\) estimate\.height = pageSpan;/.test(applySource),
  "and one that overshoots on a single axis must be clamped to it"
);
assert.ok(
  /_convertPixelToPointExact\(textExtent\.width\) >= measureEstimate\.width - textSize \|\|[\s\S]{0,120}_convertPixelToPointExact\(textExtent\.height\) >= measureEstimate\.height - textSize/.test(applySource),
  "text that reached either edge of the estimated box must not be trusted: it may have been wrapped or cut"
);
assert.ok(
  /measureEstimate = null;[\s\S]{0,80}textExtent = _getCurrentTextLayerBounds\(\);/.test(applySource),
  "the fallback must re-measure in the page-sized box before the fit pass reads the extent"
);
assert.ok(
  applySource.indexOf("boxShape.bounds.right = measureBoxBounds.left + measureBoxBounds.pageSpan") >= 0,
  "the fallback must restore the exact box this always used"
);

console.log("measuring box span guards passed");
