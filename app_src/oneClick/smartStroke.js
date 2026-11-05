import { contains } from "./geometry";

// Independent of Auto clean's stricter thresholds: never widen what it may paint.
const toneFromCounts = (light, dark, total) => {
  if (total < 24) return "unknown";
  // Ignore sparse lettering and compression noise, not sizeable artwork regions.
  if (light / total >= 0.85) return "light";
  if (dark / total >= 0.85) return "dark";
  return "mixed";
};

const pixelTone = (rgb) => {
  if (!rgb || ![rgb.red, rgb.green, rgb.blue].every(value => Number.isFinite(value) && value >= 0 && value <= 255)) return null;
  if (Math.min(rgb.red, rgb.green, rgb.blue) >= 192) return "light";
  if (Math.max(rgb.red, rgb.green, rgb.blue) <= 64) return "dark";
  return "mixed";
};

export const strokeBackground = (input, plan) => {
  // Cleanup has already chosen a solid fill for the text's final background.
  if (plan.autoClean) return pixelTone(plan.fillRGB) || "unknown";
  if (typeof input.sample === "function") {
    const b = plan.selection;
    let light = 0, dark = 0, total = 0;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
      const point = [b.left + b.width * (0.08 + (x + 0.5) * 0.84 / 24), b.top + b.height * (0.08 + (y + 0.5) * 0.84 / 24)];
      if (!contains(plan.cleanPolygon, { x: point[0], y: point[1] })) continue;
      let tone;
      try { tone = pixelTone(input.sample(point)); } catch (outside) { continue; }
      if (!tone) continue;
      total++;
      if (tone === "light") light++;
      if (tone === "dark") dark++;
    }
    return toneFromCounts(light, dark, total);
  }
  // CEP supplies selection histograms rather than individual pixels.
  const hist = input.histograms;
  if (hist && (hist.length === 1 || hist.length === 3)) {
    const tones = hist.map(channel => {
      let light = 0, dark = 0, total = 0;
      for (let i = 0; i < 256; i++) {
        const count = channel[i] || 0;
        total += count;
        if (i >= 192) light += count;
        if (i <= 64) dark += count;
      }
      return toneFromCounts(light, dark, total);
    });
    return tones.every(tone => tone === "light") ? "light" : tones.every(tone => tone === "dark") ? "dark" : tones.includes("unknown") ? "unknown" : "mixed";
  }
  return input.fill ? pixelTone(input.fill.rgb) || "unknown" : "unknown";
};

export const applySmartStroke = (style, input, plan) => {
  if (style.stroke && style.stroke.smart === false) return { style, plan };
  const tone = strokeBackground(input, plan);
  const configured = style.stroke && style.stroke.enabled !== false && style.stroke.size > 0;
  return {
    style: tone === "dark" ? { ...style, stroke: null } : style,
    plan: { ...plan, textColor: tone === "dark" ? { red: 255, green: 255, blue: 255 } : tone === "light" || (tone === "mixed" && configured) ? null : plan.textColor },
  };
};
