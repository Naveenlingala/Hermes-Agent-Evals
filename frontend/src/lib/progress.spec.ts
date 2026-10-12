import { describe, expect, it } from 'vitest';
import { eta, eventIcon, formatDuration, perConfigProgress, phaseStates } from './progress';

describe('progress helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(420)).toBe('420ms'); expect(formatDuration(1500)).toBe('1.5s'); expect(formatDuration(12_400)).toBe('12s');
    expect(formatDuration(75_000)).toBe('1m 15s'); expect(formatDuration(119_700)).toBe('2m 0s'); expect(formatDuration(-1)).toBe('—'); expect(formatDuration(NaN)).toBe('—');
  });
  it('eta: unknown before the first finished run and after completion; otherwise average pace', () => {
    expect(eta(0, 5000, 0, 10)).toBeNull(); expect(eta(0, 5000, 10, 10)).toBeNull();
    expect(eta(0, 10_000, 5, 10)).toBe(10_000); expect(eta(1000, 4000, 1, 4)).toBe(9000);
  });
  it('per-configuration progress counts runs per config and caps at 100%', () => {
    const p = perConfigProgress([{ configId: 'a' }, { configId: 'a' }, { configId: 'b' }], ['a', 'b', 'c'], 4);
    expect(p.map((x) => [x.done, x.pct])).toEqual([[2, 50], [1, 25], [0, 0]]);
    expect(perConfigProgress([{ configId: 'a' }, { configId: 'a' }], ['a'], 1)[0].pct).toBe(100);
    expect(perConfigProgress([], ['a'], 0)[0].pct).toBe(0);
  });
  it('phase stepper: steps before the active phase are done, after are todo, none between runs', () => {
    expect(phaseStates('agent')).toEqual(['active', 'todo', 'todo', 'todo']);
    expect(phaseStates('grading')).toEqual(['done', 'active', 'todo', 'todo']);
    expect(phaseStates('judging')).toEqual(['done', 'done', 'active', 'todo']);
    expect(phaseStates(undefined)).toEqual(['todo', 'todo', 'todo', 'todo']);
  });
  it('event icons are symbols, not colour only', () => {
    expect([eventIcon('ok'), eventIcon('error'), eventIcon('warn'), eventIcon('info')]).toEqual(['✓', '✕', '!', '•']);
  });
});
