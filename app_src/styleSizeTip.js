const STYLE_SIZE_TIP_THRESHOLD = 5;
const STYLE_SIZE_TIP_IDLE_MS = 30 * 1000;

const normalizeStyleSizeTipCount = (value) => Math.min(
  STYLE_SIZE_TIP_THRESHOLD,
  Math.max(0, Math.floor(Number(value) || 0))
);

const recordStyleSizeChange = (tracking, now = Date.now()) => {
  const current = tracking && typeof tracking === "object" ? tracking : {};
  const timestamp = Number(now);
  const lastChangeAt = Number(current.lastChangeAt) || 0;
  const count = normalizeStyleSizeTipCount(current.count);
  const startsNewSession = !lastChangeAt || timestamp - lastChangeAt >= STYLE_SIZE_TIP_IDLE_MS;

  return {
    count: startsNewSession ? normalizeStyleSizeTipCount(count + 1) : count,
    lastChangeAt: Number.isFinite(timestamp) && timestamp > 0 ? timestamp : lastChangeAt,
  };
};

export {
  STYLE_SIZE_TIP_THRESHOLD,
  STYLE_SIZE_TIP_IDLE_MS,
  normalizeStyleSizeTipCount,
  recordStyleSizeChange,
};
