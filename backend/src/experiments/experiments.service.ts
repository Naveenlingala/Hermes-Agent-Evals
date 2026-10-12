import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import type { AgentConfig, Comparison, Experiment, ExperimentCounters, ExperimentEvent, ExperimentLive, Overview, RunRecord, Task } from '../domain/types';
import { GradingService, costOf } from '../grading/grading.service';
import { RUNNERS, RunnerMap } from '../runner/runner';
import { Inject, OnModuleInit } from '@nestjs/common';
import { compare, summarize } from '../stats/aggregate';
import { TraceService } from '../trace/trace.service';
import { Check } from '../validation';
import { PLAN_INSTRUCTION, renderTask } from '../tasks/template';

const MAX_EVENTS = 150;
const fmtMs = (ms: number) => (ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);

@Injectable()
export class ExperimentsService implements OnModuleInit {
  private inflight = new Map<string, Promise<void>>();

  constructor(private db: DbService, private grading: GradingService, @Inject(RUNNERS) private runners: RunnerMap, private trace: TraceService) {}

  reset() {
    if (this.inflight.size) throw new ConflictException(`Cannot reset while ${this.inflight.size} experiment(s) are running. Wait for them to finish.`);
    const deleted = this.db.clear();
    this.trace.event('reset', { deleted });
    return { deleted };
  }
  list() { return this.db.list<Experiment>('experiments').reverse(); }
  get(id: string) {
    const e = this.db.get<Experiment>('experiments', id);
    if (!e) throw new NotFoundException(`Experiment ${id} not found`);
    return e;
  }
  runs(experimentId: string) { return this.db.list<RunRecord>('runs', experimentId); }
  run(id: string) {
    const r = this.db.get<RunRecord>('runs', id);
    if (!r) throw new NotFoundException(`Run ${id} not found`);
    return r;
  }
  /** Resolves when the experiment has finished (used by tests and seeding). */
  settled(id: string) { return this.inflight.get(id) ?? Promise.resolve(); }

  create(body: unknown, opts: { seeded?: boolean } = {}): Experiment {
    const c = new Check(body);
    const name = c.str('name', { max: 120 });
    const taskIds = c.strArray('taskIds', { minItems: 1, maxItems: 50 });
    const configIds = c.strArray('configIds', { minItems: 2, maxItems: 6 });
    const trials = c.num('trials', { min: 1, max: 20, int: true, optional: true }) ?? 1;
    c.done();
    const tasks = taskIds.map((id) => this.db.get<Task>('tasks', id));
    const configs = configIds.map((id) => this.db.get<AgentConfig>('configs', id));
    const missing = [...taskIds.filter((_, i) => !tasks[i]), ...configIds.filter((_, i) => !configs[i])];
    if (missing.length) throw new BadRequestException({ message: 'Validation failed', errors: [`Unknown ids: ${missing.join(', ')}`] });
    const runners = new Set(configs.map((c) => c!.runner));
    if (runners.has('mock')) {
      const realOnly = (tasks as Task[]).filter((t) => !t.mock).map((t) => t.name);
      if (realOnly.length) throw new BadRequestException({ message: 'Validation failed', errors: [`These tasks have no mock scenario and can only run on real Hermes configs: ${realOnly.join(', ')}. Deselect them or use only Hermes configs.`] });
    }
    const exp: Experiment = {
      id: `exp-${randomUUID().slice(0, 8)}`, name: name!, taskIds, configIds, trials, status: 'running',
      progress: { done: 0, total: taskIds.length * configIds.length * trials }, createdAt: new Date().toISOString(),
      mode: runners.size > 1 ? 'mixed' : runners.has('hermes') ? 'hermes' : 'mock', seeded: !!opts.seeded,
    };
    this.db.put('experiments', exp);
    this.trace.event('experiment.start', { name: exp.name, tasks: taskIds.length, configs: configIds.length, trials, total: exp.progress.total }, exp.id);
    const p = this.execute(exp, tasks as Task[], configs as AgentConfig[]).finally(() => this.inflight.delete(exp.id));
    this.inflight.set(exp.id, p);
    return exp;
  }

  private async execute(exp: Experiment, tasks: Task[], configs: AgentConfig[]) {
    const total = exp.progress.total;
    const counters: ExperimentCounters = { agentOk: 0, agentFailed: 0, judgeOk: 0, judgeFailed: 0, passed: 0, failed: 0, tokens: 0, costUsd: 0 };
    exp.counters = counters;
    exp.events = [];
    const save = () => this.db.put('experiments', exp);
    const emit = (level: ExperimentEvent['level'], kind: string, message: string, extra: { runId?: string; ms?: number } = {}) => {
      exp.events!.push({ t: new Date().toISOString(), level, kind, message, ...extra });
      if (exp.events!.length > MAX_EVENTS) exp.events!.splice(0, exp.events!.length - MAX_EVENTS);
      save();
    };
    emit('info', 'start', `Started: ${configs.length} configs × ${tasks.length} tasks × ${exp.trials} trials = ${total} runs (${exp.mode} runner).`);
    try {
      let n = 0;
      for (let trial = 1; trial <= exp.trials; trial++) {
        for (const baseTask of tasks) {
          const { task, nonce } = renderTask(baseTask, trial);
          for (const config of configs) {
            n++;
            const base = { runNumber: n, total, taskName: task.name, configName: config.name, trial, trials: exp.trials, startedAt: new Date().toISOString() };
            const setLive = (phase: ExperimentLive['phase'], label?: string) => { exp.live = { ...base, phase, label }; save(); };
            setLive('agent');
            emit('info', 'run_start', `Run ${n}/${total} · ${config.name} · ${task.name} · trial ${trial}/${exp.trials}`);
            const startedAt = new Date().toISOString();
            const t0 = Date.now();
            let result;
            try {
              // The agent sees the plan instruction; grading, judging and the stored prompt use the original task.
              const agentTask = task.elicitPlan ? { ...task, prompt: task.prompt + PLAN_INSTRUCTION } : task;
              result = await this.runners[config.runner].run({ task: agentTask, config, trial });
              if (task.elicitPlan) result.trace.unshift({ t: 0, type: 'message', role: 'system', content: `[platform] plan requested: this instruction was appended to the prompt the agent received: "${PLAN_INSTRUCTION.trim()}"` });
            } catch (e) {
              result = { output: '', trace: [], latencyMs: 0, inputTokens: 0, outputTokens: 0, retries: 0, simulated: config.runner === 'mock', error: `Runner threw: ${(e as Error).message}` };
            }
            const agentMs = Date.now() - t0;
            const calls = result.trace.filter((e) => e.type === 'tool_call').length;
            if (result.error) {
              counters.agentFailed++;
              emit('error', 'agent_error', `Agent error after ${fmtMs(agentMs)}: ${clip(result.error, 220)}`, { ms: agentMs });
            } else {
              counters.agentOk++;
              emit('ok', 'agent_done', `${result.simulated ? `Mock agent finished (simulated ${fmtMs(result.latencyMs)})` : `Agent finished in ${fmtMs(agentMs)}`} · ${calls} tool call${calls === 1 ? '' : 's'} · ${(result.inputTokens + result.outputTokens).toLocaleString('en-US')} tokens`, { ms: agentMs });
            }
            setLive('grading');
            const g = await this.grading.grade(task, result, {
              onJudgeStart: (label, model, mode) => setLive('judging', `${label} · ${mode === 'mock' ? 'mock judge' : model}`),
              onJudge: (e) => {
                if (e.ok) counters.judgeOk++; else counters.judgeFailed++;
                emit(e.ok ? 'ok' : 'error', 'judge_call', `Judge ${e.label} (${e.mode === 'mock' ? 'mock' : e.model}) ${e.ok ? `ok${e.detail ? ` · ${e.detail}` : ''}` : `FAILED · ${clip(e.detail ?? '', 220)}`} · ${fmtMs(e.ms)}`, { ms: e.ms });
                setLive('grading');
              },
            });
            const { createdAt: _c, ...cfgSnap } = config;
            const rec: RunRecord = {
              id: `run-${randomUUID().slice(0, 8)}`, experimentId: exp.id, taskId: task.id, configId: config.id, trial, runner: config.runner,
              startedAt, finishedAt: new Date().toISOString(), result, grades: g.grades, passed: g.passed, toolScore: g.toolScore, quality: g.quality, metrics: g.metrics,
              costUsd: costOf(result, config.pricing), failureReasons: g.failureReasons,
              taskSnapshot: { id: task.id, name: task.name, prompt: task.prompt, setupPrompts: task.setupPrompts, graders: task.graders, judgeRubric: task.judgeRubric, expected: task.expected, judgeMetrics: task.judgeMetrics, elicitPlan: task.elicitPlan, nonce },
              configSnapshot: cfgSnap,
            };
            this.db.put('runs', rec, exp.id);
            if (g.passed) counters.passed++; else counters.failed++;
            counters.tokens += result.inputTokens + result.outputTokens;
            counters.costUsd += rec.costUsd;
            exp.progress.done++;
            this.trace.event('run.finished', { n, total, config: config.id, task: task.id, trial, passed: g.passed, agentMs, agentError: !!result.error, judgeFailures: counters.judgeFailed }, exp.id);
            emit(g.passed ? 'ok' : 'warn', 'run_done', `${g.passed ? 'PASS' : 'FAIL'} · ${config.name} · ${task.name}${g.passed ? '' : ` — ${clip(g.failureReasons[0] ?? 'see run', 160)}`}`, { runId: rec.id });
          }
        }
      }
      exp.status = 'completed';
      exp.live = undefined;
      this.trace.event('experiment.finished', { status: 'completed', ...counters }, exp.id);
      emit('ok', 'done', `Completed: ${counters.passed} passed, ${counters.failed} failed · agent errors ${counters.agentFailed} · judge call failures ${counters.judgeFailed}.`);
    } catch (e) {
      exp.status = 'failed';
      exp.error = (e as Error).message;
      exp.live = undefined;
      this.trace.event('experiment.failed', { error: exp.error }, exp.id);
      emit('error', 'failed', `Experiment failed: ${exp.error}`);
    }
    exp.live = undefined;
    exp.finishedAt = new Date().toISOString();
    save();
  }

  /** On startup, an experiment still marked running was interrupted by a restart: fail it so no spinner hangs forever. */
  onModuleInit() {
    for (const e of this.db.list<Experiment>('experiments')) {
      if (e.status !== 'running') continue;
      e.status = 'failed';
      e.error = 'Interrupted: the server restarted while this experiment was running.';
      e.live = undefined;
      e.finishedAt = new Date().toISOString();
      (e.events ??= []).push({ t: e.finishedAt, level: 'error', kind: 'failed', message: e.error });
      this.db.put('experiments', e);
    }
  }

  summaries(runs: RunRecord[]) {
    const names = new Map(this.db.list<AgentConfig>('configs').map((c) => [c.id, c.name]));
    return [...new Set(runs.map((r) => r.configId))].map((id) => summarize(runs, id, names.get(id) ?? id));
  }

  comparison(id: string, aId?: string, bId?: string): Comparison {
    const exp = this.get(id);
    const a = aId ?? exp.configIds[0];
    const b = bId ?? exp.configIds[1];
    if (!exp.configIds.includes(a) || !exp.configIds.includes(b) || a === b) throw new BadRequestException('a and b must be two different configs of this experiment');
    const runs = this.runs(id);
    const sums = this.summaries(runs);
    const sa = sums.find((s) => s.configId === a) ?? summarize([], a, a);
    const sb = sums.find((s) => s.configId === b) ?? summarize([], b, b);
    const tasks = exp.taskIds.map((t) => this.db.get<Task>('tasks', t)).filter((t): t is Task => !!t);
    return compare(id, runs, tasks, sa, sb);
  }

  overview(): Overview {
    const exps = this.list();
    const runs = this.db.list<RunRecord>('runs');
    const tasks = new Map(this.db.list<Task>('tasks').map((t) => [t.id, t]));
    const hardest = [...new Set(runs.map((r) => r.taskId))].map((taskId) => {
      const rs = runs.filter((r) => r.taskId === taskId);
      const failures = rs.filter((r) => !r.passed);
      return { taskId, taskName: tasks.get(taskId)?.name ?? taskId, passRate: 1 - failures.length / rs.length, runs: rs.length, topFailure: failures[0]?.failureReasons[0] };
    }).sort((x, y) => x.passRate - y.passRate).slice(0, 5);
    const regressions: Overview['recentRegressions'] = [];
    for (const e of exps.filter((x) => x.status === 'completed').slice(0, 3)) {
      const cmp = this.comparison(e.id, e.configIds[0], e.configIds[1]);
      for (const t of cmp.tasks.filter((x) => x.status === 'regression')) {
        regressions.push({ experimentId: e.id, experimentName: e.name, taskId: t.taskId, taskName: t.taskName, delta: t.delta!, aName: cmp.a.configName, bName: cmp.b.configName });
      }
    }
    return {
      experiments: exps.length, runs: runs.length, leaderboard: this.summaries(runs).sort((x, y) => y.passRate - x.passRate),
      latestExperimentId: exps.find((e) => e.status === 'completed')?.id ?? null, hardestTasks: hardest, recentRegressions: regressions.slice(0, 6),
      dataMode: { mockRuns: runs.filter((r) => r.runner === 'mock').length, hermesRuns: runs.filter((r) => r.runner === 'hermes').length },
    };
  }
}
