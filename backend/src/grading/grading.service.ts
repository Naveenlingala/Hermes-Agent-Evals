import { Injectable } from '@nestjs/common';
import type { AgentConfig, AgentRunResult, CallRow, Grade, GraderSpec, MetricValue, RunMetrics, RunRecord, Task } from '../domain/types';
import { DeterministicSpec, runDeterministicGrader } from './deterministic';
import { Judge, MockJudge, judgeGrade } from './judge';
import { analyzeCalls, argumentCorrectness, compactTrace, extractPlan, stepEfficiency, toolCorrectness } from './trajectory';

export interface JudgeCallEvent { label: string; ok: boolean; ms: number; mode: 'mock' | 'anthropic'; model: string; detail?: string }
export interface GradeHooks { onJudgeStart?(label: string, model: string, mode: 'mock' | 'anthropic'): void; onJudge?(e: JudgeCallEvent): void }
export interface GradingOutcome { grades: Grade[]; passed: boolean; toolScore: number | null; quality: number | null; failureReasons: string[]; metrics: RunMetrics }
export type GradableTask = Pick<Task, 'prompt' | 'graders' | 'judgeRubric'> & Partial<Pick<Task, 'expected' | 'judgeMetrics' | 'elicitPlan'>>;

export function costOf(r: AgentRunResult, p: AgentConfig['pricing']): number {
  return (r.inputTokens * p.inputPerMTok + r.outputTokens * p.outputPerMTok) / 1_000_000;
}

const norm = (score15: number) => (score15 - 1) / 4;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const metric = (det: { value: number | null; reason?: string }, llm: number | null | undefined, llmReason?: string): MetricValue =>
  llm !== null && llm !== undefined
    ? { value: llm, source: 'llm', deterministic: det.value, llm }
    : { value: det.value, source: det.value === null ? null : 'deterministic', deterministic: det.value, llm: null, reason: det.value === null ? (llmReason ?? det.reason) : undefined };

@Injectable()
export class GradingService {
  constructor(private judge: Judge, private mockJudge: Judge = new MockJudge()) {}

  get judgeInfo() { return { mode: this.judge.mode, model: this.judge.model }; }

  async grade(task: GradableTask, result: AgentRunResult, hooks?: GradeHooks): Promise<GradingOutcome> {
    const detSpecs = task.graders.filter((g): g is DeterministicSpec => g.type !== 'llm_criterion');
    const criteria = task.graders.filter((g): g is Extract<GraderSpec, { type: 'llm_criterion' }> => g.type === 'llm_criterion');
    const grades: Grade[] = detSpecs.map((g) => runDeterministicGrader(g, result));
    const failureReasons: string[] = [];
    if (result.error) failureReasons.push(`Execution error: ${result.error}`);
    for (const g of grades.filter((x) => !x.passed)) failureReasons.push(`${g.graderId} (${g.type}): ${g.evidence}`);

    // Trajectory + component metrics: deterministic always; LLM versions opt-in per task.
    const calls = analyzeCalls(result.trace, task.expected);
    const plan = extractPlan(result.trace);
    const eff = stepEfficiency(calls, task.expected?.optimalSteps);
    const tool = toolCorrectness(calls, task.expected);
    const args = argumentCorrectness(calls, task.expected);
    const ct = compactTrace(result.trace);
    // Simulated (mock-runner) output never goes to a paid judge: it would cost money and mean nothing.
    const judge = result.simulated ? this.mockJudge : this.judge;
    /** Wraps one judge call so progress hooks see start/finish/duration; behaviour and errors are unchanged. */
    const track = async <T>(label: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T> => {
      hooks?.onJudgeStart?.(label, judge.model, judge.mode);
      const t0 = Date.now();
      try {
        const r = await fn();
        hooks?.onJudge?.({ label, ok: true, ms: Date.now() - t0, mode: judge.mode, model: judge.model, detail: detail?.(r) });
        return r;
      } catch (e) {
        hooks?.onJudge?.({ label, ok: false, ms: Date.now() - t0, mode: judge.mode, model: judge.model, detail: (e as Error).message });
        throw e;
      }
    };
    const asGrade = (graderId: string, type: Grade['type'], dimension: Grade['dimension'], v: Awaited<ReturnType<Judge['judge']>>, config: Record<string, unknown>, input: string, passScore = 4): Grade => ({
      ...judgeGrade(v, '', input), graderId, type, dimension, passed: v.score >= passScore, config,
    });
    const llm: { eff: number | null; planQ: number | null; planA: number | null; tool: number | null; args: number | null } = { eff: null, planQ: null, planA: null, tool: null, args: null };
    const llmNotes: string[] = [];

    if (!result.error) {
      for (const c of criteria) {
        try {
          const v = await track(`criterion ${c.id}`, () => judge.judge({ kind: 'criterion', taskPrompt: task.prompt, rubric: c.criterion, output: result.output, trace: ct.text, deterministicPassed: failureReasons.length === 0 }), (r) => `${r.score}/5`);
          const g = asGrade(c.id, 'llm_criterion', 'success', v, { criterion: c.criterion, passScore: c.passScore ?? 4, scale: '1-5, normalised to 0-1' }, result.output, c.passScore ?? 4);
          g.version = 'criterion-1.0.0';
          grades.push(g);
          if (!g.passed) failureReasons.push(`${c.id} (criterion "${c.criterion.slice(0, 80)}"): scored ${v.score}/5 (needs ${c.passScore ?? 4}) — ${v.evidence}`);
        } catch (e) {
          grades.push({ graderId: c.id, type: 'llm_criterion', kind: 'llm', dimension: 'success', version: 'criterion-1.0.0', passed: false, score: 0, evidence: 'Judge failed; the criterion could not be evaluated, so the run does not pass.', input: '', config: { criterion: c.criterion }, error: (e as Error).message });
          failureReasons.push(`${c.id} (criterion): judge unavailable — ${(e as Error).message}`);
        }
      }
      const opts = task.judgeMetrics ?? {};
      const run = async (kind: 'step_efficiency' | 'plan_quality' | 'plan_adherence', gid: string, dimension: Grade['dimension'], extra: { plan?: string }) => {
        try {
          const v = await track(gid.replace('llm_', '').replace(/_/g, ' '), () => judge.judge({ kind, taskPrompt: task.prompt, rubric: '', output: result.output, trace: ct.text, plan: extra.plan, deterministicPassed: true }), (r) => `${r.score}/5`);
          const g = asGrade(gid, kind, dimension, v, { kind, trace: ct.truncated ? 'truncated' : 'full' }, kind === 'plan_quality' ? extra.plan ?? '' : ct.text.slice(0, 400));
          g.version = 'trajectory-1.0.0'; grades.push(g); return norm(v.score);
        } catch (e) {
          grades.push({ graderId: gid, type: kind, kind: 'llm', dimension, version: 'trajectory-1.0.0', passed: false, score: 0, evidence: 'Judge failed; excluded from the metric.', input: '', config: { kind }, error: (e as Error).message });
          llmNotes.push(`${gid}: ${(e as Error).message}`); return null;
        }
      };
      if (opts.stepEfficiency && calls.length) llm.eff = await run('step_efficiency', 'llm_step_efficiency', 'trajectory', {});
      if (opts.planQuality && plan) llm.planQ = await run('plan_quality', 'llm_plan_quality', 'trajectory', { plan: plan.text });
      if (opts.planAdherence && plan) llm.planA = await run('plan_adherence', 'llm_plan_adherence', 'trajectory', { plan: plan.text });
      if (opts.toolCalls && calls.length) {
        try {
          const tv = await track('per-call tool/argument check', () => judge.judgeToolCalls({ taskPrompt: task.prompt, trace: ct.text, calls: calls.map((c) => ({ index: c.index, tool: c.tool, args: c.args })) }), (r) => `${r.calls.length} calls`);
          for (const v of tv.calls) { const row = calls[v.index]; if (row) { row.llmToolOk = v.toolOk; row.llmArgsOk = v.argsOk; row.evidence = v.evidence; } }
          llm.tool = mean(tv.calls.map((c) => (c.toolOk ? 1 : 0)));
          llm.args = mean(tv.calls.map((c) => (c.argsOk ? 1 : 0)));
          const base = { kind: 'llm' as const, dimension: 'component' as const, type: 'tool_calls' as const, version: 'trajectory-1.0.0', input: ct.text.slice(0, 400), config: { calls: calls.length }, judge: { mode: tv.mode, model: tv.model, rawResponse: tv.rawResponse, usage: tv.usage } };
          grades.push({ ...base, graderId: 'llm_tool_selection', passed: (llm.tool ?? 0) >= 0.8, score: llm.tool ?? 0, evidence: `${tv.calls.filter((c) => c.toolOk).length}/${tv.calls.length} calls used an appropriate tool.` });
          grades.push({ ...base, graderId: 'llm_argument_correctness', passed: (llm.args ?? 0) >= 0.8, score: llm.args ?? 0, evidence: `${tv.calls.filter((c) => c.argsOk).length}/${tv.calls.length} calls had correct arguments.` });
        } catch (e) { llmNotes.push(`llm_tool_calls: ${(e as Error).message}`); grades.push({ graderId: 'llm_tool_calls', type: 'tool_calls', kind: 'llm', dimension: 'component', version: 'trajectory-1.0.0', passed: false, score: 0, evidence: 'Judge failed; excluded from the metrics.', input: '', config: {}, error: (e as Error).message }); }
      }
    }
    // Why a plan metric is N/A, in actionable terms (shown on the run page).
    const optedPlan = (on?: boolean): string => {
      if (!on) return 'Not enabled on this task. Plan metrics need the LLM option for this metric, and the agent has to state a plan: also enable "Ask the agent to state a plan first".';
      if (!calls.length) return 'The run made no tool calls, so there is no plan to follow.';
      if (!plan) return task.elicitPlan
        ? 'The agent was asked to state a plan but did not write one before using tools (the model ignored the instruction).'
        : 'The agent did not state a plan on its own (Hermes does not by default). Enable "Ask the agent to state a plan first" on the task.';
      return 'The judge call failed, so no score was produced (see the grader table for the error).';
    };

    // Pass: no error, every success-dimension grader (deterministic AND llm_criterion) passes, and required tool graders pass.
    const success = grades.filter((g) => g.dimension === 'success');
    const requiredTool = grades.filter((g) => g.dimension === 'tool' && g.config.required === true);
    const passed = !result.error && success.every((g) => g.passed) && requiredTool.every((g) => g.passed);

    const toolGraders = grades.filter((g) => g.dimension === 'tool');
    const quality = await this.rubricQuality(task, result, passed, judge, grades, track);
    const metrics: RunMetrics = {
      taskCompletion: mean(success.map((g) => g.score)) ?? (passed ? 1 : 0),
      stepEfficiency: metric(eff, llm.eff),
      planQuality: metric({ value: null, reason: optedPlan(task.judgeMetrics?.planQuality) }, llm.planQ),
      planAdherence: metric({ value: null, reason: optedPlan(task.judgeMetrics?.planAdherence) }, llm.planA),
      toolCorrectness: metric(tool, llm.tool),
      argumentCorrectness: metric(args, llm.args),
      plan, calls,
    };
    void llmNotes;
    return { grades, passed, quality, toolScore: toolGraders.length ? toolGraders.filter((g) => g.passed).length / toolGraders.length : null, failureReasons, metrics };
  }

  private async rubricQuality(task: GradableTask, result: AgentRunResult, passed: boolean, judge: Judge, grades: Grade[], track: <T>(label: string, fn: () => Promise<T>, detail?: (r: T) => string) => Promise<T>): Promise<number | null> {
    if (!task.judgeRubric || result.error) return null;
    try {
      const v = await track('quality rubric', () => judge.judge({ taskPrompt: task.prompt, rubric: task.judgeRubric!, output: result.output, deterministicPassed: passed }), (r) => `${r.score}/5`);
      const g = judgeGrade(v, task.judgeRubric, result.output);
      grades.push(g);
      return g.score;
    } catch (e) {
      grades.push({ graderId: 'llm_judge', type: 'llm_judge', kind: 'llm', dimension: 'quality', version: 'judge-1.0.0', passed: false, score: 0, evidence: 'Judge failed; excluded from quality metric.', input: '', config: { rubric: task.judgeRubric }, error: (e as Error).message });
      return null;
    }
  }
}

export type { RunRecord, CallRow };
