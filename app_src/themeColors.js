// Color helpers shared by the custom theme editor and the theme manager.
// Custom themes only store a handful of key colors; every remaining variable
// of the editor palette is derived from them so a user-made theme stays
// consistent with the built-in presets without exposing 20 color pickers.

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const clamp01 = (value) => clamp(Number.isFinite(value) ? value : 0, 0, 1);

const parseColor = (value) => {
  if (!value) return null;
  if (typeof value === "object" && value.r !== undefined) {
    return { r: clamp(value.r, 0, 255), g: clamp(value.g, 0, 255), b: clamp(value.b, 0, 255), a: value.a === undefined ? 1 : clamp01(value.a) };
  }
  const raw = String(value).trim();
  const hexMatch = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3 || hex.length === 4) {
      hex = hex.split("").map((char) => char + char).join("");
    }
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
    };
  }
  const rgbMatch = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch) {
    const parts = rgbMatch[1].split(",").map((part) => parseFloat(part));
    if (parts.length >= 3 && parts.slice(0, 3).every((part) => Number.isFinite(part))) {
      return {
        r: clamp(parts[0], 0, 255),
        g: clamp(parts[1], 0, 255),
        b: clamp(parts[2], 0, 255),
        a: parts.length > 3 && Number.isFinite(parts[3]) ? clamp01(parts[3]) : 1,
      };
    }
  }
  return null;
};

const isValidColor = (value) => parseColor(value) !== null;

const toHex = (color) => {
  const rgb = parseColor(color);
  if (!rgb) return "#000000";
  const part = (value) => ("0" + Math.round(clamp(value, 0, 255)).toString(16)).slice(-2);
  return "#" + part(rgb.r) + part(rgb.g) + part(rgb.b);
};

const withAlpha = (color, alpha) => {
  const rgb = parseColor(color);
  if (!rgb) return "rgba(0, 0, 0, " + clamp01(alpha) + ")";
  return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${Math.round(clamp01(alpha) * 1000) / 1000})`;
};

// t = 0 keeps `from`, t = 1 returns `to`
const mixColors = (from, to, t) => {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return toHex(a || b || "#000000");
  const ratio = clamp01(t);
  return toHex({
    r: a.r + (b.r - a.r) * ratio,
    g: a.g + (b.g - a.g) * ratio,
    b: a.b + (b.b - a.b) * ratio,
  });
};

// Positive amount lightens toward white, negative darkens toward black
const shade = (color, amount) => {
  if (!amount) return toHex(color);
  return amount > 0 ? mixColors(color, "#ffffff", amount) : mixColors(color, "#000000", -amount);
};

const luminance = (color) => {
  const rgb = parseColor(color);
  if (!rgb) return 0;
  const channel = (value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
};

const isLightColor = (color) => luminance(color) > 0.45;

// Black or white, whichever reads better on the given background
const contrastText = (color) => (isLightColor(color) ? "#151515" : "#ffffff");

// Key colors a custom theme actually stores. Everything else in the palette is
// computed from these, so the editor stays short and the result stays coherent.
const CUSTOM_THEME_KEYS = [
  { id: "surface", label: "settingsThemeColorSurface", fallback: "Background" },
  { id: "panel", label: "settingsThemeColorPanel", fallback: "Panels" },
  { id: "text", label: "settingsThemeColorText", fallback: "Text" },
  { id: "accent", label: "settingsThemeColorAccent", fallback: "Accent" },
  { id: "codeBg", label: "settingsThemeColorCodeBg", fallback: "Script background" },
  { id: "codeCurrent", label: "settingsThemeColorCodeCurrent", fallback: "Current line" },
  { id: "codePage", label: "settingsThemeColorCodePage", fallback: "Page line" },
];

const CUSTOM_THEME_KEY_IDS = CUSTOM_THEME_KEYS.map((key) => key.id);

const DEFAULT_CUSTOM_THEME_KEYS = {
  dark: {
    surface: "#1e1e22",
    panel: "#2b2b31",
    text: "#e2e2e6",
    accent: "#5b8def",
    codeBg: "#1b1b1f",
    codeCurrent: "#2f4a73",
    codePage: "#2d5a27",
  },
  light: {
    surface: "#ffffff",
    panel: "#ececed",
    text: "#1f1f1f",
    accent: "#2f6fd0",
    codeBg: "#ffffff",
    codeCurrent: "#cfe4fb",
    codePage: "#dcf1d1",
  },
};

// Pull the key colors out of any palette (built-in preset or custom theme)
const extractThemeKeys = (colors, mode) => {
  const defaults = DEFAULT_CUSTOM_THEME_KEYS[mode === "light" ? "light" : "dark"];
  const source = colors || {};
  const keys = {};
  CUSTOM_THEME_KEY_IDS.forEach((id) => {
    keys[id] = isValidColor(source[id]) ? toHex(source[id]) : defaults[id];
  });
  return keys;
};

// Full --editor-* palette from the seven key colors
const buildCustomPalette = (rawKeys, mode) => {
  const isDark = mode !== "light";
  const keys = extractThemeKeys(rawKeys, mode);
  const { surface, panel, text, accent, codeBg, codeCurrent, codePage } = keys;

  return {
    surface,
    surfaceAlt: mixColors(surface, panel, 0.45),
    panel,
    input: isDark ? shade(surface, -0.14) : shade(surface, 0.04),
    inputAlt: isDark ? shade(panel, 0.12) : shade(panel, 0.05),
    text,
    muted: mixColors(text, surface, 0.42),
    border: withAlpha(text, isDark ? 0.14 : 0.18),
    borderStrong: withAlpha(text, isDark ? 0.26 : 0.3),
    accent,
    accentHover: isLightColor(accent) ? shade(accent, -0.1) : shade(accent, 0.12),
    accentText: contrastText(accent),
    accentSoft: withAlpha(accent, 0.2),
    codeBg,
    codeGutter: mixColors(codeBg, panel, 0.55),
    codeText: text,
    codeMuted: mixColors(text, codeBg, 0.48),
    codeCurrent,
    codeCurrentText: contrastText(codeCurrent),
    codePage,
  };
};

export {
  clamp,
  clamp01,
  parseColor,
  isValidColor,
  toHex,
  withAlpha,
  mixColors,
  shade,
  luminance,
  isLightColor,
  contrastText,
  CUSTOM_THEME_KEYS,
  CUSTOM_THEME_KEY_IDS,
  DEFAULT_CUSTOM_THEME_KEYS,
  extractThemeKeys,
  buildCustomPalette,
};
