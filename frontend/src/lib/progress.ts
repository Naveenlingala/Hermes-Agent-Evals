import type { ExperimentEvent, ExperimentLive } from '@shared';

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  const m = Math.floor(ms / 60_000), s = Math.round((ms % 60_000) / 1000);
  return s === 60 ? `${m + 1}m 0s` : `${m}m ${s}s`;
}

/** Estimated time left from the average time per finished run; null until at least one run finished or when done. */
export function eta(startedMs: number, nowMs: number, done: number, total: number): number | null {
  if (done < 1 || done >= total) return null;
  return ((nowMs - startedMs) / done) * (total - done);
}

export function perConfigProgress(runs: { configId: string }[], configIds: string[], perConfigTotal: number) {
  return configIds.map((configId) => {
    const done = runs.filter((r) => r.configId === configId).length;
    return { configId, done, total: perConfigTotal, pct: perConfigTotal ? Math.min(100, (done / perConfigTotal) * 100) : 0 };
  });
}

export const eventIcon = (level: ExperimentEvent['level']) => ({ ok: '✓', error: '✕', warn: '!', info: '•' })[level];

export const PHASES = [
  { key: 'agent', label: 'Agent run' }, { key: 'grading', label: 'Grading' }, { key: 'judging', label: 'Judge call' }, { key: 'saved', label: 'Saved' },
] as const;

/** done / active / todo for each of PHASES given the engine's current phase (none = between runs). */
export function phaseStates(phase: ExperimentLive['phase'] | undefined): ('done' | 'active' | 'todo')[] {
  const idx = phase === 'agent' ? 0 : phase === 'grading' ? 1 : phase === 'judging' ? 2 : -1;
  return PHASES.map((_, i) => (idx < 0 ? 'todo' : i < idx ? 'done' : i === idx ? 'active' : 'todo'));
}

export const hhmmss = (iso: string) => new Date(iso).toLocaleTimeString([], { hour12: false });
