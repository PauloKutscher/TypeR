const VOWELS = "aeiouyAEIOUY\u00e0\u00e2\u00e4\u00e9\u00e8\u00ea\u00eb\u00ee\u00ef\u00f4\u00f6\u00f9\u00fb\u00fc\u00c0\u00c2\u00c4\u00c9\u00c8\u00ca\u00cb\u00ce\u00cf\u00d4\u00d6\u00d9\u00db\u00dc";
const MAX_VARIANTS = 10;
const MARKDOWN_TOKENS = ["***", "**", "__", "*", "_"];

const normalizeText = (text) => String(text || "").replace(/\s+/g, " ").trim();

const stripMarkdownForMeasure = (text) => String(text || "")
  .replace(/\\([\\*_])/g, "$1")
  .replace(/[*_]/g, "");

const visibleLength = (text) => stripMarkdownForMeasure(text).length;

const tokenLength = (token) => visibleLength(token.text);

const lineLength = (tokens) => visibleLength(tokens.map((token) => token.text).join(" "));

const isVowel = (char) => VOWELS.indexOf(char) !== -1;

const hasMarkdownSyntax = (word) => /[*_\\]/.test(word);

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

const buildWeights = (lineCount, curve = 0.5, shift = 0) => {
  if (lineCount <= 1) return [1];
  const center = (lineCount - 1) / 2 + shift;
  const maxDistance = Math.max(center, lineCount - 1 - center) || 1;
  return Array.from({ length: lineCount }, (_, index) => {
    const distance = Math.abs(index - center) / maxDistance;
    return Math.max(0.35, 1 - distance * curve);
  });
};

const buildTargets = (tokens, lineCount, curve, shift, bias) => {
  const total = tokens.reduce((sum, token) => sum + tokenLength(token), 0) + Math.max(0, tokens.length - lineCount);
  const weights = buildWeights(lineCount, curve, shift);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  return weights.map((weight) => Math.max(1, (total * weight) / weightTotal + bias));
};

const serializeLines = (lines) => lines.map((line) => line.map((token) => token.text).join(" ").trim()).join("\n");

const buildCandidate = (tokens, lineCount, curve, shift, bias) => {
  if (!tokens.length || lineCount < 1) return null;
  const targets = buildTargets(tokens, lineCount, curve, shift, bias);
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
      const shouldTake =
        line.length === 0 ||
        remainingAfterTake < needsForLater ||
        nextLength <= target ||
        Math.abs(nextLength - target) <= Math.abs(currentLength - target);

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

const scoreCandidate = (lines, hyphenCount) => {
  const lengths = lines.map((line) => lineLength(line));
  const lineCount = lines.length;
  const weights = buildWeights(lineCount, 0.65, 0);
  const totalLength = lengths.reduce((sum, length) => sum + length, 0);
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const targets = weights.map((weight) => (totalLength * weight) / weightTotal);
  const centerIndex = Math.floor((lineCount - 1) / 2);
  const maxLength = Math.max.apply(null, lengths);
  const centerLength = lengths[centerIndex] || 0;

  let score = hyphenCount * 18 + Math.abs(lineCount - 4) * 1.5;
  lengths.forEach((length, index) => {
    score += Math.pow(length - targets[index], 2);
    if (length <= 1) score += 30;
    if (/^[.,;:!?]+$/.test(serializeLines([lines[index]]))) score += 40;
  });
  if (centerLength < maxLength) score += (maxLength - centerLength) * 5;
  if (lineCount > 2 && lengths[0] > centerLength * 0.95) score += 16;
  if (lineCount > 2 && lengths[lineCount - 1] > centerLength * 0.95) score += 16;
  return score;
};

const makeBaseTokens = (words) => words.map((word) => ({ text: word }));

const addCandidate = (resultMap, tokens, lineCount, curve, shift, bias, hyphenCount) => {
  const lines = buildCandidate(tokens, lineCount, curve, shift, bias);
  if (!lines) return;
  const text = serializeLines(lines);
  if (!text || resultMap.has(text)) return;
  resultMap.set(text, {
    id: `shape-${resultMap.size + 1}`,
    text,
    lines: text.split("\n"),
    score: scoreCandidate(lines, hyphenCount),
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

  const words = splitWordsPreservingMarkdown(normalized);
  const resultMap = new Map();
  const minLines = words.length <= 2 ? 1 : 2;
  const maxLines = Math.min(options.maxLines || 6, Math.max(1, words.length));
  const curves = [0.45, 0.6, 0.75];
  const shifts = [0, -0.12, 0.12];
  const biases = [-1, 0, 1];
  const baseTokens = makeBaseTokens(words);

  for (let lineCount = minLines; lineCount <= maxLines; lineCount++) {
    curves.forEach((curve) => {
      shifts.forEach((shift) => {
        biases.forEach((bias) => addCandidate(resultMap, baseTokens, lineCount, curve, shift, bias, 0));
      });
    });
  }

  if (options.allowHyphenation !== false) {
    generateHyphenTokenSets(words).forEach((tokens) => {
      const hyphenMaxLines = Math.min(options.maxLines || 6, Math.max(1, tokens.length));
      for (let lineCount = Math.max(2, minLines); lineCount <= hyphenMaxLines; lineCount++) {
        curves.forEach((curve) => {
          shifts.forEach((shift) => addCandidate(resultMap, tokens, lineCount, curve, shift, 0, 1));
        });
      }
    });
  }

  return Array.from(resultMap.values())
    .sort((a, b) => a.score - b.score || a.text.localeCompare(b.text))
    .slice(0, options.limit || MAX_VARIANTS)
    .map((variant, index) => ({ ...variant, id: `shape-${index + 1}` }));
};

export { generateTextShapRVariants, visibleLength };
