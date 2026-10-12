import type { CallRow, ExpectedSpec, ExpectedToolCall, TraceEvent } from '../domain/types';

// Pure functions over a recorded trace. No I/O, nothing the agent produced is executed.

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const lc = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v ?? '')).toLowerCase();
const matchTool = (e: ExpectedToolCall, name: string) => e.tool === '*' || e.tool === name;

/** A tool result counts as an error if flagged, or if it carries Hermes' {error, exit_code} shape with a failure. */
function resultErrored(content: string, isError?: boolean): boolean {
  if (isError) return true;
  try {
    const o = JSON.parse(content);
    if (o && typeof o === 'object') return (o.error !== null && o.error !== undefined && o.error !== '' && o.error !== false) || (typeof o.exit_code === 'number' && o.exit_code !== 0);
  } catch { /* plain text result */ }
  return false;
}

export function argMatches(args: unknown, matchers: Record<string, string>): boolean {
  return Object.entries(matchers).every(([k, want]) => {
    const hay = k === '*' ? lc(args) : lc((args as Record<string, unknown> | null)?.[k]);
    return hay.includes(want.toLowerCase());
  });
}

/** One row per tool call, with redundancy/error flags and deterministic tool/argument checks vs `expected`. */
export function analyzeCalls(trace: TraceEvent[], expected?: ExpectedSpec): CallRow[] {
  const seen = new Set<string>();
  const results = new Map<string, { content: string; isError?: boolean }>();
  for (const e of trace) if (e.type === 'tool_result') results.set(e.callId, { content: e.content, isError: e.isError });
  const rows: CallRow[] = [];
  trace.forEach((e, eventIndex) => {
    if (e.type !== 'tool_call') return;
    const key = e.tool + '|' + stable(e.args);
    const redundant = seen.has(key);
    seen.add(key);
    const r = results.get(e.callId);
    const exp = expected?.tools ?? [];
    const matching = exp.filter((x) => matchTool(x, e.tool));
    const withArgs = matching.filter((x) => x.args && Object.keys(x.args).length);
    rows.push({
      index: rows.length, eventIndex, tool: e.tool, args: e.args, redundant,
      errored: r ? resultErrored(r.content, r.isError) : false,
      toolOk: exp.length ? matching.length > 0 : null,
      argsOk: withArgs.length ? withArgs.some((x) => argMatches(e.args, x.args!)) : null,
    });
  });
  return rows;
}

export interface Scored { value: number | null; reason?: string }

/** 1 - (redundant or errored calls)/calls; with optimalSteps also capped by optimal/actual. */
export function stepEfficiency(calls: CallRow[], optimalSteps?: number): Scored {
  if (!calls.length) return { value: null, reason: 'no tool calls were made' };
  const wasted = calls.filter((c) => c.redundant || c.errored).length;
  const det = 1 - wasted / calls.length;
  const budget = optimalSteps ? Math.min(1, optimalSteps / calls.length) : 1;
  return { value: Math.min(det, budget) };
}

/** F1 between expected tools that were used (recall) and used tools that were expected (precision). */
export function toolCorrectness(calls: CallRow[], expected?: ExpectedSpec): Scored {
  const exp = expected?.tools ?? [];
  if (!exp.length) return { value: null, reason: 'task defines no expected tools' };
  const used = [...new Set(calls.map((c) => c.tool))];
  const recall = exp.filter((e) => used.some((u) => matchTool(e, u))).length / exp.length;
  const precision = used.length ? used.filter((u) => exp.some((e) => matchTool(e, u))).length / used.length : 0;
  return { value: recall + precision === 0 ? 0 : (2 * recall * precision) / (recall + precision) };
}

/** Fraction of expected tools-with-arguments that were called with matching arguments. */
export function argumentCorrectness(calls: CallRow[], expected?: ExpectedSpec): Scored {
  const exp = (expected?.tools ?? []).filter((e) => e.args && Object.keys(e.args).length);
  if (!exp.length) return { value: null, reason: 'task defines no expected arguments' };
  const ok = exp.filter((e) => calls.some((c) => matchTool(e, c.tool) && argMatches(c.args, e.args!))).length;
  return { value: ok / exp.length };
}

const PLAN_TOOL = /todo|plan/i;
const LISTY = /(^|\n)\s*(step\s*\d+\s*[:.)-]|\d+\s*[.)]|[-*•])\s*\S/gi;

/** Plan = a todo/plan tool call, else assistant narration before the first tool call that reads like a plan. Else null. */
export function extractPlan(trace: TraceEvent[]): { source: 'tool' | 'narration'; text: string } | null {
  const planCall = trace.find((e): e is Extract<TraceEvent, { type: 'tool_call' }> => e.type === 'tool_call' && PLAN_TOOL.test(e.tool));
  if (planCall) return { source: 'tool', text: JSON.stringify(planCall.args, null, 1).slice(0, 2000) };
  const firstCall = trace.findIndex((e) => e.type === 'tool_call');
  if (firstCall < 0) return null;
  const text = trace.slice(0, firstCall).filter((e): e is Extract<TraceEvent, { type: 'message' }> => e.type === 'message' && e.role === 'assistant').map((e) => e.content).join('\n').trim();
  const looksLikePlan = (text.match(LISTY)?.length ?? 0) >= 2 || (text.length >= 40 && /\b(plan|first|then|next|finally)\b/i.test(text));
  return looksLikePlan ? { source: 'narration', text: text.slice(0, 2000) } : null;
}

/** Compact, size-capped rendering of the trace for judge prompts (untrusted data: the judge prompt says so). */
export function compactTrace(trace: TraceEvent[], maxChars = 6000): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let used = 0, truncated = false;
  for (let i = 0; i < trace.length; i++) {
    const e = trace[i];
    const line = e.type === 'tool_call' ? `#${i} CALL ${e.tool} ${stable(e.args).slice(0, 300)}`
      : e.type === 'tool_result' ? `#${i} RESULT${e.isError ? ' (error)' : ''} ${e.content.slice(0, 300)}`
      : e.type === 'message' ? `#${i} ${e.role.toUpperCase()}: ${e.content.slice(0, 500)}`
      : `#${i} ${e.type.toUpperCase()}: ${e.content.slice(0, 200)}`;
    if (used + line.length > maxChars) { lines.push(`[truncated: ${trace.length - i} more events]`); truncated = true; break; }
    lines.push(line); used += line.length + 1;
  }
  return { text: lines.join('\n'), truncated };
}
