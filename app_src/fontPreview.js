const normalizeFontName = (value) => String(value || "").trim().toLowerCase();

const escapeCssString = (value) =>
  String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, " ");

const getTextStyleFontKey = (textStyle = {}) =>
  normalizeFontName(textStyle.fontPostScriptName || textStyle.fontName);

const findInstalledFont = (fonts, textStyle) => {
  const postScriptName = normalizeFontName(textStyle.fontPostScriptName);
  const fontName = normalizeFontName(textStyle.fontName);

  return (fonts || []).find((font) => {
    if (postScriptName && normalizeFontName(font.postScriptName) === postScriptName) return true;
    return fontName && (
      normalizeFontName(font.name) === fontName ||
      normalizeFontName(font.family) === fontName
    );
  });
};

const quoteFontFamily = (value) => `"${escapeCssString(value)}"`;

const createFontPreviewRegistry = (fonts, textStyles, revision = 0) => {
  const aliases = {};
  const rules = [];
  const seen = new Set();

  (textStyles || []).forEach((textStyle) => {
    const key = getTextStyleFontKey(textStyle);
    if (!key || seen.has(key)) return;
    seen.add(key);

    const installedFont = findInstalledFont(fonts, textStyle);
    if (!installedFont) return;

    const alias = `TypeRPreview_${revision}_${rules.length}`;
    const localNames = [
      installedFont.postScriptName,
      installedFont.name,
      installedFont.family,
      textStyle.fontPostScriptName,
      textStyle.fontName,
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
