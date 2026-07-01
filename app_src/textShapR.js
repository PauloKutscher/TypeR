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
    punctuationBreakBonus: 7,
  },
  round: {
    minLines: 3,
    maxLines: 5,
    lineTarget: 4,
    curves: [0.65, 0.8, 0.95],
    shifts: [0, -0.08, 0.08],
    biases: [-1, 0, 1],
    minWeight: 0.3,
    punctuationBreakBonus: 7,
  },
  tall: {
    minLines: 4,
    maxLines: 7,
    lineTarget: 5,
    curves: [0.3, 0.42, 0.55],
    shifts: [0, -0.1, 0.1],
    biases: [-1, 0],
    minWeight: 0.46,
    punctuationBreakBonus: 6,
  },
  wide: {
    minLines: 2,
    maxLines: 4,
    lineTarget: 3,
    curves: [0.22, 0.34, 0.46],
    shifts: [0, -0.08, 0.08],
    biases: [0, 1, 2],
    minWeight: 0.58,
    punctuationBreakBonus: 6,
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

const getHyphenSplits = (word) => {
  const { body, punctuation } = splitTrailingPunctuation(word);
  if (!body || body.length < 8) return [];
  if (hasMarkdownSyntax(body) || /[-'’]/.test(body)) return [];

  const positions = [];
  for (let index = 3; index <= body.length - 3; index++) {
    const before = body[index - 1];
    const after = body[index];
    const patternBonus = isVowel(before) && !isVowel(after) ? 0 : 3;
    const centerPenalty = Math.abs(index - body.length / 2);
    positions.push({
      index,
      penalty: patternBonus + centerPenalty,
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

const buildCandidate = (tokens, lineCount, curve, shift, bias, minWeight) => {
  if (!tokens.length || lineCount < 1) return null;
  const targets = buildTargets(tokens, lineCount, curve, shift, bias, minWeight);
  const lines = [];
  let cursor = 0;

  for (let lineIndex = 0; lineIndex < lineCount && cursor < tokens.length; lineIndex++) {
    const remainingLines = lineCount - lineIndex;
    const remainingTokens = tokens.length - cursor;
    if (remainingLines <= 1 || remainingTokens <= remainingLines) {
      const take = remainingLines <= 1 ? tokens.length - cursor : 1;
      lines.push(tokens.slice(cursor, cursor + take));
      cursor += take;
      continue;
    }

    const target = targets[lineIndex];
    const line = [];
    while (cursor < tokens.length) {
      const remainingAfterTake = tokens.length - cursor - 1;
      const needsForLater = remainingLines - 1;
      const nextToken = tokens[cursor];
      const currentLength = lineLength(line);
      const nextLength = lineLength(line.concat(nextToken));
      const currentEndsWithPunctuation = line.length > 0 && endsWithBreakPunctuation(lineText(line));
      const punctuationBreakIsGood =
        currentEndsWithPunctuation &&
        currentLength >= target * 0.62 &&
        nextLength > target * 0.78 &&
        remainingAfterTake >= needsForLater;
      const punctuationBreakKeepsShape = Math.abs(currentLength - target) <= Math.abs(nextLength - target) + 4;
      const shouldTake =
        line.length === 0 ||
        remainingAfterTake < needsForLater ||
        (
          !(punctuationBreakIsGood && punctuationBreakKeepsShape) &&
          (
            nextLength <= target ||
            Math.abs(nextLength - target) <= Math.abs(currentLength - target)
          )
        );

      if (!shouldTake && remainingAfterTake >= needsForLater) break;
      line.push(nextToken);
      cursor++;
      if (nextToken.forceBreakAfter) break;
      if (tokens.length - cursor <= needsForLater) break;
    }
    lines.push(line);
  }

  if (cursor < tokens.length) {
    lines[lines.length - 1] = lines[lines.length - 1].concat(tokens.slice(cursor));
  }

  const normalized = lines.filter((line) => line.length);
  if (normalized.length !== lineCount) return null;
  return normalized;
};

const scoreCandidate = (lines, hyphenCount, profile) => {
  const lengths = lines.map((line) => lineLength(line));
  const lineCount = lines.length;
  const weights = buildWeights(lineCount, profile.scoreCurve || 0.65, 0, profile.minWeight);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const targets = weights.map((weight) => (totalLength * weight) / weightTotal);
  const centerIndex = Math.floor((lineCount - 1) / 2);
  const maxLength = Math.max.apply(null, lengths);
  const centerLength = lengths[centerIndex] || 0;

  let score = hyphenCount * 18 + Math.abs(lineCount - profile.lineTarget) * 1.5;
  lengths.forEach((length, index) => {
    score += Math.pow(length - targets[index], 2);
    if (length <= 1) score += 30;
    if (/^[.,;:!?]+$/.test(serializeLines([lines[index]]))) score += 40;
    if (index < lineCount - 1 && endsWithBreakPunctuation(lineText(lines[index]))) {
      score -= profile.punctuationBreakBonus || 0;
    }
  });
  if (centerLength < maxLength) score += (maxLength - centerLength) * 5;
  if (lineCount > 2 && lengths[0] > centerLength * 0.95) score += 16;
  if (lineCount > 2 && lengths[lineCount - 1] > centerLength * 0.95) score += 16;
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
