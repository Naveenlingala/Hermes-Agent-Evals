import type { Interval } from '@shared';

export const pct = (v: number | null | undefined, d = 0) => (v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(d)}%`);
export const ms = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${Math.round(v)}ms`);
export const usd = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : v === 0 ? '$0' : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
export const tokens = (v: number | null | undefined) => (v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString());
export const signed = (v: number, f: (n: number) => string) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v))}`;
export const ci = (i: Interval | null, f: (n: number) => string) => (i ? `${f(i.low)} to ${f(i.high)}` : 'n/a');
export const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export type Tone = 'good' | 'bad' | 'neutral';
/** Is a (b − a) diff an improvement? Neutral when zero. */
export function diffTone(diff: number | null, higherIsBetter: boolean): Tone {
  if (diff === null || Math.abs(diff) < 1e-12) return 'neutral';
  return diff > 0 === higherIsBetter ? 'good' : 'bad';
}
