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
const fontIndexCache = typeof WeakMap === "function" ? new WeakMap() : null;
const lookupCache = typeof WeakMap === "function" ? new WeakMap() : null;

const appendIndexEntry = (index, key, entry) => {
  if (!key) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(entry);
};

const getFontIndex = (fonts) => {
  const list = fonts || [];
  const cached = fontIndexCache && fontIndexCache.get(list);
  if (cached) return cached;
  const index = {
    postScriptNames: new Map(),
    names: new Map(),
    families: new Map(),
  };
  list.forEach((font, position) => {
    const entry = {
      font,
      position,
      postScriptName: normalizeFontName(font.postScriptName),
      name: normalizeFontName(font.name),
      family: normalizeFontName(font.family),
      style: normalizeFontStyle(font.style),
    };
    appendIndexEntry(index.postScriptNames, entry.postScriptName, entry);
    appendIndexEntry(index.names, entry.name, entry);
    appendIndexEntry(index.families, entry.family, entry);
  });
  if (fontIndexCache) fontIndexCache.set(list, index);
  return index;
};

const resolveInstalledFont = (fonts, postScriptName, fontName, fontStyle) => {
  const index = getFontIndex(fonts);
  const candidatesByPosition = new Map();
  const collect = (entries) => {
    (entries || []).forEach((entry) => candidatesByPosition.set(entry.position, entry));
  };
  collect(index.postScriptNames.get(postScriptName));
  collect(index.names.get(fontName));
  collect(index.families.get(fontName));
  const entries = Array.from(candidatesByPosition.values()).sort((a, b) => a.position - b.position);
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

// Aliases used to be numbered by their position in the rule list, so the same
// font changed name whenever another font entered or left the registry - and a
// renamed family means the browser resolves that face from scratch while the
// whole <style> block is re-injected, forcing a full style recalculation of the
// panel. Measured in a running CEP panel: 16 of 16 style clicks renamed the
// active layer's alias, rewrote the sheet and re-fitted the TextShapeR cards.
//
// Now every font gets its alias once and the sheet only ever grows. The style
// list and the preview block share one table per installed-font list, so a font
// the style list registered at startup costs the preview nothing. A different
// font list (fonts installed mid-session) starts a fresh table, which is what
// re-resolves the faces after an install.
const registryStores = typeof WeakMap === "function" ? new WeakMap() : null;
// The styles referencing a library are far fewer than the library itself; this
// only guards against a pathological document adding faces without end.
const MAX_PREVIEW_FACES = 512;

const getRegistryStore = (fonts, revision) => {
  if (!registryStores) return null;
  const list = fonts || [];
  let byRevision = registryStores.get(list);
  if (!byRevision) {
    byRevision = new Map();
    registryStores.set(list, byRevision);
  }
  let store = byRevision.get(revision);
  if (!store) {
    store = { aliases: {}, rules: [], css: "" };
    byRevision.set(revision, store);
  }
  return store;
};

const buildFontFaceRule = (alias, textStyle, installedFont) => {
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

  return `@font-face{font-family:${quoteFontFamily(alias)};src:${localNames
    .map((name) => `local(${quoteFontFamily(name)})`)
    .join(",")};}`;
};

const createFontPreviewRegistry = (fonts, textStyles, revision = 0, namespace = "") => {
  const namespaceSuffix = String(namespace || "")
    .replace(/[^a-z0-9_-]+/gi, "_");
  const store = getRegistryStore(fonts, revision);
  // Without WeakMap, fall back to a per-call registry rather than leaking one
  // keyed by a font list that could then never be released
  const aliases = store ? store.aliases : {};
  const rules = store ? store.rules : [];
  let added = false;

  (textStyles || []).forEach((textStyle) => {
    const key = getTextStyleFontKey(textStyle);
    if (!key || aliases[key]) return;
    if (rules.length >= MAX_PREVIEW_FACES) return;

    const installedFont = findInstalledFont(fonts, textStyle);
    if (!installedFont) return;

    const alias = `TypeRPreview${namespaceSuffix ? `_${namespaceSuffix}` : ""}_${revision}_${rules.length}`;
    aliases[key] = alias;
    rules.push(buildFontFaceRule(alias, textStyle, installedFont));
    added = true;
  });

  if (store) {
    if (added) store.css = rules.join("\n");
    return { aliases: store.aliases, css: store.css, revision };
  }
  return { aliases, css: rules.join("\n"), revision };
};

// @font-face rule previewing one entry of the installed font list: local()
// matches the PostScript or full name, which pins the exact weight instead of
// letting the engine pick a face of the family.
const getInstalledFontFaceRule = (font, alias) => {
  if (!font || !alias) return "";
  const localNames = [
    font.postScriptName,
    font.name,
    font.family && font.style ? `${font.family} ${font.style}` : "",
  ].filter((name, index, names) => name && names.indexOf(name) === index);
  if (!localNames.length) return "";
  return `@font-face{font-family:${quoteFontFamily(alias)};src:${localNames
    .map((name) => `local(${quoteFontFamily(name)})`)
    .join(",")};}`;
};

const normalizeFontSearch = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

// Filters font picker options by every word of the query. Ranked: names
// starting with the query, then names with a word starting with it, then the
// rest; the list order is kept inside each group. "animeace" also finds
// "Anime Ace" since spaces and punctuation are ignored as a fallback.
const filterFontOptions = (options, query) => {
  const list = options || [];
  const normalizedQuery = normalizeFontSearch(query).trim();
  if (!normalizedQuery) return list;
  const tokens = normalizedQuery.split(/\s+/);
  const compactQuery = normalizedQuery.replace(/[^a-z0-9]+/g, "");
  const groups = [[], [], []];
  list.forEach((option) => {
    const label = normalizeFontSearch(option.label);
    const compactLabel = label.replace(/[^a-z0-9]+/g, "");
    const matches = tokens.every((token) => label.includes(token)) ||
      (compactQuery && compactLabel.includes(compactQuery));
    if (!matches) return;
    if (label.startsWith(normalizedQuery) || (compactQuery && compactLabel.startsWith(compactQuery))) groups[0].push(option);
    else if ((" " + label.replace(/[^a-z0-9]+/g, " ")).includes(" " + tokens[0])) groups[1].push(option);
    else groups[2].push(option);
  });
  return groups[0].concat(groups[1], groups[2]);
};

const REGULAR_STYLE_RANK = ["regular", "normal", "book", "roman", "medium", "plain", "text"];

// Face showing a family in the family list: its regular weight when there is
// one, else the first face Photoshop lists.
const pickFamilyPreviewFont = (familyFonts) => {
  const list = familyFonts || [];
  for (let i = 0; i < REGULAR_STYLE_RANK.length; i++) {
    const font = list.find((entry) => normalizeFontStyle(entry.style) === REGULAR_STYLE_RANK[i]);
    if (font) return font;
  }
  return list[0];
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
  filterFontOptions,
  findInstalledFont,
  getFontPreviewFamily,
  getInstalledFontFaceRule,
  getTextStyleFontKey,
  pickFamilyPreviewFont,
};
