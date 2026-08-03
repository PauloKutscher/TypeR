const createSeededRandom = (seed) => {
  let state = (Number(seed) >>> 0) || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
};

// A seeded shuffle keeps the order stable across React renders. The operation
// is entirely local: clicking Random never needs another catalogue request.
const shuffleFamilies = (families, seed) => {
  const shuffled = (families || []).slice();
  const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const value = shuffled[index];
    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = value;
  }
  return shuffled;
};

export { shuffleFamilies };
