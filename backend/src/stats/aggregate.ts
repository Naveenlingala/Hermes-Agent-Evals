import type { Comparison, ConfigSummary, MetricDiff, RunRecord, Task, TaskComparison } from '../domain/types';
import { bootstrapMeanCi, mean, percentile, wilson } from './stats';

const nn = (xs: (number | null)[]): number[] => xs.filter((x): x is number => x !== null);
const meanOrNull = (xs: number[]) => (xs.length ? mean(xs) : null);

export function summarize(runs: RunRecord[], configId: string, configName: string): ConfigSummary {
  const rs = runs.filter((r) => r.configId === configId);
  const passes = rs.filter((r) => r.passed).length;
  const lat = rs.map((r) => r.result.latencyMs);
  return {
    configId, configName, runner: rs[0]?.runner ?? 'mock', runs: rs.length, passes,
    passRate: rs.length ? passes / rs.length : 0,
    passRateCi: wilson(passes, rs.length),
    meanQuality: meanOrNull(nn(rs.map((r) => r.quality))),
    meanToolScore: meanOrNull(nn(rs.map((r) => r.toolScore))),
    meanMetrics: Object.fromEntries(METRIC_KEYS.map((k) => [k, meanOrNull(nn(rs.map((r) => metricOf(r, k))))])) as ConfigSummary['meanMetrics'],
    meanLatencyMs: rs.length ? mean(lat) : 0,
    p95LatencyMs: rs.length ? percentile(lat, 0.95) : 0,
    meanTokens: rs.length ? mean(rs.map((r) => r.result.inputTokens + r.result.outputTokens)) : 0,
    meanCostUsd: rs.length ? mean(rs.map((r) => r.costUsd)) : 0,
    totalCostUsd: rs.reduce((s, r) => s + r.costUsd, 0),
  };
}

const MIN_TASKS_FOR_CI = 5;
const METRIC_KEYS = ['taskCompletion', 'stepEfficiency', 'planQuality', 'planAdherence', 'toolCorrectness', 'argumentCorrectness'] as const;
/** null when the run predates the metric or it was not applicable. */
const metricOf = (r: RunRecord, k: (typeof METRIC_KEYS)[number]): number | null => {
  const m = r.metrics?.[k];
  return m === undefined ? null : typeof m === 'number' ? m : m.value;
};

type Pick = (rs: RunRecord[]) => number | null;
const METRICS: { metric: string; label: string; unit: MetricDiff['unit']; higherIsBetter: boolean; pick: Pick }[] = [
  { metric: 'passRate', label: 'Task success (pass rate)', unit: 'ratio', higherIsBetter: true, pick: (rs) => (rs.length ? rs.filter((r) => r.passed).length / rs.length : null) },
  { metric: 'quality', label: 'Answer quality (LLM judge)', unit: 'ratio', higherIsBetter: true, pick: (rs) => meanOrNull(nn(rs.map((r) => r.quality))) },
  { metric: 'toolScore', label: 'Tool grader pass rate', unit: 'ratio', higherIsBetter: true, pick: (rs) => meanOrNull(nn(rs.map((r) => r.toolScore))) },
  ...([['taskCompletion', 'Task completion (score)'], ['toolCorrectness', 'Tool correctness'], ['argumentCorrectness', 'Argument correctness'], ['stepEfficiency', 'Step efficiency'], ['planQuality', 'Plan quality'], ['planAdherence', 'Plan adherence']] as const).map(([k, label]) => (
    { metric: k, label, unit: 'ratio' as const, higherIsBetter: true, pick: (rs: RunRecord[]) => meanOrNull(nn(rs.map((r) => metricOf(r, k)))) })),
  { metric: 'latencyMs', label: 'Latency (mean)', unit: 'ms', higherIsBetter: false, pick: (rs) => (rs.length ? mean(rs.map((r) => r.result.latencyMs)) : null) },
  { metric: 'tokens', label: 'Tokens per run', unit: 'tokens', higherIsBetter: false, pick: (rs) => (rs.length ? mean(rs.map((r) => r.result.inputTokens + r.result.outputTokens)) : null) },
  { metric: 'costUsd', label: 'Estimated cost per run', unit: 'usd', higherIsBetter: false, pick: (rs) => (rs.length ? mean(rs.map((r) => r.costUsd)) : null) },
];

/** Compares config B against baseline A on the tasks both ran, pairing by task. */
export function compare(experimentId: string, runs: RunRecord[], tasks: Task[], a: ConfigSummary, b: ConfigSummary): Comparison {
  const ra = runs.filter((r) => r.configId === a.configId);
  const rb = runs.filter((r) => r.configId === b.configId);
  const taskRows: TaskComparison[] = [];
  const paired: { taskRunsA: RunRecord[]; taskRunsB: RunRecord[] }[] = [];
  for (const t of tasks) {
    const ta = ra.filter((r) => r.taskId === t.id);
    const tb = rb.filter((r) => r.taskId === t.id);
    const complete = ta.length > 0 && tb.length > 0;
    const pa = complete ? ta.filter((r) => r.passed).length / ta.length : null;
    const pb = complete ? tb.filter((r) => r.passed).length / tb.length : null;
    const delta = pa !== null && pb !== null ? pb - pa : null;
    const worstB = tb.find((r) => !r.passed);
    taskRows.push({
      taskId: t.id, taskName: t.name, category: t.category, trialsA: ta.length, trialsB: tb.length,
      passRateA: pa, passRateB: pb, delta,
      status: delta === null ? 'incomplete' : delta > 1e-9 ? 'improvement' : delta < -1e-9 ? 'regression' : 'tie',
      runIdsA: ta.map((r) => r.id), runIdsB: tb.map((r) => r.id),
      failureReasonB: delta !== null && delta < 0 ? worstB?.failureReasons[0] : undefined,
    });
    if (complete) paired.push({ taskRunsA: ta, taskRunsB: tb });
  }
  const minTrials = paired.length ? Math.min(...paired.flatMap((p) => [p.taskRunsA.length, p.taskRunsB.length])) : 0;
  const sufficient = paired.length >= MIN_TASKS_FOR_CI;
  const metrics: MetricDiff[] = METRICS.map((m) => {
    const diffs: number[] = [];
    for (const p of paired) {
      const x = m.pick(p.taskRunsA), y = m.pick(p.taskRunsB);
      if (x !== null && y !== null) diffs.push(y - x);
    }
    const va = m.pick(ra), vb = m.pick(rb);
    return {
      metric: m.metric, label: m.label, unit: m.unit, higherIsBetter: m.higherIsBetter, a: va, b: vb,
      diff: va !== null && vb !== null ? vb - va : null,
      ci: sufficient && diffs.length >= MIN_TASKS_FOR_CI ? bootstrapMeanCi(diffs) : null,
    };
  });
  const pr = metrics[0];
  let verdict: Comparison['uncertainty']['verdict'] = 'inconclusive';
  if (pr.ci && pr.ci.low > 0) verdict = 'b_better';
  else if (pr.ci && pr.ci.high < 0) verdict = 'a_better';
  const note = sufficient
    ? `Intervals are 95% percentile-bootstrap CIs of the paired per-task difference (B − A) over ${paired.length} tasks (${minTrials} trial(s)/task min). ` +
      (minTrials < 3 ? 'Few trials per task: treat as indicative, not conclusive.' : 'Pass-rate Wilson intervals elsewhere treat runs as independent.')
    : `Only ${paired.length} shared task(s); at least ${MIN_TASKS_FOR_CI} are needed before intervals are reported. No winner is declared.`;
  return {
    experimentId, a, b, tasks: taskRows, metrics,
    wins: taskRows.filter((t) => t.status === 'improvement').length,
    losses: taskRows.filter((t) => t.status === 'regression').length,
    ties: taskRows.filter((t) => t.status === 'tie').length,
    uncertainty: { sufficient, nTasks: paired.length, minTrials, note, verdict },
  };
}
