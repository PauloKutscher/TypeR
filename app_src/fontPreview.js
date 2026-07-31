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

const findInstalledFont = (fonts, textStyle) => {
  const postScriptName = normalizeFontName(textStyle.fontPostScriptName);
  const fontName = normalizeFontName(textStyle.fontName);
  const fontStyle = normalizeFontStyle(textStyle.fontStyleName);

  const rankedFonts = (fonts || []).map((font, index) => {
    const installedPostScriptName = normalizeFontName(font.postScriptName);
    const installedName = normalizeFontName(font.name);
    const installedFamily = normalizeFontName(font.family);
    const installedStyle = normalizeFontStyle(font.style);
    let score = 0;

    if (postScriptName && installedPostScriptName === postScriptName) {
      score = fontStyle && installedStyle && installedStyle !== fontStyle ? 70 : 100;
    }
    if (fontName && installedName === fontName) score = Math.max(score, fontStyle && installedStyle === fontStyle ? 90 : 60);
    if (fontName && installedFamily === fontName) score = Math.max(score, fontStyle && installedStyle === fontStyle ? 80 : 50);

    return { font, index, score };
  });

  rankedFonts.sort((a, b) => b.score - a.score || a.index - b.index);
  return rankedFonts[0]?.score ? rankedFonts[0].font : undefined;
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
