"use client";

export type Tier = "mobile" | "standard" | "high";

/** One quality decision, taken once, read everywhere. No user-facing selector. */
export function detectTier(mobile: boolean): Tier {
  if (mobile) return "mobile";
  if (typeof navigator === "undefined") return "standard";
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  return cores >= 8 && memory >= 8 ? "high" : "standard";
}

export const TIERS = {
  mobile: { dpr: [1, 1.4] as [number, number], ao: false, bloom: true, grain: false, shadows: false, railSegments: 8, curveSteps: 420, multisampling: 0, particles: 26 },
  standard: { dpr: [1.1, 1.6] as [number, number], ao: true, bloom: true, grain: true, shadows: true, railSegments: 12, curveSteps: 900, multisampling: 0, particles: 48 },
  high: { dpr: [1.3, 2] as [number, number], ao: true, bloom: true, grain: true, shadows: true, railSegments: 18, curveSteps: 1400, multisampling: 0, particles: 70 },
} as const;
