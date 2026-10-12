import Anthropic from '@anthropic-ai/sdk';
import type { Grade } from '../domain/types';
import { SYSTEM_PROMPTS, TOOL_CALLS_SYSTEM, buildUserMessage } from './judge-prompts';

export const JUDGE_VERSION = 'judge-1.0.0';

export type JudgeKind = 'rubric' | 'criterion' | 'step_efficiency' | 'plan_quality' | 'plan_adherence';
/** For kind 'criterion' the `rubric` field carries the criterion text. `trace`/`plan` are only used by the kinds that need them. */
export interface JudgeInput { taskPrompt: string; rubric: string; output: string; deterministicPassed: boolean; kind?: JudgeKind; trace?: string; plan?: string }
export interface ToolCallsInput { taskPrompt: string; trace: string; calls: { index: number; tool: string; args: unknown }[] }
export interface ToolCallVerdict { index: number; toolOk: boolean; argsOk: boolean; evidence: string }
export interface ToolCallsVerdict { calls: ToolCallVerdict[]; mode: 'mock' | 'anthropic'; model: string; rawResponse?: string; usage?: { input: number; output: number } }
export interface JudgeVerdict { score: number; evidence: string; mode: 'mock' | 'anthropic'; model: string; rawResponse?: string; usage?: { input: number; output: number } }
export interface Judge { readonly mode: 'mock' | 'anthropic'; readonly model: string; judge(i: JudgeInput): Promise<JudgeVerdict>; judgeToolCalls(i: ToolCallsInput): Promise<ToolCallsVerdict> }

/** Schema validation for judge JSON: {"score": 1-5 integer, "evidence": string}. */
export function parseJudgeJson(text: string): { score: number; evidence: string } {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('judge response contained no JSON object');
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { throw new Error('judge response was not valid JSON'); }
  if (!Number.isInteger(obj.score) || obj.score < 1 || obj.score > 5) throw new Error('judge "score" must be an integer 1-5');
  if (typeof obj.evidence !== 'string' || !obj.evidence.trim()) throw new Error('judge "evidence" must be a non-empty string');
  return { score: obj.score, evidence: obj.evidence.trim().slice(0, 600) };
}

/** Validates {"calls":[{index, tool_ok, args_ok, evidence}]}: exactly one entry per expected index, booleans, evidence string. */
export function parseToolCallsJson(text: string, indexes: number[]): ToolCallVerdict[] {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('judge response contained no JSON object');
  let obj: any;
  try { obj = JSON.parse(m[0]); } catch { throw new Error('judge response was not valid JSON'); }
  if (!Array.isArray(obj.calls)) throw new Error('judge "calls" must be an array');
  const out = obj.calls.map((c: any) => {
    if (!Number.isInteger(c?.index) || typeof c.tool_ok !== 'boolean' || typeof c.args_ok !== 'boolean' || typeof c.evidence !== 'string') throw new Error('judge call entry has the wrong shape');
    return { index: c.index, toolOk: c.tool_ok, argsOk: c.args_ok, evidence: c.evidence.trim().slice(0, 300) } as ToolCallVerdict;
  });
  const got = out.map((c: ToolCallVerdict) => c.index).sort((a: number, b: number) => a - b);
  const want = [...indexes].sort((a, b) => a - b);
  if (got.length !== want.length || got.some((v: number, i: number) => v !== want[i])) throw new Error('judge must return exactly one entry per listed call');
  return out;
}

/**
 * Deterministic stand-in so the demo needs no API key. It is NOT a quality judgment:
 * it scores keyword coverage of the rubric. Every grade it produces is labelled mode="mock".
 */
export class MockJudge implements Judge {
  readonly mode = 'mock' as const;
  readonly model = 'mock-judge';
  private v(score: number, evidence: string): JudgeVerdict { return { score: Math.max(1, Math.min(5, Math.round(score))), evidence: `[mock judge] ${evidence}`, mode: 'mock', model: this.model }; }
  async judge(i: JudgeInput): Promise<JudgeVerdict> {
    const kind = i.kind ?? 'rubric';
    const trace = i.trace ?? '';
    const calls = trace.split('\n').filter((l) => /^#\d+ CALL /.test(l)).map((l) => l.replace(/^#\d+ /, ''));
    if (kind === 'step_efficiency') {
      const dup = calls.length - new Set(calls).size, errs = (trace.match(/RESULT \(error\)/g) ?? []).length;
      return this.v(5 - Math.min(4, 2 * dup + 2 * errs), `${calls.length} calls, ${dup} repeated, ${errs} errored (heuristic)`);
    }
    if (kind === 'plan_quality') {
      const steps = ((i.plan ?? '').match(/(^|\n)\s*(\d+[.)]|[-*•])\s+\S/g) ?? []).length;
      return this.v(1 + Math.min(4, steps), `${steps} listed plan steps (heuristic: more explicit steps = higher)`);
    }
    if (kind === 'plan_adherence') {
      const mentioned = (i.plan ?? '').match(/\buse\s+([a-z_]+)/gi)?.map((m) => m.split(/\s+/)[1].toLowerCase()) ?? [];
      const hit = mentioned.filter((t) => calls.some((c) => c.startsWith(`CALL ${t} `)));
      return this.v(mentioned.length ? 1 + 4 * (hit.length / mentioned.length) : 3, mentioned.length ? `${hit.length}/${mentioned.length} planned tools were actually called (heuristic)` : 'plan names no tools; neutral');
    }
    const text = (kind === 'criterion' ? `${i.output} ${trace}` : i.output).toLowerCase();
    const words = [...new Set(i.rubric.toLowerCase().match(/[a-z0-9]{5,}/g) ?? [])];
    const hit = words.filter((w) => text.includes(w));
    const coverage = words.length ? hit.length / words.length : 0.5;
    return this.v(1 + coverage * 3 + (i.deterministicPassed ? 1 : 0), `${hit.length}/${words.length} ${kind === 'criterion' ? 'criterion' : 'rubric'} keywords present${i.deterministicPassed ? '; deterministic checks passed' : ''}`);
  }
  async judgeToolCalls(i: ToolCallsInput): Promise<ToolCallsVerdict> {
    const seen = new Set<string>();
    const calls = i.calls.map((c) => { const k = c.tool + JSON.stringify(c.args); const dup = seen.has(k); seen.add(k); return { index: c.index, toolOk: true, argsOk: !dup, evidence: `[mock judge] ${dup ? 'repeated identical call' : 'no problem detected'} (heuristic)` }; });
    return { calls, mode: 'mock', model: this.model };
  }
}

/** The slice of the Anthropic SDK the judge uses; lets tests inject a fake client. */
export interface JudgeClient { messages: { create(params: any): Promise<any> } }

export const JUDGE_SYSTEM = SYSTEM_PROMPTS.rubric;

/** Client options for the judge. A key that is not scoped to a workspace needs the `anthropic-workspace-id` header on every request. */
export function judgeClientOptions(apiKey: string, workspaceId?: string) {
  return { apiKey, timeout: 30_000, maxRetries: 2, ...(workspaceId ? { defaultHeaders: { 'anthropic-workspace-id': workspaceId } } : {}) };
}

export class AnthropicJudge implements Judge {
  readonly mode = 'anthropic' as const;
  private client: JudgeClient;
  constructor(apiKey: string, readonly model: string, client?: JudgeClient, private workspaceId?: string) {
    this.client = client ?? new Anthropic(judgeClientOptions(apiKey, workspaceId));
  }
  /** One request; refusal/truncation become errors. No thinking/temperature params (model-dependent); max_tokens is generous because default-on thinking counts against it. */
  private async ask(system: string, user: string): Promise<{ text: string; usage: { input: number; output: number } }> {
    let res: any;
    try {
      res = await this.client.messages.create({ model: this.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }] });
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      throw new Error(/workspace/i.test(msg) && !this.workspaceId ? `${msg} — set ANTHROPIC_WORKSPACE_ID in .env to your workspace ID and restart` : msg);
    }
    if (res.stop_reason === 'refusal') throw new Error('judge model refused to grade (stop_reason=refusal)');
    if (res.stop_reason === 'max_tokens') throw new Error('judge response was truncated (stop_reason=max_tokens)');
    const text = (res.content ?? []).filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    return { text, usage: { input: res.usage?.input_tokens ?? 0, output: res.usage?.output_tokens ?? 0 } };
  }
  async judge(i: JudgeInput): Promise<JudgeVerdict> {
    const { text, usage } = await this.ask(SYSTEM_PROMPTS[i.kind ?? 'rubric'], buildUserMessage(i));
    return { ...parseJudgeJson(text), mode: 'anthropic', model: this.model, rawResponse: text.slice(0, 1000), usage };
  }
  async judgeToolCalls(i: ToolCallsInput): Promise<ToolCallsVerdict> {
    const user = `<task>${i.taskPrompt}</task>\n<calls>${JSON.stringify(i.calls.map((c) => ({ index: c.index, tool: c.tool, args: c.args })))}</calls>\n<trace>${i.trace}</trace>`;
    const { text, usage } = await this.ask(TOOL_CALLS_SYSTEM, user);
    return { calls: parseToolCallsJson(text, i.calls.map((c) => c.index)), mode: 'anthropic', model: this.model, rawResponse: text.slice(0, 1500), usage };
  }
}

export function createJudge(env = process.env): Judge {
  const mode = env.JUDGE_MODE ?? 'auto';
  if (mode !== 'mock' && env.ANTHROPIC_API_KEY) return new AnthropicJudge(env.ANTHROPIC_API_KEY, env.JUDGE_MODEL ?? 'claude-haiku-5-5', undefined, env.ANTHROPIC_WORKSPACE_ID || undefined);
  return new MockJudge();
}

export function judgeGrade(v: JudgeVerdict, rubric: string, input: string): Grade {
  return {
    graderId: 'llm_judge', type: 'llm_judge', kind: 'llm', dimension: 'quality', version: JUDGE_VERSION,
    passed: v.score >= 4, score: (v.score - 1) / 4, evidence: v.evidence, input: input.slice(0, 400),
    config: { rubric, scale: '1-5 integer, normalised to 0-1; pass threshold >= 4' },
    judge: { mode: v.mode, model: v.model, rawResponse: v.rawResponse, usage: v.usage },
  };
}
