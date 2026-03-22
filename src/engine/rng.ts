// rng.ts
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// pick n unique items from array, stable across same seed
export function pickN<T>(arr: readonly T[], n: number, seed = 12345): T[] {
  const rand = mulberry32(seed);
  const idxs = arr.map((_, i) => i);
  // Fisher–Yates using seeded rand
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs.slice(0, Math.min(n, arr.length)).map(i => arr[i]);
}
