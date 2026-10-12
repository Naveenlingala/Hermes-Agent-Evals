import { reactive } from 'vue';
import type { AgentConfig, Comparison, ConfigSummary, Experiment, MetricInfo, Overview, RunRecord, Task } from '@shared';

export class ApiError extends Error {
  constructor(message: string, public errors: string[] = [], public status = 0) { super(message); }
}

/** One API call as seen by the browser; `traceId` matches the backend's x-request-id. Newest first, capped. */
export interface ApiCall { n: number; method: string; path: string; startedAt: string; ms?: number; status?: number; traceId?: string; request?: string; response?: string; error?: string }
export const apiLog = reactive<ApiCall[]>([]);
let callN = 0;
const preview = (s: string, max = 800) => (s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s);

async function req<T>(path: string, init?: RequestInit, opts: { silent?: boolean } = {}): Promise<T> {
  const call: ApiCall | null = opts.silent ? null : reactive({ n: ++callN, method: init?.method ?? 'GET', path: `/api${path}`, startedAt: new Date().toISOString(), request: typeof init?.body === 'string' ? preview(init.body) : undefined });
  if (call) { apiLog.unshift(call); if (apiLog.length > 200) apiLog.pop(); }
  const t0 = performance.now();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json' } });
  } catch {
    if (call) { call.ms = Math.round(performance.now() - t0); call.error = 'Network error: backend unreachable'; }
    throw new ApiError('Cannot reach the backend. Is it running?');
  }
  const text = await res.text();
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* non-JSON body */ }
  if (call) { call.ms = Math.round(performance.now() - t0); call.status = res.status; call.traceId = res.headers.get('x-request-id') ?? undefined; call.response = preview(text); if (!res.ok) call.error = body?.message ?? `HTTP ${res.status}`; }
  if (!res.ok) throw new ApiError(body?.message ?? `Request failed (${res.status})`, body?.errors ?? [], res.status);
  return body as T;
}

export type SlimRun = Omit<RunRecord, 'result' | 'grades' | 'taskSnapshot' | 'configSnapshot'> & { latencyMs: number; tokens: number; error?: string };
export interface Evaluators {
  deterministic: { type: string; dimension: string; description: string }[]; deterministicVersion: string;
  metrics: MetricInfo[];
  judge: { mode: 'mock' | 'anthropic'; model: string; version: string; schema: string; note: string };
}
export interface Health { status: string; judge: { mode: 'mock' | 'anthropic'; model: string } }

export interface TraceEntry { seq: number; ts: string; kind: 'request' | 'event'; id?: string; name: string; status?: number; durationMs?: number; requestBody?: string; attrs?: Record<string, unknown> }

export interface CatalogItem { name: string; label?: string; group?: string; enabled: boolean }
export interface HermesCatalog { available: boolean; error?: string; fetchedAt: string; toolsets: CatalogItem[]; skills: CatalogItem[]; defaultModel?: string; defaultProvider?: string; usedModels: string[] }

export const api = {
  hermesCatalog: (refresh = false) => req<HermesCatalog>(`/hermes/catalog${refresh ? '?refresh=1' : ''}`),
  reset: () => req<{ deleted: number }>('/reset', { method: 'POST' }),
  /** Backend trace; silent so the viewer polling itself doesn't flood the client log. */
  trace: (since = 0) => req<TraceEntry[]>(`/debug/requests?since=${since}`, undefined, { silent: true }),
  health: () => req<Health>('/health'),
  overview: () => req<Overview>('/overview'),
  tasks: () => req<Task[]>('/tasks'),
  createTask: (b: unknown) => req<Task>('/tasks', { method: 'POST', body: JSON.stringify(b) }),
  configs: () => req<AgentConfig[]>('/configs'),
  createConfig: (b: unknown) => req<AgentConfig>('/configs', { method: 'POST', body: JSON.stringify(b) }),
  experiments: () => req<Experiment[]>('/experiments'),
  createExperiment: (b: unknown) => req<Experiment>('/experiments', { method: 'POST', body: JSON.stringify(b) }),
  experiment: (id: string) => req<{ experiment: Experiment; summaries: ConfigSummary[]; runs: SlimRun[] }>(`/experiments/${id}`),
  comparison: (id: string, a: string, b: string) => req<Comparison>(`/experiments/${id}/comparison?a=${a}&b=${b}`),
  run: (id: string) => req<RunRecord>(`/runs/${id}`),
  evaluators: () => req<Evaluators>('/evaluators'),
};
