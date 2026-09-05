/** Deterministic, render-safe pseudo-random. Same layout every mount, and no impure call during render. */
export function seeded(seed: number) {
  let state = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
