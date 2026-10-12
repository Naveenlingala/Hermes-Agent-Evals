import type { AgentRunResult, Grade, GraderSpec } from '../domain/types';

export const GRADER_VERSION = 'det-1.0.0';
const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n) + '…' : s);

function toolCalls(r: AgentRunResult) {
  return r.trace.filter((e): e is Extract<typeof e, { type: 'tool_call' }> => e.type === 'tool_call');
}

/** Pure functions over recorded output/trace. Nothing the agent produced is ever executed. */
export type DeterministicSpec = Exclude<GraderSpec, { type: 'llm_criterion' }>;
export function runDeterministicGrader(spec: DeterministicSpec, r: AgentRunResult): Grade {
  const base = { graderId: spec.id, type: spec.type, kind: 'deterministic' as const, dimension: spec.dimension, version: GRADER_VERSION, config: { ...spec } as Record<string, unknown> };
  const done = (passed: boolean, evidence: string, input: string): Grade => ({ ...base, passed, score: passed ? 1 : 0, evidence, input: clip(input) });
  const out = r.output ?? '';
  switch (spec.type) {
    case 'contains': {
      const [h, n] = spec.caseSensitive ? [out, spec.value] : [out.toLowerCase(), spec.value.toLowerCase()];
      const ok = h.includes(n);
      return done(ok, ok ? `Output contains "${spec.value}".` : `Output does not contain "${spec.value}".`, out);
    }
    case 'not_contains': {
      const [h, n] = spec.caseSensitive ? [out, spec.value] : [out.toLowerCase(), spec.value.toLowerCase()];
      const ok = !h.includes(n);
      return done(ok, ok ? `Output correctly omits "${spec.value}".` : `Output contains forbidden text "${spec.value}".`, out);
    }
    case 'regex': {
      let ok = false;
      let ev: string;
      try {
        const m = new RegExp(spec.pattern, spec.flags ?? '').exec(out.slice(0, 20000));
        ok = !!m;
        ev = ok ? `Pattern /${spec.pattern}/ matched "${clip(m![0], 80)}".` : `Pattern /${spec.pattern}/ did not match the output.`;
      } catch { ev = `Pattern /${spec.pattern}/ is invalid.`; }
      return done(ok, ev, out);
    }
    case 'tool_called': {
      const calls = toolCalls(r).filter((c) => spec.tool === '*' || c.tool === spec.tool);
      const withArgs = spec.argsContain ? calls.filter((c) => JSON.stringify(c.args ?? '').includes(spec.argsContain!)) : calls;
      const ok = withArgs.length > 0;
      const seen = [...new Set(toolCalls(r).map((c) => c.tool))].join(', ') || 'none';
      return done(ok, ok ? `Tool "${spec.tool}" was called${spec.argsContain ? ` with args containing "${spec.argsContain}"` : ''}.` : calls.length ? `Tool "${spec.tool}" was called but no call had args containing "${spec.argsContain}".` : `Tool "${spec.tool}" was never called (tools used: ${seen}).`, `tools: ${seen}`);
    }
    case 'min_tool_calls': {
      const n = toolCalls(r).length;
      return done(n >= spec.min, n >= spec.min ? `${n} tool call(s), at least the required ${spec.min}.` : `Only ${n} tool call(s); at least ${spec.min} required (the agent answered without using tools).`, `calls: ${n}`);
    }
    case 'tool_not_called': {
      const n = toolCalls(r).filter((c) => c.tool === spec.tool).length;
      return done(n === 0, n === 0 ? `Tool "${spec.tool}" was not called.` : `Tool "${spec.tool}" was called ${n} time(s) but must not be.`, `calls: ${n}`);
    }
    case 'max_tool_calls': {
      const n = toolCalls(r).length;
      return done(n <= spec.max, n <= spec.max ? `${n} tool call(s), within budget of ${spec.max}.` : `${n} tool calls exceeded budget of ${spec.max}.`, `calls: ${n}`);
    }
  }
}
