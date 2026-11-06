import { area } from "./geometry";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export const normalizeAutoSizeScale = (value) => {
  const num = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.round(clamp(num, 0.5, 1.5) * 100) / 100 : 0.85;
};

export const normalizeAutoSizeVariation = (value) => {
  const num = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(num) ? Math.round(clamp(num, 0, 1) * 100) / 100 : 0.12;
};

// Estimate once from already measured word advances; the existing solver proves fit.
export const recommendFontSize = ({ stylePx, minScale, polygon, width, height, advance, leading, referenceRatio, autoSizeVariation, autoSizeScale }) => {
  const min = Math.max(0.1, stylePx * minScale);
  const room = Math.min(area(polygon), width * height);
  const estimate = Math.sqrt(Math.max(1, room) * 0.30 / Math.max(1, advance * leading));
  let target = clamp(estimate, min, stylePx * 1.5);
  if (referenceRatio > 0) {
    const reference = stylePx * referenceRatio;
    const variation = normalizeAutoSizeVariation(autoSizeVariation);
    target = clamp(target, reference * (1 - variation), reference * (1 + variation));
  }
  return { max: clamp(target * normalizeAutoSizeScale(autoSizeScale), min, stylePx * 1.5), min };
};

// Session-only, bounded: no disk writes or document scans for page consistency.
const references = new Map();
export const autoSizePageKey = (documentId, pageKey) => documentId == null ? null : JSON.stringify([documentId, pageKey || ""]);
export const readAutoSizeReference = (key) => key ? references.get(key) || null : null;
export const rememberAutoSizeReference = (prepared) => {
  const reference = prepared && prepared.autoSizeReference;
  if (!reference || !reference.key || !(reference.ratio > 0) || references.has(reference.key)) return;
  references.set(reference.key, clamp(reference.ratio, 0.9, 1.35));
  if (references.size > 32) references.delete(references.keys().next().value);
};

export const clearAutoSizeReferences = () => references.clear();
