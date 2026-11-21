import { contains } from "./geometry";
import { DEFAULT_STYLE_STROKE } from "../styleStroke";

// Measure well inside the selection: a stray balloon outline at its edge
// should not turn a light interior into a mixed background.
export const STROKE_SAMPLE_INSET = 0.18;

const toneFromCounts = (light, dark, detail, total) => {
  if (total < 24) return "unknown";
  if (light / total >= 0.85) return detail / total >= 0.025 ? "mixed" : "light";
  if (dark / total >= 0.85) return "dark";
  return "mixed";
};

const pixelTone = (rgb) => {
  if (!rgb || ![rgb.red, rgb.green, rgb.blue].every(value => Number.isFinite(value) && value >= 0 && value <= 255)) return null;
  if (Math.min(rgb.red, rgb.green, rgb.blue) >= 192) return "light";
  if (Math.max(rgb.red, rgb.green, rgb.blue) <= 64) return "dark";
  return "mixed";
};

const histogramTone = (hist) => {
  if (!hist || (hist.length !== 1 && hist.length !== 3)) return "unknown";
  const tones = hist.map(channel => {
    let light = 0, dark = 0, detail = 0, total = 0;
    for (let i = 0; i < 256; i++) {
      const count = channel[i] || 0;
      total += count;
      if (i >= 192) light += count;
      else if (i <= 64) dark += count;
      else if (i < 160) detail += count;
    }
    return toneFromCounts(light, dark, detail, total);
  });
  if (tones.includes("unknown")) return "unknown";
  return tones.every(tone => tone === tones[0]) ? tones[0] : "mixed";
};

export const strokeBackground = (input, plan) => {
  // Cleanup has already chosen a solid fill for the text's final background.
  if (plan.autoClean) return pixelTone(plan.fillRGB) || "unknown";
  if (typeof input.sample === "function") {
    const b = plan.selection;
    const span = 1 - 2 * STROKE_SAMPLE_INSET;
    const grid = 48;
    let light = 0, dark = 0, detail = 0, total = 0;
    for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
      const point = [b.left + b.width * (STROKE_SAMPLE_INSET + (x + 0.5) * span / grid), b.top + b.height * (STROKE_SAMPLE_INSET + (y + 0.5) * span / grid)];
      if (!contains(plan.cleanPolygon, { x: point[0], y: point[1] })) continue;
      let pixel;
      try { pixel = input.sample(point); } catch (outside) { continue; }
      const tone = pixelTone(pixel);
      if (!tone) continue;
      total++;
      if (tone === "light") light++;
      else if (tone === "dark") dark++;
      else if (0.213 * pixel.red + 0.715 * pixel.green + 0.072 * pixel.blue < 160) detail++;
    }
    const tone = toneFromCounts(light, dark, detail, total);
    if (tone !== "unknown") return tone;
  }
  const interior = histogramTone(input.strokeHistograms);
  if (interior !== "unknown") return interior;
  const whole = histogramTone(input.histograms);
  if (whole !== "unknown") return whole;
  return pixelTone(input.fill?.rgb || (input.openPlan && plan.fillRGB)) || "unknown";
};

export const applySmartStroke = (style, input, plan) => {
  if (style.stroke && style.stroke.smart === false) return { style, plan };
  const tone = strokeBackground(input, plan);
  const configured = style.stroke && style.stroke.enabled !== false && style.stroke.size > 0;
  const manuallyDisabled = style.stroke?.enabled === false && style.stroke.size > 0;
  const invertOnDark = tone === "dark" && configured && style.stroke.invertOnDark !== false;
  let appliedStyle = style;
  if (tone === "dark") {
    appliedStyle = { ...style, stroke: invertOnDark ? { ...style.stroke, color: { r: 0, g: 0, b: 0 } } : null };
  } else if (tone === "light" && style.stroke?.preserveOnLight !== true) {
    appliedStyle = { ...style, stroke: null };
  } else if (tone === "mixed" && !configured && !manuallyDisabled) {
    appliedStyle = { ...style, stroke: { ...DEFAULT_STYLE_STROKE } };
  }
  return {
    style: appliedStyle,
    plan: { ...plan, preserveRecoloredStroke: !!invertOnDark,
      textColor: tone === "dark" ? { red: 255, green: 255, blue: 255 } : tone === "light" || tone === "mixed" ? null : plan.textColor },
  };
};
