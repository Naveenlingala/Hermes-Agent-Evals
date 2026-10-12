import { Injectable, Logger } from '@nestjs/common';

export interface TraceEntry {
  seq: number; ts: string; kind: 'request' | 'event';
  /** request: correlation id echoed in the x-request-id header; event: id of the owning request/experiment when known */
  id?: string; name: string; method?: string; path?: string; status?: number; durationMs?: number;
  requestBody?: string; attrs?: Record<string, unknown>;
}

const SECRET = /key|token|secret|password|authorization/i;
export const redact = (v: unknown, max = 600): string | undefined => {
  if (v === undefined || (typeof v === 'object' && v !== null && !Object.keys(v).length)) return undefined;
  const s = JSON.stringify(v, (k, x) => (SECRET.test(k) ? '[redacted]' : x)) ?? '';
  return s.length > max ? `${s.slice(0, max)}…(+${s.length - max} chars)` : s;
};

/** In-memory ring buffer + structured logs. Set LOG_LEVEL=debug for per-event logs; TRACE_BUFFER sets capacity. */
@Injectable()
export class TraceService {
  private log = new Logger('trace');
  private buf: TraceEntry[] = [];
  private seq = 0;
  private cap = Number(process.env.TRACE_BUFFER ?? 500);

  record(e: Omit<TraceEntry, 'seq' | 'ts'>): TraceEntry {
    const entry = { seq: ++this.seq, ts: new Date().toISOString(), ...e };
    this.buf.push(entry);
    if (this.buf.length > this.cap) this.buf.shift();
    return entry;
  }
  event(name: string, attrs: Record<string, unknown> = {}, id?: string) {
    this.record({ kind: 'event', name, id, attrs });
    this.log.log(`${name} ${JSON.stringify(attrs)}${id ? ` id=${id}` : ''}`);
  }
  request(e: { id: string; method: string; path: string; status: number; durationMs: number; requestBody?: string }) {
    this.record({ kind: 'request', name: `${e.method} ${e.path}`, ...e });
    const line = `[${e.id}] ${e.method} ${e.path} -> ${e.status} ${e.durationMs}ms${e.requestBody ? ` body=${e.requestBody}` : ''}`;
    if (e.status >= 500) this.log.error(line); else if (e.status >= 400) this.log.warn(line); else this.log.log(line);
  }
  /** Entries newer than `since` (seq), oldest first. */
  list(since = 0, limit = 200) { return this.buf.filter((e) => e.seq > since).slice(-limit); }
  clear() { this.buf = []; }
}
