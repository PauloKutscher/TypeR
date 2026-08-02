const normalizeFontName = (value) => String(value || "").trim().toLowerCase();
const normalizeFontStyle = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/oblique/g, "italic")
    .replace(/roman/g, "regular")
    .replace(/[^a-z0-9]+/g, "");

const escapeCssString = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, " ");

const getTextStyleFontKey = (textStyle = {}) => {
  const fontName = normalizeFontName(textStyle.fontPostScriptName || textStyle.fontName);
  if (!fontName) return "";
  const fontStyle = normalizeFontStyle(textStyle.fontStyleName);
  return fontStyle ? `${fontName}|${fontStyle}` : fontName;
};

// A typesetter's Photoshop reports thousands of installed fonts. Normalizing
// all of them (4 regex-based passes per entry) on every lookup used to cost
// tens of milliseconds per style change, which is what made clicking +/- on a
// style size feel sluggish. Normalize each font list once, then reuse it.
const normalizedFontsCache = typeof WeakMap === "function" ? new WeakMap() : null;
const lookupCache = typeof WeakMap === "function" ? new WeakMap() : null;

const getNormalizedFonts = (fonts) => {
  const list = fonts || [];
  const cached = normalizedFontsCache && normalizedFontsCache.get(list);
  if (cached) return cached;
  const normalized = list.map((font) => ({
    font,
    postScriptName: normalizeFontName(font.postScriptName),
    name: normalizeFontName(font.name),
    family: normalizeFontName(font.family),
    style: normalizeFontStyle(font.style),
  }));
  if (normalizedFontsCache) normalizedFontsCache.set(list, normalized);
  return normalized;
};

const resolveInstalledFont = (fonts, postScriptName, fontName, fontStyle) => {
  const entries = getNormalizedFonts(fonts);
  let best;
  let bestScore = 0;
  // Single pass keeping the first best match: identical to the previous
  // rank-then-sort, since ties were already resolved by list order
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let score = 0;

    if (postScriptName && entry.postScriptName === postScriptName) {
      score = fontStyle && entry.style && entry.style !== fontStyle ? 70 : 100;
    }
    if (fontName && entry.name === fontName) score = Math.max(score, fontStyle && entry.style === fontStyle ? 90 : 60);
    if (fontName && entry.family === fontName) score = Math.max(score, fontStyle && entry.style === fontStyle ? 80 : 50);

    if (score > bestScore) {
      bestScore = score;
      best = entry.font;
      if (score === 100) break;
    }
  }
  return bestScore ? best : undefined;
};

const findInstalledFont = (fonts, textStyle) => {
  const postScriptName = normalizeFontName(textStyle.fontPostScriptName);
  const fontName = normalizeFontName(textStyle.fontName);
  const fontStyle = normalizeFontStyle(textStyle.fontStyleName);
  if (!postScriptName && !fontName) return undefined;

  const list = fonts || [];
  if (!lookupCache) return resolveInstalledFont(list, postScriptName, fontName, fontStyle);

  let cache = lookupCache.get(list);
  if (!cache) {
    cache = new Map();
    lookupCache.set(list, cache);
  }
  const cacheKey = `${postScriptName}|${fontName}|${fontStyle}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const resolved = resolveInstalledFont(list, postScriptName, fontName, fontStyle);
  cache.set(cacheKey, resolved);
  return resolved;
};

const quoteFontFamily = (value) => `"${escapeCssString(value)}"`;

const createFontPreviewRegistry = (fonts, textStyles, revision = 0, namespace = "") => {
  const aliases = {};
  const rules = [];
  const seen = new Set();
  const namespaceSuffix = String(namespace || "")
    .replace(/[^a-z0-9_-]+/gi, "_");

  (textStyles || []).forEach((textStyle) => {
    const key = getTextStyleFontKey(textStyle);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const installedFont = findInstalledFont(fonts, textStyle);
    if (!installedFont) return;

    const alias = `TypeRPreview${namespaceSuffix ? `_${namespaceSuffix}` : ""}_${revision}_${rules.length}`;
    const localNames = [
      installedFont.postScriptName,
      installedFont.name,
      installedFont.family && installedFont.style
        ? `${installedFont.family} ${installedFont.style}`
        : "",
      textStyle.fontPostScriptName,
      textStyle.fontName && textStyle.fontStyleName
        ? `${textStyle.fontName} ${textStyle.fontStyleName}`
        : "",
      textStyle.fontName,
      installedFont.family,
    ].filter((name, index, names) => name && names.indexOf(name) === index);

    aliases[key] = alias;
    rules.push(
      `@font-face{font-family:${quoteFontFamily(alias)};src:${localNames
        .map((name) => `local(${quoteFontFamily(name)})`)
        .join(",")};}`
    );
  });

  return {
    aliases,
    css: rules.join("\n"),
    revision,
  };
};

const getFontPreviewFamily = (textStyle = {}, registry = {}) => {
  const families = [];
  const alias = registry.aliases?.[getTextStyleFontKey(textStyle)];
  if (alias) families.push(alias);
  if (textStyle.fontName) families.push(textStyle.fontName);
  if (textStyle.fontPostScriptName) families.push(textStyle.fontPostScriptName);
  families.push("Tahoma");

  return families
    .filter((name, index) => name && families.indexOf(name) === index)
    .map(quoteFontFamily)
    .join(", ");
};

export {
  createFontPreviewRegistry,
  findInstalledFont,
  getFontPreviewFamily,
  getTextStyleFontKey,
};
