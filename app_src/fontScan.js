// FontScanR aggregation logic. Pure functions, no CEP dependency, unit-testable.
// Input: results of host scanPsdFonts() calls, one per .psd file:
//   {file, layers: [{layerName, antiAlias, typeUnit, paragraphStyle, stroke, runs: [textStyle]}]}
// Output: font groups keyed by font variant (real or synthetic bold/italic kept
// separate), each carrying the most-used size and a ready-to-save style payload.

const roundSize = (value) => {
  const size = parseFloat(value);
  if (!isFinite(size)) return 0;
  return Math.round(size * 100) / 100;
};

const colorSignature = (color) => {
  if (!color) return "none";
  const r = color.red != null ? color.red : color.r;
  const g = color.green != null ? color.green : color.g;
  const b = color.blue != null ? color.blue : color.b;
  return [Math.round(r || 0), Math.round(g || 0), Math.round(b || 0)].join(",");
};

const strokeSignature = (stroke) => {
  if (!stroke || !stroke.enabled || !(stroke.size > 0)) return "none";
  return [
    Math.round(stroke.size * 10) / 10,
    Math.round(stroke.opacity != null ? stroke.opacity : 100),
    colorSignature(stroke.color),
  ].join("|");
};

// Bold/italic variants stay separate: the PostScript name already encodes real
// variants (e.g. CCWildWords-BoldItalic), synthetic flags cover faux ones
const getFontGroupKey = (textStyle) => {
  const font = textStyle.fontPostScriptName || textStyle.fontName || "";
  return [font, textStyle.syntheticBold ? 1 : 0, textStyle.syntheticItalic ? 1 : 0].join("|");
};

const getVariantSignature = (textStyle, layer) => {
  return [
    roundSize(textStyle.size),
    layer.typeUnit || "pixelsUnit",
    layer.antiAlias || "antiAliasSmooth",
    colorSignature(textStyle.color),
    strokeSignature(layer.stroke),
  ].join("~");
};

const defaultParagraphStyle = () => ({
  burasagari: "burasagariNone",
  singleWordJustification: "justifyAll",
  justificationMethodType: "justifMethodAutomatic",
  textEveryLineComposer: false,
  alignment: "center",
  hangingRoman: true,
  hyphenate: true,
});

const normalizeParagraphStyle = (paragraphStyle) => {
  const normalized = Object.assign(defaultParagraphStyle(), paragraphStyle || {});
  normalized.burasagari = normalized.burasagari || "burasagariNone";
  normalized.singleWordJustification = normalized.singleWordJustification || "justifyAll";
  normalized.justificationMethodType = normalized.justificationMethodType || "justifMethodAutomatic";
  normalized.textEveryLineComposer = !!normalized.textEveryLineComposer;
  return normalized;
};

const normalizeStroke = (stroke) => {
  if (!stroke || !stroke.enabled || !(stroke.size > 0)) {
    return { enabled: false, size: 0, opacity: 100, position: "outer", color: { r: 255, g: 255, b: 255 } };
  }
  return {
    enabled: true,
    size: Math.round(stroke.size * 100) / 100,
    opacity: Math.round(stroke.opacity != null ? stroke.opacity : 100),
    position: "outer",
    color: {
      r: Math.round(stroke.color && stroke.color.r != null ? stroke.color.r : 255),
      g: Math.round(stroke.color && stroke.color.g != null ? stroke.color.g : 255),
      b: Math.round(stroke.color && stroke.color.b != null ? stroke.color.b : 255),
    },
  };
};

// Properties copied from a live layer that make no sense in a reusable style
const cleanTextStyle = (textStyle) => {
  const cleaned = Object.assign({}, textStyle);
  delete cleaned.from;
  delete cleaned.to;
  return cleaned;
};

const getGroupDisplayName = (group) => {
  let name = group.fontName || group.fontPostScriptName || "Unknown";
  const styleName = group.fontStyleName || "";
  if (styleName && styleName.toLowerCase() !== "regular" && name.toLowerCase().indexOf(styleName.toLowerCase()) === -1) {
    name += " " + styleName;
  }
  if (group.syntheticBold) name += " (faux bold)";
  if (group.syntheticItalic) name += " (faux italic)";
  return name;
};

// Build aggregated font groups from per-file scan results.
// Identical runs inside one layer count once (Photoshop often splits a single
// visual style into several ranges), so counts reflect layer usage.
const buildFontGroups = (fileResults) => {
  const groups = new Map();
  let order = 0;

  (fileResults || []).forEach((fileResult) => {
    if (!fileResult || !Array.isArray(fileResult.layers)) return;
    fileResult.layers.forEach((layer) => {
      if (!layer || !Array.isArray(layer.runs)) return;
      const seenInLayer = new Set();
      layer.runs.forEach((textStyle) => {
        if (!textStyle || (!textStyle.fontPostScriptName && !textStyle.fontName)) return;
        const key = getFontGroupKey(textStyle);
        const variantSig = getVariantSignature(textStyle, layer);
        const layerSig = key + "::" + variantSig;
        if (seenInLayer.has(layerSig)) return;
        seenInLayer.add(layerSig);

        let group = groups.get(key);
        if (!group) {
          group = {
            key: key,
            order: order++,
            fontPostScriptName: textStyle.fontPostScriptName || "",
            fontName: textStyle.fontName || textStyle.fontPostScriptName || "",
            fontStyleName: textStyle.fontStyleName || "",
            syntheticBold: !!textStyle.syntheticBold,
            syntheticItalic: !!textStyle.syntheticItalic,
            usageCount: 0,
            files: new Set(),
            sizeCounts: new Map(),
            variants: new Map(),
          };
          groups.set(key, group);
        }
        group.usageCount++;
        group.files.add(fileResult.file || "");

        const size = roundSize(textStyle.size);
        group.sizeCounts.set(size, (group.sizeCounts.get(size) || 0) + 1);

        let variant = group.variants.get(variantSig);
        if (!variant) {
          variant = {
            count: 0,
            size: size,
            textStyle: textStyle,
            typeUnit: layer.typeUnit || "pixelsUnit",
            antiAlias: layer.antiAlias || "antiAliasSmooth",
            paragraphStyle: layer.paragraphStyle || null,
            stroke: layer.stroke || null,
          };
          group.variants.set(variantSig, variant);
        }
        variant.count++;
      });
    });
  });

  return Array.from(groups.values())
    .map((group) => {
      // Most-used size wins; ties resolved deterministically by smaller size
      const sizes = Array.from(group.sizeCounts.entries())
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => b.count - a.count || a.size - b.size);
      const topSize = sizes.length ? sizes[0].size : 0;

      // Representative variant: the most frequent one at the winning size
      let representative = null;
      group.variants.forEach((variant) => {
        if (variant.size !== topSize) return;
        if (!representative || variant.count > representative.count) representative = variant;
      });
      if (!representative) {
        group.variants.forEach((variant) => {
          if (!representative || variant.count > representative.count) representative = variant;
        });
      }

      const textStyle = cleanTextStyle(representative.textStyle);
      textStyle.size = topSize;
      textStyle.impliedFontSize = topSize;

      return {
        key: group.key,
        order: group.order,
        fontPostScriptName: group.fontPostScriptName,
        fontName: group.fontName,
        fontStyleName: group.fontStyleName,
        syntheticBold: group.syntheticBold,
        syntheticItalic: group.syntheticItalic,
        usageCount: group.usageCount,
        fileCount: group.files.size,
        sizes: sizes,
        topSize: topSize,
        antiAlias: representative.antiAlias,
        defaultName: getGroupDisplayName(group),
        textProps: {
          layerText: {
            textGridding: "none",
            orientation: "horizontal",
            antiAlias: representative.antiAlias,
            textStyleRange: [{ from: 0, to: 100, textStyle: textStyle }],
            paragraphStyleRange: [{ from: 0, to: 100, paragraphStyle: normalizeParagraphStyle(representative.paragraphStyle) }],
          },
          typeUnit: representative.typeUnit,
        },
        stroke: normalizeStroke(representative.stroke),
      };
    })
    .sort((a, b) => b.usageCount - a.usageCount || a.order - b.order);
};

export { buildFontGroups, getFontGroupKey, getGroupDisplayName, roundSize };
