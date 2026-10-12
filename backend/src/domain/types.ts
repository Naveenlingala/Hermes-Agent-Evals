// Shared contract types. Imported (type-only) by the frontend.

export type GraderDimension = 'success' | 'tool';

export type GraderSpec =
  | { id: string; type: 'contains'; dimension: 'success'; value: string; caseSensitive?: boolean }
  | { id: string; type: 'not_contains'; dimension: 'success'; value: string; caseSensitive?: boolean }
  | { id: string; type: 'regex'; dimension: 'success'; pattern: string; flags?: string }
  /** `tool: '*'` matches any tool (use with argsContain to prove e.g. a URL was fetched, without knowing tool names). */
  | { id: string; type: 'tool_called'; dimension: 'tool'; tool: string; argsContain?: string; required?: boolean }
  | { id: string; type: 'tool_not_called'; dimension: 'tool'; tool: string; required?: boolean }
  | { id: string; type: 'max_tool_calls'; dimension: 'tool'; max: number; required?: boolean }
  | { id: string; type: 'min_tool_calls'; dimension: 'tool'; min: number; required?: boolean }
  /** Plain-English success criterion judged by an LLM from the final answer and the trace. Always gates pass/fail (score >= passScore of 5). */
  | { id: string; type: 'llm_criterion'; dimension: 'success'; criterion: string; passScore?: number };

export type GraderType = GraderSpec['type'];

/** Mock-only fixtures: what the *mock* runner emits. Ignored by the real Hermes runner. */
export interface MockScenario {
  difficulty: number; // 0 easy .. 1 hard; lowers the mock success probability
  good: { output: string; tools: MockToolCall[] };
  bad: { output: string; tools: MockToolCall[] };
}
/** Plain-language metric explanation shown in the UI (see grading/metric-catalog.ts). */
export interface MetricInfo { key: string; group: 'outcome' | 'trajectory' | 'component' | 'efficiency'; label: string; summary: string; howComputed: string; deterministic: string; llm: string; direction: string; badMeans: string; naMeans: string; example: string }

export interface ExpectedToolCall { tool: string; /** key -> substring that must appear (case-insensitive) in that arg; key '*' = anywhere in the args */ args?: Record<string, string> }
export interface ExpectedSpec { tools?: ExpectedToolCall[]; optimalSteps?: number }
/** Which metrics to ALSO evaluate with an LLM judge (costs extra judge calls). Deterministic versions are always computed. */
export interface JudgeMetricsOpt { stepEfficiency?: boolean; planQuality?: boolean; planAdherence?: boolean; toolCalls?: boolean }

export interface MockToolCall { tool: string; args: Record<string, unknown>; result: string }

export interface Task {
  id: string;
  name: string;
  category: string;
  prompt: string;
  /** Prompts run first, each as a separate Hermes session, with the same config (e.g. to plant a fact for a memory test). `{{nonce}}` is replaced per (task, trial) in every prompt, grader and rubric. Real Hermes only. */
  setupPrompts?: string[];
  /** Append a "state a plan first" instruction to the prompt the AGENT receives (grading/judging still use the original prompt). Needed for plan metrics because Hermes does not plan visibly on its own. */
  elicitPlan?: boolean;
  graders: GraderSpec[];
  expected?: ExpectedSpec;
  judgeMetrics?: JudgeMetricsOpt;
  judgeRubric?: string;
  mock?: MockScenario;
  createdAt: string;
  seeded: boolean;
}

export interface Pricing { inputPerMTok: number; outputPerMTok: number }

export interface AgentConfig {
  id: string;
  name: string;
  description: string;
  runner: 'mock' | 'hermes';
  model: string;
  provider?: string;
  pricing: Pricing;
  /** Toolsets enabled for the agent (Hermes `--toolsets`). Empty = Hermes default. */
  toolsets: string[];
  /** Skills preloaded for the session (Hermes `--skills`). */
  skills: string[];
  /** 'off' passes Hermes `--ignore-rules` (skips persistent memory AND AGENTS.md/SOUL.md/.cursorrules injection). */
  memory: 'on' | 'off';
  /** Hermes `--max-turns` (tool-calling iteration cap). */
  maxTurns?: number;
  /** Mock-only behaviour knobs. */
  mock?: { skill: number; latencyMs: number; overrides?: Record<string, number> };
  createdAt: string;
  seeded: boolean;
}

export type TraceEvent =
  | { t: number; type: 'message'; role: 'assistant' | 'system'; content: string }
  | { t: number; type: 'tool_call'; callId: string; tool: string; args: unknown }
  | { t: number; type: 'tool_result'; callId: string; content: string; isError?: boolean }
  | { t: number; type: 'error'; content: string }
  | { t: number; type: 'retry'; content: string };

export interface AgentRunResult {
  output: string;
  trace: TraceEvent[];
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  retries: number;
  error?: string;
  /** true when latency/tokens are simulated by the mock runner */
  simulated: boolean;
  raw?: string;
}

export interface Grade {
  graderId: string;
  type: GraderType | 'llm_judge' | 'step_efficiency' | 'plan_quality' | 'plan_adherence' | 'tool_calls';
  kind: 'deterministic' | 'llm';
  dimension: GraderDimension | 'quality' | 'trajectory' | 'component';
  version: string;
  passed: boolean;
  score: number; // 0..1
  evidence: string;
  input: string; // what the grader examined (truncated)
  config: Record<string, unknown>;
  judge?: { mode: 'mock' | 'anthropic'; model: string; rawResponse?: string; usage?: { input: number; output: number } };
  error?: string;
}

/** A metric value. `null` = not applicable (never 0): see `reason`. */
export interface MetricValue { value: number | null; source: 'deterministic' | 'llm' | null; deterministic: number | null; llm: number | null; reason?: string }
export interface CallRow {
  index: number; eventIndex: number; tool: string; args: unknown;
  redundant: boolean; errored: boolean;
  toolOk: boolean | null; argsOk: boolean | null; // deterministic vs expectations (null = no expectation)
  llmToolOk?: boolean; llmArgsOk?: boolean; evidence?: string; // optional LLM per-call verdict
}
export interface RunMetrics {
  taskCompletion: number; // mean score of success-dimension graders (0-1)
  stepEfficiency: MetricValue; planQuality: MetricValue; planAdherence: MetricValue;
  toolCorrectness: MetricValue; argumentCorrectness: MetricValue;
  plan: { source: 'tool' | 'narration'; text: string } | null;
  calls: CallRow[];
}

export interface RunRecord {
  id: string;
  experimentId: string;
  taskId: string;
  configId: string;
  trial: number;
  runner: 'mock' | 'hermes';
  startedAt: string;
  finishedAt: string;
  result: AgentRunResult;
  grades: Grade[];
  passed: boolean; // all success graders pass and no execution error
  toolScore: number | null;
  quality: number | null; // llm judge, 0..1
  costUsd: number;
  failureReasons: string[];
  metrics?: RunMetrics; // absent on runs recorded before trajectory metrics existed
  /** snapshots so a run stays reproducible if the task/config is later edited */
  taskSnapshot: Pick<Task, 'id' | 'name' | 'prompt' | 'setupPrompts' | 'elicitPlan' | 'graders' | 'judgeRubric' | 'expected' | 'judgeMetrics'> & { nonce?: string };
  configSnapshot: Omit<AgentConfig, 'createdAt'>;
}

export type ExperimentStatus = 'running' | 'completed' | 'failed';

export interface ExperimentEvent { t: string; level: 'info' | 'ok' | 'warn' | 'error'; kind: string; message: string; runId?: string; ms?: number }
/** What the engine is doing right now (cleared when the experiment ends). */
export interface ExperimentLive { phase: 'agent' | 'grading' | 'judging'; runNumber: number; total: number; taskName: string; configName: string; trial: number; trials: number; label?: string; startedAt: string }
export interface ExperimentCounters { agentOk: number; agentFailed: number; judgeOk: number; judgeFailed: number; passed: number; failed: number; tokens: number; costUsd: number }

export interface Experiment {
  id: string;
  name: string;
  taskIds: string[];
  configIds: string[];
  trials: number;
  status: ExperimentStatus;
  progress: { done: number; total: number };
  createdAt: string;
  finishedAt?: string;
  mode: 'mock' | 'hermes' | 'mixed';
  seeded: boolean;
  error?: string;
  /** Live progress; absent on experiments recorded before it existed. `events` is the last 150 only. */
  live?: ExperimentLive;
  counters?: ExperimentCounters;
  events?: ExperimentEvent[];
}

export interface Interval { low: number; high: number }

export interface ConfigSummary {
  configId: string;
  configName: string;
  runner: 'mock' | 'hermes';
  runs: number;
  passes: number;
  passRate: number;
  passRateCi: Interval; // Wilson 95%, treats runs as independent
  meanQuality: number | null;
  meanToolScore: number | null;
  /** Means of the trajectory/component metrics over runs where they were applicable (null if never). */
  meanMetrics: Record<'taskCompletion' | 'stepEfficiency' | 'planQuality' | 'planAdherence' | 'toolCorrectness' | 'argumentCorrectness', number | null>;
  meanLatencyMs: number;
  p95LatencyMs: number;
  meanTokens: number;
  meanCostUsd: number;
  totalCostUsd: number;
}

export interface MetricDiff {
  metric: string;
  label: string;
  unit: 'ratio' | 'ms' | 'tokens' | 'usd';
  a: number | null;
  b: number | null;
  diff: number | null; // b - a
  ci: Interval | null; // paired bootstrap over tasks; null when data is insufficient
  higherIsBetter: boolean;
}

export interface TaskComparison {
  taskId: string;
  taskName: string;
  category: string;
  trialsA: number;
  trialsB: number;
  passRateA: number | null;
  passRateB: number | null;
  delta: number | null;
  status: 'improvement' | 'regression' | 'tie' | 'incomplete';
  runIdsA: string[];
  runIdsB: string[];
  failureReasonB?: string;
}

export interface Comparison {
  experimentId: string;
  a: ConfigSummary;
  b: ConfigSummary;
  tasks: TaskComparison[];
  wins: number; losses: number; ties: number; // task-level, from B's perspective
  metrics: MetricDiff[];
  uncertainty: {
    sufficient: boolean;
    nTasks: number;
    minTrials: number;
    note: string;
    verdict: 'b_better' | 'a_better' | 'inconclusive';
  };
}

export interface Overview {
  experiments: number;
  runs: number;
  leaderboard: ConfigSummary[];
  latestExperimentId: string | null;
  hardestTasks: { taskId: string; taskName: string; passRate: number; runs: number; topFailure?: string }[];
  recentRegressions: { experimentId: string; experimentName: string; taskId: string; taskName: string; delta: number; aName: string; bName: string }[];
  dataMode: { mockRuns: number; hermesRuns: number };
}
