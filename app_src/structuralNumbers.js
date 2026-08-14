import { isPageMarker, matchPageMarker } from "./pageMarker";

// Scripts pasted from a table often carry an auxiliary numbering next to the
// dialogue. Depending on how the source document is built it lands in the
// flattened text as its own column, as the last line inside each dialogue
// cell, or as sibling lines interleaved with the dialogue — so keying off the
// table structure alone missed the common case. What every shape does share is
// the *sequence*: a counter that walks forward one step at a time, one entry
// per line of dialogue.
//
// That sequence is the evidence used here. A lone number is never dropped —
// it may well be a real line ("1", "100", "2026"). Only a run of at least
// three numbers that behaves like a counter and interleaves with real text is
// removed, and if any guard fails nothing is dropped at all. Keeping a
// metadata number costs the user one deletion; dropping a real line loses
// their script.

const MIN_RUN = 3;
// A counter may repeat (several lines share a panel number) but never goes
// backwards and never jumps: "1,1,2,2,3" yes, "1,2,100,2026" no.
const MAX_STEP = 1;
// Numbering is regular. Two candidates separated by a wall of dialogue are two
// unrelated numbers, not one counter.
const MAX_DISTANCE = 5;
const MIN_CANDIDATE_COVERAGE = 0.6;
const MIN_LINE_COVERAGE = 0.2;
const MIN_ALTERNATION = 0.6;

// Four digits is enough for any page/panel counter and keeps long numeric
// dialogue (phone numbers, IDs) out of the candidates.
const isPureNumber = (text) => /^[0-9]{1,4}$/.test((text || "").trim());

const numberOf = (text) => Number((text || "").trim());

// Every maximal stretch of candidates that behaves like one counter. There can
// be several in one paste: the numbering restarts at each page, so "…12, 13,
// 1, 2, 3…" is two counters, not one broken one.
const counterRuns = (candidates) => {
  const runs = [];
  candidates.forEach((candidate) => {
    const current = runs[runs.length - 1];
    const previous = current && current[current.length - 1];
    const continues =
      previous &&
      candidate.value - previous.value >= 0 &&
      candidate.value - previous.value <= MAX_STEP &&
      candidate.position - previous.position <= MAX_DISTANCE;
    if (continues) current.push(candidate);
    else runs.push([candidate]);
  });
  return runs;
};

// entries: non-empty lines in document order, `{ index, text, position }`.
const findNumberingRun = (entries) => {
  const candidates = entries
    .map((entry, position) => ({ entry, position, value: numberOf(entry.text) }))
    .filter(({ entry }) => isPureNumber(entry.text) && !isPageMarker(entry.text));

  const checks = [];
  const fail = (label) => {
    checks.push(label);
    return { targets: [], checks };
  };

  if (candidates.length < MIN_RUN) return fail(`only ${candidates.length} numeric line(s), need ${MIN_RUN}`);

  const runs = counterRuns(candidates).filter((run) => run.length >= MIN_RUN);
  runs.forEach((run) => {
    checks.push(`counter ${run[0].value}→${run[run.length - 1].value} across ${run.length} lines`);
  });
  if (!runs.length) return fail(`no run of ${MIN_RUN}+ numbers stepping by 0..${MAX_STEP} within ${MAX_DISTANCE} lines`);

  const members = runs.reduce((all, run) => all.concat(run), []);
  if (members.length / candidates.length < MIN_CANDIDATE_COVERAGE) {
    return fail(`counters cover only ${Math.round((members.length / candidates.length) * 100)}% of the numeric lines`);
  }
  if (members.length / entries.length < MIN_LINE_COVERAGE) {
    return fail(`counters cover only ${Math.round((members.length / entries.length) * 100)}% of all lines`);
  }

  const isText = (entry) => entry && entry.text && !isPureNumber(entry.text);
  const alternating = members.filter(
    ({ position }) => isText(entries[position - 1]) || isText(entries[position + 1])
  );
  if (alternating.length / members.length < MIN_ALTERNATION) {
    return fail(`only ${alternating.length}/${members.length} numbers sit next to text`);
  }

  checks.push(`${runs.length} counter(s), ${members.length} lines, ${alternating.length} next to text`);
  return {
    targets: members.map(({ entry }) => entry),
    reason:
      runs.length > 1
        ? `part of ${runs.length} restarting counters covering ${members.length} lines`
        : `part of a ${members.length}-entry counter (${members[0].value}→${members[members.length - 1].value}) interleaved with dialogue`,
    checks,
  };
};

// The strongest evidence available: a whole table column that holds nothing
// but numbers, sitting next to a column that holds the dialogue. No inference
// about counters needed — the document itself separates the two, so a number
// in the dialogue column is dialogue even when it duplicates the number the
// numbering column shows on the same row.
//
// Page markers are skipped when judging a column: the marker shares its cell
// with the first number of the page ("Page 10" + "1"), and counting it as
// content would disqualify the very column we are looking for.
const findNumberingColumn = (entries) => {
  const columns = new Map();
  entries.forEach((entry) => {
    const { colIndex } = entry.line;
    if (colIndex === null || colIndex === undefined) return;
    if (!columns.has(colIndex)) columns.set(colIndex, []);
    columns.get(colIndex).push(entry);
  });
  if (columns.size < 2) return null;

  const contentOf = (items) => items.filter((entry) => !isPageMarker(entry.text));
  const numericColumns = [...columns.entries()].filter(([, items]) => {
    const content = contentOf(items);
    return content.length >= MIN_RUN && content.every((entry) => isPureNumber(entry.text));
  });
  if (!numericColumns.length) return null;

  const textColumn = [...columns.entries()].find(
    ([key, items]) =>
      !numericColumns.some(([numericKey]) => numericKey === key) &&
      contentOf(items).some((entry) => !isPureNumber(entry.text))
  );
  if (!textColumn) return null;

  // Ties are not expected (a script has one numbering column); pick the
  // biggest so the choice is at least deterministic.
  const [key, items] = numericColumns.sort((a, b) => contentOf(b[1]).length - contentOf(a[1]).length)[0];
  const targets = contentOf(items);
  return {
    targets: targets.map((entry) => entry),
    column: key,
    reason: `sits in the numbering column (col ${key}), next to the dialogue column (col ${textColumn[0]})`,
    checks: [`numbering column: col ${key} (${targets.length} numbers); col ${textColumn[0]} holds text`],
  };
};

// lines: the array returned by convertDomToMarkdownDetailed().lines, or any
// array of `{ text }`.
const analyzeStructuralNumbers = (lines) => {
  const all = (Array.isArray(lines) ? lines : []).map((line, index) => ({
    index,
    line,
    text: (line && line.text ? line.text : "").trim(),
  }));
  const entries = all.filter((entry) => entry.text);

  // Strongest evidence first. A paste with no cell structure at all (plain
  // text) has nothing to go on, and there a lone number is dialogue — so it is
  // left alone rather than guessed at.
  const hasCells = entries.some((entry) => entry.line.cellId !== null && entry.line.cellId !== undefined);
  const rule =
    (hasCells && findNumberingColumn(entries)) ||
    (hasCells && findNumberingRun(entries)) || { targets: [], checks: ["no cell structure — nothing to key off"] };

  const dropped = new Set();
  rule.targets.forEach((entry) => dropped.add(entry.index));

  const report = all.map((entry) => {
    const page = matchPageMarker(entry.text);
    if (page !== null) {
      return { index: entry.index, text: entry.text, action: "page", page, reason: `page marker → page ${page}` };
    }
    if (dropped.has(entry.index)) {
      return { index: entry.index, text: entry.text, action: "drop", reason: rule.reason };
    }
    return {
      index: entry.index,
      text: entry.text,
      action: "keep",
      reason: !isPureNumber(entry.text)
        ? "content"
        : rule.column === undefined
          ? "number, but no counter claims it — kept"
          : `number outside the numbering column (col ${entry.line.colIndex}) — dialogue, kept`,
    };
  });

  return {
    keep: all.filter((entry) => !dropped.has(entry.index)).map((entry) => entry.line),
    dropped: dropped.size,
    checks: rule.checks,
    report,
  };
};

export { analyzeStructuralNumbers, isPureNumber };
