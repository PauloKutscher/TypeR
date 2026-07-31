const VOWELS = "aeiouyAEIOUY\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc";
const MAX_VARIANTS = 12;
const MARKDOWN_TOKENS = ["***", "**", "__", "*", "_"];
const LINE_END_PUNCTUATION = /[.,;:!?…]$/;
const PROFILE_PRESETS = {
  balanced: {
    minLines: 2,
    maxLines: 6,
    lineTarget: 4,
    curves: [0.35, 0.45, 0.6, 0.75],
    shifts: [0, -0.12, 0.12, -0.2, 0.2],
    biases: [-1, 0, 1],
    minWeight: 0.35,
    punctuationBreakBonus: 14,
    adjacentSlack: 0.22,
    smoothnessWeight: 210,
    minLineRatio: 0.4,
    scoreCurve: 0.65,
    maxLineWidth: 26,
  },
  round: {
    minLines: 3,
    maxLines: 5,
    lineTarget: 4,
    curves: [0.55, 0.65, 0.8, 0.95],
    shifts: [0, -0.08, 0.08, -0.16, 0.16],
    biases: [-1, 0, 1],
    minWeight: 0.3,
    punctuationBreakBonus: 14,
    adjacentSlack: 0.18,
    smoothnessWeight: 240,
    minLineRatio: 0.38,
    scoreCurve: 0.8,
    maxLineWidth: 22,
  },
  tall: {
    minLines: 4,
    maxLines: 7,
    lineTarget: 5,
    curves: [0.24, 0.3, 0.42, 0.55],
    shifts: [0, -0.1, 0.1, -0.18, 0.18],
    biases: [-1, 0, 1],
    minWeight: 0.46,
    punctuationBreakBonus: 11,
    adjacentSlack: 0.26,
    smoothnessWeight: 160,
    minLineRatio: 0.36,
    scoreCurve: 0.5,
    maxLineWidth: 18,
  },
  wide: {
    minLines: 2,
    maxLines: 4,
    lineTarget: 3,
    curves: [0.18, 0.22, 0.34, 0.46],
    shifts: [0, -0.08, 0.08, -0.16, 0.16],
    biases: [-1, 0, 1, 2],
    minWeight: 0.58,
    punctuationBreakBonus: 11,
    adjacentSlack: 0.2,
    smoothnessWeight: 220,
    minLineRatio: 0.5,
    scoreCurve: 0.4,
    maxLineWidth: 34,
  },
};

// Merges hyphenation left over from a previous line break: "silho- uette"
// reads as the word "silhouette". The junction is scored with the same
// syllable model used to create hyphenations: a real césure sits on a
// plausible syllable boundary of the merged word, while a compound broken
// at its own hyphen ("court- circuit", "peut- être", "voulait- il") lands
// on an implausible one and keeps its hyphen. Uppercase continuations
// ("Jean- Paul") always read as compounds. Standalone dashes
// ("il - enfin - vint", "—") never match: a letter must sit right before
// the hyphen and the space only after it.
const DEHYPHENATE_PATTERN = /([A-Za-zÀ-ÖØ-öø-ÿ]+)- ([A-Za-zÀ-ÖØ-öø-ÿ]+)/g;
const UPPERCASE_LETTER = /[A-ZÀ-ÖØ-Þ]/;
// Accepts every syllable-boundary score, including the weak vowel-vowel
// ones (7); rejects unknown clusters (10) and consonant+vowel onsets (16)
const CESURE_MAX_PENALTY = 8;

let dehyphenationEnabled = false;
const setDehyphenationEnabled = (enabled) => {
  dehyphenationEnabled = enabled === true;
};

const dehyphenate = (text) => {
  if (!dehyphenationEnabled || text.indexOf("- ") === -1) return text;
  return text.replace(DEHYPHENATE_PATTERN, (match, before, after) => {
    if (UPPERCASE_LETTER.test(after[0])) return before + "-" + after;
    const penalty = getSyllableSplitPenalty(before + after, before.length);
    return penalty < CESURE_MAX_PENALTY ? before + after : before + "-" + after;
  });
};

const normalizeText = (text) => dehyphenate(String(text || "").replace(/\s+/g, " ").trim());
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const stripMarkdownForMeasure = (text) => String(text || "")
  .replace(/\\([\\*_])/g, "$1")
  .replace(/[*_]/g, "");

const visibleLength = (text) => stripMarkdownForMeasure(text).length;

const getCharWidth = (char) => {
  if (!char) return 0;
  if (/\s/.test(char)) return 0.45;
  if (/[ilI.,;:!|'’]/.test(char)) return 0.45;
  if (/[mwMW@#%&]/.test(char)) return 1.32;
  if (/[A-ZÀÂÄÉÈÊËÎÏÔÖÙÛÜ]/.test(char)) return 1.12;
  return 1;
};

const visibleWidth = (text) => {
  const clean = stripMarkdownForMeasure(text);
  let width = 0;
  for (let index = 0; index < clean.length; index++) {
    width += getCharWidth(clean[index]);
  }
  return width;
};

const tokenLength = (token) => {
  // Token text never changes: cache the measured width on the token itself
  if (token.__width == null) token.__width = visibleWidth(token.text);
  return token.__width;
};

const lineText = (tokens) => tokens.map((token) => token.text).join(" ").trim();

const lineLength = (tokens) => visibleWidth(lineText(tokens));

const isVowel = (char) => VOWELS.indexOf(char) !== -1;

const isLetter = (char) => /[A-Za-z\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc]/.test(char || "");

const isConsonant = (char) => isLetter(char) && !isVowel(char);

const hasVowel = (text) => {
  for (let index = 0; index < text.length; index++) {
    if (isVowel(text[index])) return true;
  }
  return false;
};

const hasMarkdownSyntax = (word) => /[*_\\]/.test(word);

const endsWithBreakPunctuation = (text) => {
  const clean = stripMarkdownForMeasure(text)
    .replace(/[)"'’»\]]+$/g, "")
    .trim();
  return LINE_END_PUNCTUATION.test(clean);
};

const isEscaped = (text, index) => {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) count++;
  return count % 2 === 1;
};

const findMarkdownTokenAt = (text, index) => MARKDOWN_TOKENS.find((token) => (
  text.slice(index, index + token.length) === token && !isEscaped(text, index)
));

const findClosingMarkdownToken = (text, token, start) => {
  let index = text.indexOf(token, start);
  while (index !== -1) {
    if (!isEscaped(text, index)) return index;
    index = text.indexOf(token, index + token.length);
  }
  return -1;
};

const splitWordsPreservingMarkdown = (text) => {
  const words = [];
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text[index])) index++;
    if (index >= text.length) break;

    const markdownToken = findMarkdownTokenAt(text, index);
    if (markdownToken) {
      const contentStart = index + markdownToken.length;
      const closeIndex = findClosingMarkdownToken(text, markdownToken, contentStart);
      if (closeIndex !== -1) {
        words.push(text.slice(index, closeIndex + markdownToken.length));
        index = closeIndex + markdownToken.length;
        continue;
      }
    }

    let nextSpace = index;
    while (nextSpace < text.length && !/\s/.test(text[nextSpace])) nextSpace++;
    words.push(text.slice(index, nextSpace));
    index = nextSpace;
  }
  return words.filter(Boolean);
};

const splitTrailingPunctuation = (word) => {
  const match = String(word || "").match(/^(.+?)([.,;:!?]+)?$/);
  return {
    body: match ? match[1] : word,
    punctuation: match && match[2] ? match[2] : "",
  };
};

// French syllable attacks: consonant clusters that legally start a syllable
// and therefore must travel together to the next line. Splitting inside one
// ("tab-leau", "vac-he") reads as cutting mid-syllable.
const FRENCH_ONSETS = {
  bl: 1, br: 1, ch: 1, cl: 1, cr: 1, dr: 1, fl: 1, fr: 1, gl: 1, gn: 1,
  gr: 1, kl: 1, kr: 1, ph: 1, pl: 1, pr: 1, rh: 1, th: 1, tr: 1, vr: 1,
  chl: 1, chr: 1, phl: 1, phr: 1, thr: 1,
};

// Penalty scale: 0-1.5 are clean French syllable boundaries (the only ones
// hyphenation generation uses), 6-7 are merge-plausible but never generated
// (mute-e tails, digraph interiors, vowel-vowel), 10+ are implausible
// boundaries that keep a compound's own hyphen during dehyphenation
const getSyllableSplitPenalty = (body, index) => {
  const lower = String(body || "").toLowerCase();
  const left = lower.slice(0, index);
  const right = lower.slice(index);
  if (!hasVowel(left) || !hasVowel(right)) return Infinity;
  const prev = lower[index - 1];
  const current = lower[index];
  if (isVowel(prev) && isVowel(current)) return 7;
  // Splitting between a consonant and its vowel beheads the syllable
  if (isConsonant(prev) && isVowel(current)) return 16;
  // French typography: no hyphen before an intervocalic x ("ta-xi")
  if (current === "x" && isVowel(lower[index + 1])) return 12;
  // Boundary inside an inseparable pair: mid-syllable cut, never generate
  if (isConsonant(prev) && FRENCH_ONSETS[prev + current]) return 7;

  // Walk the consonant run around the boundary: the consonants carried to
  // the next line (the onset) must form a legal French syllable attack
  let start = index;
  while (start > 0 && isConsonant(lower[start - 1])) start--;
  let end = index;
  while (end < lower.length && isConsonant(lower[end])) end++;
  const onset = lower.slice(index, end);
  const codaLength = index - start;
  const rest = lower.slice(end);
  // Carrying consonants + mute e ("attitu-des") strands a silent syllable
  if (rest === "e" || rest === "es") return 6;
  // A lone aspirated/mute h can't open a carried syllable ("ca-hier")
  if (onset === "h") return 6;
  // Two coda consonants land here only via compound junctions
  // ("court- circuit"): keep them implausible so dehyphenation preserves them
  if (codaLength >= 2) return 10;
  if (onset.length === 1) return codaLength === 0 ? 0 : 1;
  if (FRENCH_ONSETS[onset]) return codaLength === 0 ? 0.5 : 1.5;
  return 10;
};

// Tokens made purely of closing punctuation (French "salut !" splits into
// two words) must never start a line: glue them to the previous word.
// Opening punctuation ("«", "¿") must never end a line: glue to the next.
const CLOSING_PUNCTUATION_ONLY = /^[!?;:.,…»›)\]}]+$/;
const OPENING_PUNCTUATION_ONLY = /^[«‹¿¡(\[{]+$/;

const mergePunctuationWords = (words) => {
  const closed = [];
  words.forEach((word) => {
    if (closed.length && CLOSING_PUNCTUATION_ONLY.test(stripMarkdownForMeasure(word))) {
      closed[closed.length - 1] += ` ${word}`;
      return;
    }
    closed.push(word);
  });
  const merged = [];
  for (let index = 0; index < closed.length; index++) {
    let word = closed[index];
    while (index + 1 < closed.length && OPENING_PUNCTUATION_ONLY.test(stripMarkdownForMeasure(word))) {
      index++;
      word += ` ${closed[index]}`;
    }
    merged.push(word);
  }
  return merged;
};

const hyphenSplitCache = new Map();

const getHyphenSplits = (word) => {
  const cached = hyphenSplitCache.get(word);
  if (cached) return cached;
  const splits = computeHyphenSplits(word);
  if (hyphenSplitCache.size >= 512) hyphenSplitCache.clear();
  hyphenSplitCache.set(word, splits);
  return splits;
};

const computeHyphenSplits = (word) => {
  const { body, punctuation } = splitTrailingPunctuation(word);
  if (!body || body.length < 8) return [];
  if (hasMarkdownSyntax(body) || /[-'’\s]/.test(body)) return [];

  const positions = [];
  for (let index = 3; index <= body.length - 3; index++) {
    const syllablePenalty = getSyllableSplitPenalty(body, index);
    // Only clean syllable boundaries (0-1.5) become visible hyphenations;
    // merge-plausible-but-ugly cuts (6+) are reserved for dehyphenation
    if (!Number.isFinite(syllablePenalty) || syllablePenalty >= 3) continue;
    const centerPenalty = Math.abs(index - body.length / 2);
    positions.push({
      index,
      penalty: syllablePenalty * 10 + centerPenalty,
      prefix: body.slice(0, index) + "-",
      suffix: body.slice(index) + punctuation,
    });
  }

  return positions
    .sort((a, b) => a.penalty - b.penalty || a.index - b.index)
    .slice(0, 3);
};

const buildWeights = (lineCount, curve = 0.5, shift = 0, minWeight = 0.35) => {
  if (lineCount <= 1) return [1];
  const center = (lineCount - 1) / 2 + shift;
  const maxDistance = Math.max(center, lineCount - 1 - center) || 1;
  return Array.from({ length: lineCount }, (_, index) => {
    const distance = Math.abs(index - center) / maxDistance;
    return Math.max(minWeight, 1 - distance * curve);
  });
};

const buildTargets = (tokens, lineCount, curve, shift, bias, minWeight) => {
  const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount);
  const weights = buildWeights(lineCount, curve, shift, minWeight);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => Math.max(1, (total * weight) / weightTotal + bias));
};

const serializeLines = (lines) => lines.map((line) => line.map((token) => token.text).join(" ").trim()).join("\n");

const getTokenMetrics = (tokens) => {
  // Cached on the token array: prefix width sums and per-token flags make
  // every DP line cost O(1) instead of re-measuring joined strings
  if (tokens.__metrics) return tokens.__metrics;
  const tokenCount = tokens.length;
  const prefix = new Array(tokenCount + 1);
  prefix[0] = 0;
  const charPrefix = new Array(tokenCount + 1);
  charPrefix[0] = 0;
  const endsBreak = new Array(tokenCount);
  const punctOnly = new Array(tokenCount);
  const breakCount = new Array(tokenCount + 1);
  breakCount[0] = 0;
  const punctCount = new Array(tokenCount + 1);
  punctCount[0] = 0;
  for (let index = 0; index < tokenCount; index++) {
    prefix[index + 1] = prefix[index] + tokenLength(tokens[index]);
    charPrefix[index + 1] = charPrefix[index] + visibleLength(tokens[index].text);
    endsBreak[index] = endsWithBreakPunctuation(tokens[index].text);
    punctOnly[index] = /^[.,;:!?…]+$/.test(stripMarkdownForMeasure(tokens[index].text));
    breakCount[index + 1] = breakCount[index] + (tokens[index].forceBreakAfter ? 1 : 0);
    punctCount[index + 1] = punctCount[index] + (punctOnly[index] ? 1 : 0);
  }
  const metrics = { prefix, charPrefix, endsBreak, punctOnly, breakCount, punctCount };
  tokens.__metrics = metrics;
  return metrics;
};

// Lines wider than this ratio of their target never survive scoring: stop
// extending `to` past it so the DP inner loop stays proportional to the
// target width instead of the whole token count
const DP_WIDTH_PRUNE_RATIO = 2.5;

// Flat typed-array DP buffers reused across every buildCandidate run: the
// generator fires this DP hundreds of times per call and per-run 2D array
// allocation dominated the profile
let dpBuffer = new Float64Array(0);
let prevBuffer = new Int32Array(0);

const buildCandidate = (tokens, lineCount, targets) => {
  if (!tokens.length || lineCount < 1) return null;
  if (tokens.length < lineCount) return null;
  const tokenCount = tokens.length;
  const { prefix, endsBreak, punctOnly, breakCount } = getTokenMetrics(tokens);
  const stride = tokenCount + 1;
  const size = (lineCount + 1) * stride;
  if (dpBuffer.length < size) {
    dpBuffer = new Float64Array(size);
    prevBuffer = new Int32Array(size);
  }
  dpBuffer.fill(Infinity, 0, size);
  prevBuffer.fill(-1, 0, size);
  dpBuffer[0] = 0;

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const target = targets[lineIndex] || 1;
    const pruneWidth = target * (1 + DP_WIDTH_PRUNE_RATIO);
    const isLastLine = lineIndex === lineCount - 1;
    const rowOffset = lineIndex * stride;
    const nextRowOffset = rowOffset + stride;
    const maxTo = tokenCount - (lineCount - lineIndex - 1);
    for (let from = lineIndex; from <= tokenCount; from++) {
      const baseCost = dpBuffer[rowOffset + from];
      if (baseCost === Infinity) continue;
      const fromPrefix = prefix[from];
      const fromBreaks = breakCount[from];
      for (let to = from + 1; to <= maxTo; to++) {
        const width = prefix[to] - fromPrefix + 0.45 * (to - from - 1);
        // Single-token lines stay allowed so one giant word can never make
        // the whole DP infeasible
        if (width > pruneWidth && to > from + 1) break;
        // A forced break inside the range (anywhere but on its last token)
        // makes the line invalid; prefix counts make the check O(1)
        if (breakCount[to - 1] - fromBreaks > 0) continue;
        const ratio = (width - target) / target;
        let cost = ratio * ratio;
        if (!isLastLine && endsBreak[to - 1]) {
          cost = cost > 0.09 ? cost - 0.09 : 0;
        }
        if (to - from === 1 && punctOnly[from]) cost += 3;
        const nextCost = baseCost + cost;
        if (nextCost < dpBuffer[nextRowOffset + to]) {
          dpBuffer[nextRowOffset + to] = nextCost;
          prevBuffer[nextRowOffset + to] = from;
        }
      }
    }
  }

  if (dpBuffer[lineCount * stride + tokenCount] === Infinity) return null;

  const lines = [];
  let cursor = tokenCount;
  for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
    const from = prevBuffer[lineIndex * stride + cursor];
    if (from < 0) return null;
    lines.unshift(tokens.slice(from, cursor));
    cursor = from;
  }
  return lines;
};

// Absolute silhouette quality gate, separate from scoring: scores only rank
// candidates against each other, so when every candidate is bad the "best"
// one is still bad — this measure tells ugly from clean in absolute terms so
// the final list can drop ragged stacks, huge adjacent jumps, and overlong
// lines outright instead of merely ranking them last
const CLEAN_SILHOUETTE_BADNESS = 0.6;
const BEARABLE_SILHOUETTE_BADNESS = 1.3;

const getSilhouetteBadness = (lengths, widthCap) => {
  const lineCount = lengths.length;
  const maxLength = Math.max.apply(null, lengths);
  let badness = 0;
  if (widthCap > 0) {
    lengths.forEach((length) => {
      badness += Math.max(0, length / widthCap - 1) * 3;
    });
  }
  if (lineCount < 2 || !(maxLength > 0)) return badness;
  // Steps measured against the longer of the two neighbours: a 2-unit line
  // beside a 10-unit line reads terribly even when the block peak is 20
  const stepSlack = lineCount === 2 ? 0.32 : 0.55;
  const stepWeight = lineCount === 2 ? 6 : 4;
  for (let index = 1; index < lineCount; index++) {
    const longer = Math.max(lengths[index], lengths[index - 1], 1);
    const step = Math.abs(lengths[index] - lengths[index - 1]) / longer;
    badness += Math.max(0, step - stepSlack) * stepWeight;
  }
  if (lineCount >= 3) {
    const interiorMax = Math.max.apply(null, lengths.slice(1, lineCount - 1));
    const edgeMax = Math.max(lengths[0], lengths[lineCount - 1]);
    if (edgeMax > interiorMax) {
      badness += ((edgeMax - interiorMax) / maxLength) * 2.5;
    }
    // Convex profile: rise to the peak, fall after it; small waves pass
    const peakIndex = lengths.indexOf(maxLength);
    for (let index = 1; index <= peakIndex; index++) {
      const drop = (lengths[index - 1] - lengths[index]) / maxLength;
      if (drop > 0.18) badness += (drop - 0.18) * 2;
    }
    for (let index = peakIndex + 1; index < lineCount; index++) {
      const rise = (lengths[index] - lengths[index - 1]) / maxLength;
      if (rise > 0.18) badness += (rise - 0.18) * 2;
    }
    const minRatio = Math.min.apply(null, lengths) / maxLength;
    if (minRatio < 0.3) badness += (0.3 - minRatio) * 2;
  }
  return badness;
};

// Aesthetic silhouette rules shared by generic and bubble-aware scoring:
// the widest line belongs in the middle, the top/bottom edges stay short,
// widths rise to the peak then fall, and neighbouring lines keep close widths
const scoreSilhouetteAesthetics = (lengths, profile) => {
  const lineCount = lengths.length;
  const maxLength = Math.max.apply(null, lengths);
  const minLength = Math.min.apply(null, lengths);
  if (!(maxLength > 0) || lineCount < 2) return 0;
  const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;

  if (lineCount === 2) {
    const adjacentSlack = profile.adjacentSlack == null ? 0.24 : profile.adjacentSlack;
    const difference = Math.abs(lengths[0] - lengths[1]) / maxLength;
    const excess = Math.max(0, difference - adjacentSlack);
    return excess * excess * smoothnessWeight;
  }

  const adjacentSlack = profile.adjacentSlack == null ? 0.3 : profile.adjacentSlack;
  const minLineRatio = profile.minLineRatio == null ? 0.34 : profile.minLineRatio;
  const minRatio = minLength / maxLength;
  const interiorLengths = lengths.slice(1, lineCount - 1);
  const interiorMax = Math.max.apply(null, interiorLengths);
  let score = 0;

  // The widest line must sit in the middle of the shape, not on an edge
  const edgeMax = Math.max(lengths[0], lengths[lineCount - 1]);
  if (edgeMax > interiorMax) {
    score += Math.pow((edgeMax - interiorMax) / maxLength, 2) * 420 + 20;
  }

  // Edge lines must stay clearly below the interior peak (graded, not
  // binary): equal-width top and middle lines read as a slab, not a bubble
  if (interiorMax > 0) {
    [lengths[0], lengths[lineCount - 1]].forEach((edgeLength) => {
      const edgeExcess = Math.max(0, edgeLength / interiorMax - 0.85);
      score += edgeExcess * edgeExcess * 900;
    });
  }

  // Bubble profile: lengths should rise toward the peak then fall after it;
  // every dip before the peak or bump after it breaks the convex silhouette
  const peakIndex = lengths.indexOf(maxLength);
  for (let index = 1; index <= peakIndex; index++) {
    const drop = lengths[index - 1] - lengths[index];
    if (drop > 0) score += Math.pow(drop / maxLength, 2) * 300;
  }
  for (let index = peakIndex + 1; index < lineCount; index++) {
    const rise = lengths[index] - lengths[index - 1];
    if (rise > 0) score += Math.pow(rise / maxLength, 2) * 300;
  }

  // The peak reads best at the vertical center of the block: a peak sitting
  // right next to an edge tilts the whole silhouette
  const centerIndex = (lineCount - 1) / 2;
  if (centerIndex > 0) {
    const peakOffset = Math.abs(peakIndex - centerIndex) / centerIndex;
    score += peakOffset * peakOffset * 60;
  }

  // Neighbouring lines must keep close widths for a smooth outline
  for (let index = 1; index < lengths.length; index++) {
    const difference = Math.abs(lengths[index] - lengths[index - 1]) / maxLength;
    const excess = Math.max(0, difference - adjacentSlack);
    score += excess * excess * smoothnessWeight;
    score += Math.max(0, difference - 0.38) * 280;
    // Jumps between two short neighbouring lines barely move the global
    // ratio but read just as badly: also measure against the longer of the
    // two so ragged tails of tiny words get caught
    const localStep = Math.abs(lengths[index] - lengths[index - 1]) / Math.max(lengths[index], lengths[index - 1], 1);
    const localExcess = Math.max(0, localStep - 0.45);
    score += localExcess * localExcess * 700;
  }

  // First and last lines may differ, but a lopsided pair reads badly
  const edgeDifference = Math.abs(lengths[0] - lengths[lineCount - 1]) / maxLength;
  score += Math.pow(Math.max(0, edgeDifference - 0.22), 2) * 240;

  if (minRatio < minLineRatio) {
    score += Math.pow(minLineRatio - minRatio, 2) * 260;
  }
  return score;
};

const scoreCandidate = (lines, hyphenCount, profile) => {
  const lengths = lines.map((line) => lineLength(line));
  const lineCount = lines.length;
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const shapeRows = profile.shapeRows && profile.shapeRows.length ? profile.shapeRows : null;
  let targets;
  if (shapeRows) {
    // Targets follow the bubble outline at each line's real rendered height
    // (pixel-calibrated when available) instead of a generic curve
    const rowWeights = lengths.map((_, index) => {
      if (profile.fit) {
        return Math.max(0.12, getFitAvailableUnits(index, lineCount, profile.fit));
      }
      return Math.max(0.12, getProfileWidthAt(shapeRows, (index + 0.5) / lineCount) || 0);
    });
    const rowTotal = rowWeights.reduce((sum, weight) => sum + weight, 0) || 1;
    targets = rowWeights.map((weight) => (totalLength * weight) / rowTotal);
  } else {
    const weights = buildWeights(lineCount, profile.scoreCurve || 0.65, 0, profile.minWeight);
    const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    targets = weights.map((weight) => (totalLength * weight) / weightTotal);
  }
  const maxLength = Math.max.apply(null, lengths);
  const minLength = Math.min.apply(null, lengths);

  const maxLineWidth = profile.maxLineWidth || 28;
  const lineTargetWeight = profile.lineTargetWeight == null ? 16 : profile.lineTargetWeight;
  // Falling short of the target (fewer, longer lines) hurts more than adding
  // a line: manga bubbles read best as compact multi-line stacks, and long
  // 1-2 line blocks are exactly what escapes bubble outlines
  const lineDelta = lineCount - profile.lineTarget;
  const lineDeltaFactor = lineDelta < 0 ? 3 : 1;
  let score = hyphenCount * 34 + Math.pow(Math.abs(lineDelta), 1.5) * lineTargetWeight * lineDeltaFactor;

  const fit = profile.fit;
  if (fit) {
    // Absolute fit check in real pixels: text escaping the bubble outline
    // must lose to any candidate that stays inside, whatever its aesthetics
    const heightExcess = Math.max(0, (lineCount * fit.linePx) / (fit.height * FIT_MARGIN) - 1);
    if (heightExcess > 0) score += 80 + heightExcess * heightExcess * 900;
    lengths.forEach((length, index) => {
      const available = getFitAvailableUnits(index, lineCount, fit);
      if (available <= 0) {
        score += 120;
        return;
      }
      const excess = Math.max(0, length / available - 1);
      if (excess > 0) score += 60 + excess * excess * 1600;
    });
  }
  lengths.forEach((length, index) => {
    const target = targets[index] || 1;
    const relative = (length - target) / target;
    score += relative * relative * 120;
    // Overlong lines break out of the bubble: penalize width past the profile cap
    const widthExcess = Math.max(0, length - maxLineWidth) / maxLineWidth;
    score += widthExcess * widthExcess * 320;
    if (length <= 1) score += 30;
    if (lineCount > 3 && visibleLength(lineText(lines[index])) <= 4) score += 8;
    if (/^[.,;:!?]+$/.test(serializeLines([lines[index]]))) score += 40;
    if (index < lineCount - 1 && endsWithBreakPunctuation(lineText(lines[index]))) {
      score -= profile.punctuationBreakBonus || 0;
    }
  });

  if (shapeRows && maxLength > 0 && lineCount > 1) {
    // With a real outline each width step should match the outline's step...
    const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;
    for (let index = 1; index < lengths.length; index++) {
      const stepError = ((lengths[index] - lengths[index - 1]) - (targets[index] - targets[index - 1])) / maxLength;
      score += stepError * stepError * smoothnessWeight;
    }
    // ...but outline following alone lets a noisy wand scan produce lopsided
    // blocks: the shared silhouette aesthetics still apply so the result
    // stays harmonious (peak centered, short edges, no abrupt width jumps).
    // The min-line floor is relaxed a little: a genuinely narrow bubble tip
    // legitimately asks for a shorter edge line than the generic silhouette.
    score += scoreSilhouetteAesthetics(lengths, {
      adjacentSlack: profile.adjacentSlack,
      smoothnessWeight: profile.smoothnessWeight,
      minLineRatio: (profile.minLineRatio == null ? 0.34 : profile.minLineRatio) * 0.85,
    });
    return score;
  }

  score += scoreSilhouetteAesthetics(lengths, profile);
  return score;
};

const makeBaseTokens = (words) => words.map((word) => ({ text: word }));

const sumTokenRange = (tokens, from, to) => {
  let width = 0;
  for (let index = from; index < to; index++) {
    if (index > from) width += 0.45;
    width += tokenLength(tokens[index]);
  }
  return width;
};

const getManualShapeWeight = (position, shape, softness, floor) => {
  const normalized = Math.abs(position);
  let weight = 1;
  if (shape === "diamond") {
    weight = 1 - normalized;
  } else if (shape === "ellipse") {
    weight = Math.sqrt(Math.max(0, 1 - normalized * normalized));
  } else {
    weight = Math.cos(Math.PI * normalized / 2);
  }
  return Math.max(floor, Math.pow(Math.max(0, weight), softness));
};

const normalizeShapeRows = (shapeProfile) => {
  const rows = Array.isArray(shapeProfile?.rows) ? shapeProfile.rows : [];
  return rows
    .map((row) => ({
      y: clamp(Number(row.y), 0, 1),
      left: clamp(Number(row.left), 0, 1),
      right: clamp(Number(row.right), 0, 1),
      width: clamp(Number(row.width), 0, 1),
    }))
    .filter((row) => Number.isFinite(row.y) && Number.isFinite(row.width))
    .sort((a, b) => a.y - b.y);
};

const getProfileWidthAt = (rows, y) => {
  if (!rows.length) return null;
  if (y <= rows[0].y) return rows[0].width;
  const last = rows[rows.length - 1];
  if (y >= last.y) return last.width;
  for (let index = 1; index < rows.length; index++) {
    const next = rows[index];
    if (y > next.y) continue;
    const prev = rows[index - 1];
    const span = next.y - prev.y || 1;
    const ratio = (y - prev.y) / span;
    return prev.width + (next.width - prev.width) * ratio;
  }
  return last.width;
};

// Fraction of the bubble kept as breathing room between text and outline
const FIT_MARGIN = 0.9;

// Vertical position (0..1 of bubble height) of a line's center when the
// whole block sits vertically centered in the bubble
const getFitLineY = (index, lineCount, fit) => (
  0.5 + (index + 0.5 - lineCount / 2) * (fit.linePx / fit.height)
);

// Fraction of a line's leading actually covered by its glyphs: the band the
// outline must accommodate around the line's center
const FIT_GLYPH_BAND = 0.8;

// Width (in measure units) actually available inside the bubble outline over
// the vertical band this line renders in. Sampling only the band center
// overestimates what a convex outline offers to the top and bottom lines
// (their far edge sits on a narrower part of the curve) — exactly where text
// used to escape the bubble: keep the minimum across the band instead.
const getFitAvailableUnits = (index, lineCount, fit) => {
  if (!fit.rows) return (fit.width * FIT_MARGIN) / fit.unitPx;
  const yCenter = getFitLineY(index, lineCount, fit);
  const halfBand = (fit.linePx / fit.height) * (FIT_GLYPH_BAND / 2);
  let rowWidth = Infinity;
  [yCenter - halfBand, yCenter, yCenter + halfBand].forEach((y) => {
    const width = getProfileWidthAt(fit.rows, clamp(y, 0, 1));
    if (width != null && width < rowWidth) rowWidth = width;
  });
  if (!Number.isFinite(rowWidth)) rowWidth = 0;
  return (fit.width * Math.max(0, rowWidth) * FIT_MARGIN) / fit.unitPx;
};

// True when every line of a variant physically stays inside the bubble
// outline (small tolerance for measurement noise)
const variantFitsBubble = (lines, fit) => {
  const lineCount = lines.length;
  if (lineCount * fit.linePx > fit.height * FIT_MARGIN * 1.02) return false;
  return lines.every((line, index) => (
    visibleWidth(line) <= getFitAvailableUnits(index, lineCount, fit) * 1.02
  ));
};

// Lines packed at 100% of their row capacity overflow on the slightest
// measurement error: the estimated line count must leave headroom
const FIT_CAPACITY_SLACK = 1.12;

// Blocks read best when slightly taller than the bubble's own proportions:
// extra lines shorten every line, keeping the outline clear of the text
const FIT_ASPECT_LEAN = 1.15;

// Line count whose text block best echoes the bubble's proportions, among
// the counts that physically hold the whole text. Picking the smallest
// fitting count (the old rule) packs the text into 1-2 lines that run the
// full bubble width and clip the outline on any measurement error; matching
// the bubble aspect yields the compact multi-line stack a round bubble asks
// for, with the peak line well inside the outline.
const estimateFitLineCount = (totalUnits, fit) => {
  const maxByHeight = Math.max(1, Math.floor((fit.height * FIT_MARGIN) / fit.linePx));
  const limit = Math.min(8, maxByHeight);
  const bubbleAspect = fit.height / Math.max(1, fit.width);
  let best = 0;
  let bestCost = Infinity;
  let tightest = 0;
  for (let lineCount = 1; lineCount <= limit; lineCount++) {
    let capacity = 0;
    let widest = 0;
    for (let index = 0; index < lineCount; index++) {
      const units = getFitAvailableUnits(index, lineCount, fit);
      capacity += units;
      if (units > widest) widest = units;
    }
    if (capacity < totalUnits) continue;
    if (!tightest) tightest = lineCount;
    const fill = totalUnits / capacity;
    // Widest line the shaped block would render at this count, in pixels
    const widestLinePx = Math.max(1, widest * fill * fit.unitPx);
    const blockAspect = (lineCount * fit.linePx) / widestLinePx;
    let cost = Math.abs(Math.log(blockAspect / (bubbleAspect * FIT_ASPECT_LEAN)));
    // Rows packed close to capacity overflow on the slightest mismeasure
    const headroomExcess = Math.max(0, fill * FIT_CAPACITY_SLACK - 1);
    cost += headroomExcess * 6;
    if (cost < bestCost) {
      bestCost = cost;
      best = lineCount;
    }
  }
  return best || tightest || limit;
};

const buildManualTargets = (tokens, lineCount, settings) => {
  const shape = settings.shape || "sine";
  const softness = settings.softness || 0.6;
  const floor = settings.floor == null ? 0.15 : settings.floor;
  const profileRows = normalizeShapeRows(settings.shapeProfile);
  const weights = Array.from({ length: lineCount }, (_, index) => {
    const y = lineCount <= 1 ? 0.5 : (index + 0.5) / lineCount;
    if (shape === "selection" && profileRows.length) {
      return Math.max(floor, getProfileWidthAt(profileRows, y) || 0);
    }
    const position = 2 * y - 1;
    return getManualShapeWeight(position, shape, softness, floor);
  });
  const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount) * 0.45;
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const peak = total / weightTotal;
  return weights.map((weight) => Math.max(1, weight * peak));
};

const splitTokensForManualTargets = (tokens, targets, settings) => {
  const lineCount = targets.length;
  const tokenCount = tokens.length;
  if (!tokenCount || lineCount < 1 || tokenCount < lineCount) return null;

  const punctuationBonus = settings.punctuationBonus == null ? 0.04 : settings.punctuationBonus;
  const edgeMin = settings.edgeMin || 0;
  const edgeMinPenalty = settings.edgeMinPenalty == null ? 1.8 : settings.edgeMinPenalty;
  const { prefix, charPrefix, endsBreak, punctCount } = getTokenMetrics(tokens);
  const dp = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(Infinity));
  const prev = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(-1));
  dp[0][0] = 0;

  // Prefix sums keep every line cost O(1); this DP runs on every manual
  // slider tick so re-joining and re-measuring strings here froze the drag
  const lineCost = (lineIndex, from, to, target, width) => {
    const ratio = (width - target) / target;
    let cost = ratio * ratio;
    if (lineIndex < lineCount - 1 && endsBreak[to - 1]) {
      cost = Math.max(0, cost - punctuationBonus);
    }
    if ((lineIndex === 0 || lineIndex === lineCount - 1) && edgeMin > 0 && charPrefix[to] - charPrefix[from] + (to - from - 1) < edgeMin) {
      cost += edgeMinPenalty;
    }
    if (punctCount[to] - punctCount[from] === to - from) cost += 3;
    return cost;
  };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    const target = targets[lineIndex] || 1;
    const pruneWidth = target * (1 + DP_WIDTH_PRUNE_RATIO);
    for (let from = lineIndex; from <= tokenCount; from++) {
      if (!Number.isFinite(dp[lineIndex][from])) continue;
      const remainingLines = lineCount - lineIndex - 1;
      const maxTo = tokenCount - remainingLines;
      for (let to = from + 1; to <= maxTo; to++) {
        const width = prefix[to] - prefix[from] + 0.45 * (to - from - 1);
        if (width > pruneWidth && to > from + 1) break;
        const nextCost = dp[lineIndex][from] + lineCost(lineIndex, from, to, target, width);
        if (nextCost < dp[lineIndex + 1][to]) {
          dp[lineIndex + 1][to] = nextCost;
          prev[lineIndex + 1][to] = from;
        }
      }
    }
  }

  if (!Number.isFinite(dp[lineCount][tokenCount])) return null;

  const ranges = [];
  let cursor = tokenCount;
  for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
    const from = prev[lineIndex][cursor];
    if (from < 0) return null;
    ranges.unshift([from, cursor]);
    cursor = from;
  }
  return {
    ranges,
    cost: dp[lineCount][tokenCount],
  };
};

const estimateManualLineCount = (text, width = 320, height = 280) => {
  const normalized = normalizeText(text);
  if (!normalized) return 1;
  const wordCount = mergePunctuationWords(splitWordsPreservingMarkdown(normalized)).length;
  if (wordCount <= 2) return 1;
  const aspect = clamp((height || 1) / Math.max(1, width || 1), 0.35, 2.4);
  const maxLines = Math.min(8, Math.max(1, wordCount));
  // Lean toward one more line than the square split: compact multi-line
  // stacks track a bubble outline better than fewer, longer lines
  return clamp(Math.round(Math.sqrt(wordCount * aspect * 1.5)), 2, maxLines);
};

let nextTokenSetId = 1;
const getTokenSetId = (tokens) => {
  if (!tokens.__id) tokens.__id = nextTokenSetId++;
  return tokens.__id;
};

const addCandidate = (resultMap, seenTargets, tokens, lineCount, curve, shift, bias, hyphenCount, profile, targetsOverride, minWeightOverride) => {
  if (!tokens.length || tokens.length < lineCount) return;
  const targets = targetsOverride || buildTargets(tokens, lineCount, curve, shift, bias, minWeightOverride == null ? profile.minWeight : minWeightOverride);
  // Many curve/shift/bias combos collapse to (near) identical line targets
  // once clamped: dedupe BEFORE the DP runs, not after, at ~quarter-char
  // resolution — the split is insensitive to smaller target changes
  let signature = getTokenSetId(tokens) + ":" + lineCount;
  for (let index = 0; index < targets.length; index++) {
    signature += "," + Math.round(targets[index] * 4);
  }
  if (seenTargets.has(signature)) return;
  seenTargets.add(signature);
  const lines = buildCandidate(tokens, lineCount, targets);
  if (!lines) return;
  const text = serializeLines(lines);
  if (!text || resultMap.has(text)) return;
  resultMap.set(text, {
    id: `shape-${resultMap.size + 1}`,
    text,
    lines: text.split("\n"),
    score: scoreCandidate(lines, hyphenCount, profile),
    hyphenCount,
  });
};

const generateHyphenTokenSets = (words, baseTokens) => {
  const sets = [];
  words.forEach((word, wordIndex) => {
    getHyphenSplits(word).forEach((split) => {
      const tokens = [];
      words.forEach((currentWord, index) => {
        if (index !== wordIndex) {
          // Reuse the base token objects so their cached measured widths are
          // shared across every hyphen set instead of re-measured
          tokens.push(baseTokens[index]);
          return;
        }
        tokens.push({ text: split.prefix, forceBreakAfter: true });
        tokens.push({ text: split.suffix });
      });
      sets.push(tokens);
    });
  });
  return sets;
};

// Same text + same options come back often (hover refreshes, panel
// re-mounts, page switches): cache the last few results so those are free
const VARIANT_CACHE_LIMIT = 16;
const variantCache = new Map();

const getVariantCacheKey = (text, options) => JSON.stringify([
  // The toggle changes normalization, so cached entries must not cross it
  dehyphenationEnabled,
  text,
  options.profile || null,
  options.limit || null,
  options.maxLines || null,
  options.allowHyphenation !== false,
  options.width || null,
  options.height || null,
  options.shapeProfile?.rows || null,
  // Quantized so sub-pixel calibration jitter doesn't defeat the cache
  options.calibration
    ? [Math.round(options.calibration.unitPx * 50), Math.round(options.calibration.linePx * 5)]
    : null,
]);

const generateTextShapeRVariants = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const cacheKey = getVariantCacheKey(normalized, options);
  const cached = variantCache.get(cacheKey);
  if (cached) return cached;

  const profile = PROFILE_PRESETS[options.profile] || PROFILE_PRESETS.balanced;
  const words = mergePunctuationWords(splitWordsPreservingMarkdown(normalized));
  const totalUnits = visibleWidth(normalized);
  const widestWordUnits = words.reduce((max, word) => Math.max(max, visibleWidth(word)), 1);
  // Hard readability cap on line count: the widest word sets the block peak,
  // and past this count some line is forced down to a lone tiny word beside
  // it — the ragged staircases no scoring tweak can save. Hyphen token sets
  // compute their own cap because splitting the widest word raises it.
  const granularityMaxLines = clamp(Math.floor(totalUnits / (widestWordUnits * 0.72)), 1, 8);
  const resultMap = new Map();
  const seenTargets = new Set();
  const shapeRows = normalizeShapeRows(options.shapeProfile).filter((row) => row.width > 0);
  // Pixel calibration measured on the live layer (rendered px per measure
  // unit, rendered px per line): turns relative shape scoring into a real
  // "does this line physically fit the bubble" constraint
  const calibration = options.calibration;
  const fit = calibration && calibration.unitPx > 0 && calibration.linePx > 0
      && options.width > 0 && options.height > 0
    ? {
      unitPx: calibration.unitPx,
      linePx: calibration.linePx,
      width: options.width,
      height: options.height,
      rows: shapeRows.length > 1 ? shapeRows : null,
    }
    : null;
  const aspect = options.width > 0 && options.height > 0
    ? clamp(options.height / options.width, 0.25, 3)
    : null;
  const isTallBubble = aspect != null && aspect >= 1.15;
  const isWideBubble = aspect != null && aspect <= 0.85;
  // Tall bubbles want narrower lines, wide ones can afford longer lines
  const aspectStretch = aspect == null ? 1 : clamp(Math.sqrt(aspect), 0.7, 1.45);
  let scoringProfile = profile;
  let shapeTargetSettings = null;
  if (aspect == null && shapeRows.length <= 1) {
    // No bubble info at all: the preset's fixed line target over-shoots
    // short texts and under-shoots long ones — adapt it to the text volume
    // (average line width grows with the line count, roughly sqrt-shaped)
    const volumeTarget = Math.round(Math.sqrt(totalUnits / 2.6));
    scoringProfile = {
      ...profile,
      lineTarget: clamp(volumeTarget, Math.min(profile.minLines, granularityMaxLines), Math.min(profile.maxLines, Math.max(granularityMaxLines, 1))),
    };
  }
  if (aspect != null && shapeRows.length <= 1) {
    // Aspect known but no usable outline: still lean the scoring toward it
    scoringProfile = {
      ...profile,
      lineTarget: clamp(Math.round(profile.lineTarget * aspectStretch), 1, Math.max(1, Math.min(8, granularityMaxLines))),
      maxLineWidth: clamp((profile.maxLineWidth || 28) / aspectStretch, 12, 40),
      lineTargetWeight: 12,
    };
  }
  if (shapeRows.length > 1) {
    // A live Photoshop selection outlines the bubble: bias the line count to
    // the bubble's aspect ratio and score candidates against its silhouette.
    // With pixel calibration the estimate becomes exact: the smallest line
    // count whose rows physically hold the text.
    const estimatedLines = fit
      ? estimateFitLineCount(totalUnits, fit)
      : estimateManualLineCount(normalized, options.width || 320, options.height || 280);
    scoringProfile = {
      ...profile,
      shapeRows,
      lineTarget: clamp(estimatedLines, 1, Math.max(profile.maxLines, estimatedLines)),
      // Soft enough that shapes one line taller/shorter still reach the list
      lineTargetWeight: 24,
      maxLineWidth: clamp((profile.maxLineWidth || 28) / aspectStretch, 12, 40),
    };
    shapeTargetSettings = {
      shape: "selection",
      shapeProfile: options.shapeProfile,
      softness: 1,
      floor: 0.14,
    };
  }
  if (fit) {
    // Cap line width by what the widest part of the bubble physically holds
    const widestRow = fit.rows
      ? fit.rows.reduce((max, row) => Math.max(max, row.width), 0)
      : 1;
    const absoluteMax = (fit.width * widestRow * FIT_MARGIN) / fit.unitPx;
    scoringProfile = {
      ...scoringProfile,
      fit,
      maxLineWidth: clamp(Math.min(scoringProfile.maxLineWidth || 28, absoluteMax), 6, 60),
    };
  }
  const baseMinLines = words.length <= 2 ? 1 : profile.minLines;
  let minLines = Math.min(Math.max(1, baseMinLines), Math.max(1, words.length));
  if (shapeRows.length > 1 && fit) {
    // The calibrated estimate knows how much text the bubble really holds:
    // allow shorter blocks than the preset minimum when the bubble asks
    minLines = Math.min(minLines, Math.max(1, scoringProfile.lineTarget));
  }
  const profileMaxLines = shapeRows.length > 1 ? Math.max(profile.maxLines, Math.min(8, scoringProfile.lineTarget + 1)) : profile.maxLines;
  let maxLines = Math.min(options.maxLines || profileMaxLines, Math.max(1, words.length));
  // Stretch the explored line range toward the bubble ratio so a tall bubble
  // also gets taller suggestions and a wide bubble also gets shorter ones
  if (isTallBubble) {
    maxLines = Math.min(Math.max(1, words.length), Math.min(8, maxLines + (aspect >= 1.6 ? 2 : 1)));
  }
  if (isWideBubble) {
    minLines = Math.max(1, minLines - 1);
  }
  // The granularity cap always wins over profile and bubble stretching, but
  // never pushes the range below the minimum line count
  maxLines = Math.max(minLines, Math.min(maxLines, granularityMaxLines));
  // Always generate with the requested profile; when the bubble ratio leans
  // tall or wide, also generate with that preset's params for extra variety
  const generationParams = [profile];
  if (isTallBubble && profile !== PROFILE_PRESETS.tall) generationParams.push(PROFILE_PRESETS.tall);
  if (isWideBubble && profile !== PROFILE_PRESETS.wide) generationParams.push(PROFILE_PRESETS.wide);
  const baseTokens = makeBaseTokens(words);

  const addShapeCandidates = (tokens, lineCount, hyphenCount) => {
    if (!shapeTargetSettings) return;
    let targets;
    if (fit) {
      // Aim the DP straight at the width the bubble physically offers at each
      // line's rendered height, scaled down to the amount of text: the block
      // then mirrors the outline instead of a generic curve capped afterwards
      const available = [];
      for (let index = 0; index < lineCount; index++) {
        available.push(Math.max(1, getFitAvailableUnits(index, lineCount, fit)));
      }
      const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount) * 0.45;
      const availableTotal = available.reduce((sum, units) => sum + units, 0) || 1;
      const scale = Math.min(1, total / availableTotal);
      targets = available.map((units) => Math.max(1, units * scale));
    } else {
      targets = buildManualTargets(tokens, lineCount, shapeTargetSettings);
    }
    [-1, 0, 1].forEach((bias) => {
      const biasedTargets = bias === 0 ? targets : targets.map((target) => Math.max(1, target + bias));
      addCandidate(resultMap, seenTargets, tokens, lineCount, 0, 0, 0, hyphenCount, scoringProfile, biasedTargets);
    });
  };

  for (let lineCount = minLines; lineCount <= maxLines; lineCount++) {
    generationParams.forEach((params) => {
      params.curves.forEach((curve) => {
        params.shifts.forEach((shift) => {
          params.biases.forEach((bias) => addCandidate(resultMap, seenTargets, baseTokens, lineCount, curve, shift, bias, 0, scoringProfile, null, params.minWeight));
        });
      });
    });
    addShapeCandidates(baseTokens, lineCount, 0);
  }

  if (options.allowHyphenation !== false) {
    generateHyphenTokenSets(words, baseTokens).forEach((tokens) => {
      // Hyphen sets hold more tokens than words: cap by the profile range,
      // not by the word-count-capped maxLines (a single long word must still
      // be allowed to split onto two lines). Their granularity cap is
      // recomputed on the set because the split word is narrower.
      const setWidestUnits = tokens.reduce((max, token) => Math.max(max, tokenLength(token)), 1);
      const setGranularityMaxLines = clamp(Math.floor(totalUnits / (setWidestUnits * 0.72)), 2, 8);
      const hyphenMaxLines = Math.min(
        options.maxLines || Math.max(profileMaxLines, maxLines),
        Math.max(1, tokens.length),
        setGranularityMaxLines
      );
      for (let lineCount = Math.max(2, minLines); lineCount <= hyphenMaxLines; lineCount++) {
        generationParams.forEach((params) => {
          // Hyphen variants carry a heavy score penalty and rarely win: a
          // reduced curve/shift grid keeps the good ones at a third of the
          // DP runs the full grid would burn
          const hyphenCurves = params.curves.length > 2 ? [params.curves[0], params.curves[2]] : params.curves;
          const hyphenShifts = params.shifts.slice(0, 3);
          hyphenCurves.forEach((curve) => {
            hyphenShifts.forEach((shift) => addCandidate(resultMap, seenTargets, tokens, lineCount, curve, shift, 0, 1, scoringProfile, null, params.minWeight));
          });
        });
        addShapeCandidates(tokens, lineCount, 1);
      }
    });
  }

  const limit = options.limit || MAX_VARIANTS;
  let variants = Array.from(resultMap.values());
  // A variant that physically stays inside the bubble must always outrank
  // one that escapes it, whatever their aesthetic scores say
  if (fit) {
    variants.forEach((variant) => {
      variant.fits = variantFitsBubble(variant.lines, fit);
    });
    // Escaping the bubble is disqualifying, not just penalizing: overflowing
    // variants never reach the list while at least two alternatives fit
    const fitting = variants.filter((variant) => variant.fits);
    if (fitting.length >= 2) variants = fitting;
  }
  // Absolute quality gate: drop unbearable silhouettes whenever anything
  // better exists, then keep only clean ones when enough of them survive —
  // a shorter list of good shapes beats a full list padded with ugly ones
  const widthCap = (scoringProfile.maxLineWidth || 28) * 1.05;
  variants.forEach((variant) => {
    variant.badness = getSilhouetteBadness(variant.lines.map(visibleWidth), widthCap);
  });
  const bearable = variants.filter((variant) => variant.badness <= BEARABLE_SILHOUETTE_BADNESS);
  if (bearable.length) variants = bearable;
  const clean = variants.filter((variant) => variant.badness <= CLEAN_SILHOUETTE_BADNESS);
  if (clean.length >= Math.min(3, limit)) variants = clean;
  const compareVariants = (a, b) => {
    if (fit && a.fits !== b.fits) return a.fits ? -1 : 1;
    return a.score - b.score || a.text.localeCompare(b.text);
  };
  const sorted = variants.sort(compareVariants);

  // Guarantee line-count diversity: the best candidate of each line count is
  // kept first so taller and shorter alternatives always reach the list,
  // then the remaining slots are filled by raw score
  const picked = [];
  const pickedTexts = new Set();
  const seenLineCounts = new Set();
  sorted.forEach((variant) => {
    if (picked.length >= limit) return;
    const count = variant.lines.length;
    if (seenLineCounts.has(count)) return;
    // Diversity must never resurrect a shape that escapes the bubble: those
    // only reach the list through the score-ordered fill below, i.e. last
    if (fit && !variant.fits) return;
    seenLineCounts.add(count);
    picked.push(variant);
    pickedTexts.add(variant.text);
  });
  sorted.forEach((variant) => {
    if (picked.length >= limit || pickedTexts.has(variant.text)) return;
    picked.push(variant);
    pickedTexts.add(variant.text);
  });

  const result = picked
    .sort(compareVariants)
    .map((variant, index) => ({ ...variant, id: `shape-${index + 1}` }));

  if (variantCache.size >= VARIANT_CACHE_LIMIT) {
    variantCache.delete(variantCache.keys().next().value);
  }
  variantCache.set(cacheKey, result);
  return result;
};

const generateManualTextShapeRVariant = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const words = mergePunctuationWords(splitWordsPreservingMarkdown(normalized));
  if (!words.length) return null;
  const tokens = makeBaseTokens(words);
  const maxLines = Math.min(options.maxLines || 8, tokens.length);
  const requestedLineCount = options.lineCount || estimateManualLineCount(normalized, options.width, options.height);
  const lineCount = clamp(requestedLineCount, 1, Math.max(1, maxLines));
  const settings = {
    shape: options.shape || "sine",
    softness: options.softness == null ? 0.6 : options.softness,
    floor: options.floor == null ? 0.15 : options.floor,
    punctuationBonus: options.punctuationBonus == null ? 0.04 : options.punctuationBonus,
    edgeMin: options.edgeMin == null ? 3 : options.edgeMin,
    shapeProfile: options.shapeProfile || null,
  };
  const targets = buildManualTargets(tokens, lineCount, settings);
  const split = splitTokensForManualTargets(tokens, targets, settings);
  if (!split) {
    return {
      id: "manual",
      text: normalized,
      lines: [normalized],
      targets: [visibleWidth(normalized)],
      widths: [visibleWidth(normalized)],
      lineCount: 1,
      shape: settings.shape,
      shapeProfile: settings.shapeProfile,
      width: options.width,
      height: options.height,
    };
  }

  const lines = split.ranges.map(([from, to]) => lineText(tokens.slice(from, to)));
  return {
    id: "manual",
    text: lines.join("\n"),
    lines,
    targets,
    widths: split.ranges.map(([from, to]) => sumTokenRange(tokens, from, to)),
    lineCount,
    shape: settings.shape,
    shapeProfile: settings.shapeProfile,
    width: options.width,
    height: options.height,
    score: split.cost,
  };
};

export { generateTextShapeRVariants, generateManualTextShapeRVariant, estimateManualLineCount, setDehyphenationEnabled, visibleLength, visibleWidth };
