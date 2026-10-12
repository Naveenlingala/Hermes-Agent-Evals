import type { Interval } from '../domain/types';

export const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1));
  return s[idx];
}

/** Wilson score interval for a binomial proportion (95% by default). */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { low: 0, high: 1 };
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - m) / d), high: Math.min(1, (c + m) / d) };
}

/** Deterministic PRNG so intervals are reproducible. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Percentile bootstrap CI for the mean of paired per-task differences. */
export function bootstrapMeanCi(diffs: number[], iterations = 2000, seed = 1337, alpha = 0.05): Interval {
  const rnd = mulberry32(seed);
  const n = diffs.length;
  const means: number[] = [];
  for (let i = 0; i < iterations; i++) {
    let s = 0;
    for (let j = 0; j < n; j++) s += diffs[Math.floor(rnd() * n)];
    means.push(s / n);
  }
  means.sort((a, b) => a - b);
  return { low: means[Math.floor((alpha / 2) * iterations)], high: means[Math.min(iterations - 1, Math.ceil((1 - alpha / 2) * iterations) - 1)] };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
