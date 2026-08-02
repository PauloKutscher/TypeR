const roundedDimension = (value) => Math.round(Number(value) || 0);

// Bubble detection is deliberately stable across translations. Moving a text
// layer does not change the bubble silhouette, and users can explicitly
// refresh after moving text to another bubble. Resizing still invalidates the
// cache because it changes TextShapeR's pixel calibration.
const getBubbleCacheKey = (layerId, bounds, fallbackKey) => {
  if (layerId == null) return `bubble:${fallbackKey}`;
  if (!bounds) return `bubble:${layerId}`;
  return `bubble:${layerId}:${roundedDimension(bounds.width)},${roundedDimension(bounds.height)}`;
};

const haveSameLayerSize = (first, second) =>
  !!first &&
  !!second &&
  roundedDimension(first.width) === roundedDimension(second.width) &&
  roundedDimension(first.height) === roundedDimension(second.height);

export { getBubbleCacheKey, haveSameLayerSize };
