import { describe, expect, it } from 'vitest';
import { ci, diffTone, ms, pct, signed, usd } from './format';

describe('format', () => {
  it('formats missing values as an em dash, never 0', () => {
    expect(pct(null)).toBe('—'); expect(ms(NaN)).toBe('—'); expect(usd(undefined)).toBe('—');
  });
  it('formats units', () => {
    expect(pct(0.756, 1)).toBe('75.6%'); expect(ms(1500)).toBe('1.5s'); expect(ms(420)).toBe('420ms'); expect(usd(0.00123)).toBe('$0.0012');
  });
  it('signs diffs and reports unavailable intervals', () => {
    expect(signed(-0.2, (n) => pct(n))).toBe('−20%'); expect(ci(null, pct)).toBe('n/a');
  });
  it('judges direction by metric polarity', () => {
    expect(diffTone(-100, false)).toBe('good'); expect(diffTone(-0.1, true)).toBe('bad'); expect(diffTone(0, true)).toBe('neutral'); expect(diffTone(null, true)).toBe('neutral');
  });
});
