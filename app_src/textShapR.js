const VOWELS = "aeiouyAEIOUY\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc";
const MAX_VARIANTS = 10;
const MARKDOWN_TOKENS = ["***", "**", "__", "*", "_"];
const LINE_END_PUNCTUATION = /[.,;:!?…]$/;
const PROFILE_PRESETS = {
  balanced: {
    minLines: 2,
    maxLines: 6,
    lineTarget: 4,
    curves: [0.45, 0.6, 0.75],
    shifts: [0, -0.12, 0.12],
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
    curves: [0.65, 0.8, 0.95],
    shifts: [0, -0.08, 0.08],
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
    curves: [0.3, 0.42, 0.55],
    shifts: [0, -0.1, 0.1],
    biases: [-1, 0],
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
    curves: [0.22, 0.34, 0.46],
    shifts: [0, -0.08, 0.08],
    biases: [0, 1, 2],
    minWeight: 0.58,
    punctuationBreakBonus: 11,
    adjacentSlack: 0.2,
    smoothnessWeight: 220,
    minLineRatio: 0.5,
    scoreCurve: 0.4,
    maxLineWidth: 34,
  },
};

const normalizeText = (text) => String(text || "").replace(/\s+/g, " ").trim();
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

const tokenLength = (token) => visibleWidth(token.text);

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

const getSyllableSplitPenalty = (body, index) => {
  const left = body.slice(0, index);
  const right = body.slice(index);
  const prev2 = body[index - 2];
  const prev = body[index - 1];
  const current = body[index];
  const next = body[index + 1];

  if (!hasVowel(left) || !hasVowel(right)) return Infinity;
  if (isConsonant(prev) && isVowel(current)) return 16;
  if (isVowel(prev) && isConsonant(current) && isVowel(next)) return 0;
  if (isVowel(prev2) && isConsonant(prev) && isConsonant(current) && isVowel(next)) return 1.2;
  if (isVowel(prev) && isConsonant(current) && isConsonant(next)) return 2.4;
  if (isVowel(prev) && isConsonant(current)) return 3;
  if (isVowel(prev) && isVowel(current)) return 7;
  return 10;
};

const getHyphenSplits = (word) => {
  const { body, punctuation } = splitTrailingPunctuation(word);
  if (!body || body.length < 8) return [];
  if (hasMarkdownSyntax(body) || /[-'’]/.test(body)) return [];

  const positions = [];
  for (let index = 3; index <= body.length - 3; index++) {
    const syllablePenalty = getSyllableSplitPenalty(body, index);
    if (!Number.isFinite(syllablePenalty) || syllablePenalty >= 12) continue;
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

const rangeRespectsForcedBreaks = (tokens, from, to) => {
  for (let index = from; index < to; index++) {
    if (tokens[index].forceBreakAfter && index !== to - 1) return false;
  }
  return true;
};

const buildCandidate = (tokens, lineCount, curve, shift, bias, minWeight) => {
  if (!tokens.length || lineCount < 1) return null;
  if (tokens.length < lineCount) return null;
  const targets = buildTargets(tokens, lineCount, curve, shift, bias, minWeight);
  const tokenCount = tokens.length;
  const dp = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(Infinity));
  const prev = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(-1));
  dp[0][0] = 0;

  const lineCost = (lineIndex, from, to) => {
    if (!rangeRespectsForcedBreaks(tokens, from, to)) return Infinity;
    const line = tokens.slice(from, to);
    const target = targets[lineIndex] || 1;
    const width = lineLength(line);
    const ratio = (width - target) / target;
    let cost = ratio * ratio;
    if (lineIndex < lineCount - 1 && endsWithBreakPunctuation(lineText(line))) {
      cost = Math.max(0, cost - 0.09);
    }
    if (/^[.,;:!?…]+$/.test(serializeLines([line]))) cost += 3;
    return cost;
  };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    for (let from = lineIndex; from <= tokenCount; from++) {
      if (!Number.isFinite(dp[lineIndex][from])) continue;
      const remainingLines = lineCount - lineIndex - 1;
      const maxTo = tokenCount - remainingLines;
      for (let to = from + 1; to <= maxTo; to++) {
        const cost = lineCost(lineIndex, from, to);
        if (!Number.isFinite(cost)) continue;
        const nextCost = dp[lineIndex][from] + cost;
        if (nextCost < dp[lineIndex + 1][to]) {
          dp[lineIndex + 1][to] = nextCost;
          prev[lineIndex + 1][to] = from;
        }
      }
    }
  }

  if (!Number.isFinite(dp[lineCount][tokenCount])) return null;

  const lines = [];
  let cursor = tokenCount;
  for (let lineIndex = lineCount; lineIndex > 0; lineIndex--) {
    const from = prev[lineIndex][cursor];
    if (from < 0) return null;
    lines.unshift(tokens.slice(from, cursor));
    cursor = from;
  }
  return lines;
};

const scoreCandidate = (lines, hyphenCount, profile) => {
  const lengths = lines.map((line) => lineLength(line));
  const lineCount = lines.length;
  const weights = buildWeights(lineCount, profile.scoreCurve || 0.65, 0, profile.minWeight);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const targets = weights.map((weight) => (totalLength * weight) / weightTotal);
  const maxLength = Math.max.apply(null, lengths);
  const minLength = Math.min.apply(null, lengths);

  const maxLineWidth = profile.maxLineWidth || 28;
  let score = hyphenCount * 34 + Math.pow(Math.abs(lineCount - profile.lineTarget), 1.5) * 16;
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

  if (maxLength > 0 && lineCount === 2) {
    const adjacentSlack = profile.adjacentSlack == null ? 0.24 : profile.adjacentSlack;
    const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;
    const difference = Math.abs(lengths[0] - lengths[1]) / maxLength;
    const excess = Math.max(0, difference - adjacentSlack);
    score += excess * excess * smoothnessWeight;
  }

  if (maxLength > 0 && lineCount > 2) {
    const adjacentSlack = profile.adjacentSlack == null ? 0.3 : profile.adjacentSlack;
    const smoothnessWeight = profile.smoothnessWeight == null ? 160 : profile.smoothnessWeight;
    const minLineRatio = profile.minLineRatio == null ? 0.34 : profile.minLineRatio;
    const minRatio = minLength / maxLength;
    const interiorLengths = lengths.slice(1, lineCount - 1);
    const interiorMax = Math.max.apply(null, interiorLengths);

    // The widest line must sit in the middle of the shape, not on an edge
    const edgeMax = Math.max(lengths[0], lengths[lineCount - 1]);
    if (edgeMax > interiorMax) {
      score += Math.pow((edgeMax - interiorMax) / maxLength, 2) * 420 + 20;
    }

    // Edge lines should stay clearly below the interior peak (graded, not binary)
    if (interiorMax > 0) {
      [lengths[0], lengths[lineCount - 1]].forEach((edgeLength) => {
        const edgeExcess = Math.max(0, edgeLength / interiorMax - 0.9);
        score += edgeExcess * edgeExcess * 320;
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

    // Neighbouring lines must keep close widths for a smooth outline
    for (let index = 1; index < lengths.length; index++) {
      const difference = Math.abs(lengths[index] - lengths[index - 1]) / maxLength;
      const excess = Math.max(0, difference - adjacentSlack);
      score += excess * excess * smoothnessWeight;
      score += Math.max(0, difference - 0.45) * 160;
    }

    // First and last lines may differ, but a lopsided pair reads badly
    const edgeDifference = Math.abs(lengths[0] - lengths[lineCount - 1]) / maxLength;
    score += Math.pow(Math.max(0, edgeDifference - 0.22), 2) * 240;

    if (minRatio < minLineRatio) {
      score += Math.pow(minLineRatio - minRatio, 2) * 260;
    }
  }
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
  const dp = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(Infinity));
  const prev = Array.from({ length: lineCount + 1 }, () => Array(tokenCount + 1).fill(-1));
  dp[0][0] = 0;

  const lineCost = (lineIndex, from, to) => {
    const width = sumTokenRange(tokens, from, to);
    const target = targets[lineIndex] || 1;
    const ratio = (width - target) / target;
    let cost = ratio * ratio;
    const text = lineText(tokens.slice(from, to));
    if (lineIndex < lineCount - 1 && endsWithBreakPunctuation(text)) {
      cost = Math.max(0, cost - punctuationBonus);
    }
    if ((lineIndex === 0 || lineIndex === lineCount - 1) && edgeMin > 0 && visibleLength(text) < edgeMin) {
      cost += edgeMinPenalty;
    }
    if (/^[.,;:!?…]+$/.test(stripMarkdownForMeasure(text))) cost += 3;
    return cost;
  };

  for (let lineIndex = 0; lineIndex < lineCount; lineIndex++) {
    for (let from = lineIndex; from <= tokenCount; from++) {
      if (!Number.isFinite(dp[lineIndex][from])) continue;
      const remainingLines = lineCount - lineIndex - 1;
      const maxTo = tokenCount - remainingLines;
      for (let to = from + 1; to <= maxTo; to++) {
        const nextCost = dp[lineIndex][from] + lineCost(lineIndex, from, to);
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
  const wordCount = splitWordsPreservingMarkdown(normalized).length;
  if (wordCount <= 2) return 1;
  const aspect = clamp((height || 1) / Math.max(1, width || 1), 0.35, 2.4);
  const maxLines = Math.min(8, Math.max(1, wordCount));
  return clamp(Math.round(Math.sqrt(wordCount * aspect * 1.35)), 2, maxLines);
};

const addCandidate = (resultMap, tokens, lineCount, curve, shift, bias, hyphenCount, profile) => {
  const lines = buildCandidate(tokens, lineCount, curve, shift, bias, profile.minWeight);
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

const generateHyphenTokenSets = (words) => {
  const sets = [];
  words.forEach((word, wordIndex) => {
    getHyphenSplits(word).forEach((split) => {
      const tokens = [];
      words.forEach((currentWord, index) => {
        if (index !== wordIndex) {
          tokens.push({ text: currentWord });
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

const generateTextShapRVariants = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const profile = PROFILE_PRESETS[options.profile] || PROFILE_PRESETS.balanced;
  const words = splitWordsPreservingMarkdown(normalized);
  const resultMap = new Map();
  const baseMinLines = words.length <= 2 ? 1 : profile.minLines;
  const minLines = Math.min(Math.max(1, baseMinLines), Math.max(1, words.length));
  const maxLines = Math.min(options.maxLines || profile.maxLines, Math.max(1, words.length));
  const curves = profile.curves;
  const shifts = profile.shifts;
  const biases = profile.biases;
  const baseTokens = makeBaseTokens(words);

  for (let lineCount = minLines; lineCount <= maxLines; lineCount++) {
    curves.forEach((curve) => {
      shifts.forEach((shift) => {
        biases.forEach((bias) => addCandidate(resultMap, baseTokens, lineCount, curve, shift, bias, 0, profile));
      });
    });
  }

  if (options.allowHyphenation !== false) {
    generateHyphenTokenSets(words).forEach((tokens) => {
      const hyphenMaxLines = Math.min(options.maxLines || profile.maxLines, Math.max(1, tokens.length));
      for (let lineCount = Math.max(2, minLines); lineCount <= hyphenMaxLines; lineCount++) {
        curves.forEach((curve) => {
          shifts.forEach((shift) => addCandidate(resultMap, tokens, lineCount, curve, shift, 0, 1, profile));
        });
      }
    });
  }

  return Array.from(resultMap.values())
    .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text))
    .slice(0, options.limit || MAX_VARIANTS)
    .map((variant, index) => ({ ...variant, id: `shape-${index + 1}` }));
};

const generateManualTextShapRVariant = (text, options = {}) => {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const words = splitWordsPreservingMarkdown(normalized);
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

export { generateTextShapRVariants, generateManualTextShapRVariant, estimateManualLineCount, visibleLength, visibleWidth };
