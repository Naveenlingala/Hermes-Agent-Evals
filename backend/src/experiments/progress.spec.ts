import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { DbService } from '../db/db.service';
import type { AgentRunResult, Experiment } from '../domain/types';
import { GradingService, JudgeCallEvent } from '../grading/grading.service';
import { MockJudge } from '../grading/judge';
import { MockRunner } from '../runner/mock.runner';
import { RUNNERS } from '../runner/runner';
import { ExperimentsService } from './experiments.service';

describe('live experiment progress', () => {
  let app: INestApplication; let base: string;
  // A runner we can hold open, to observe the "now testing" state mid-run.
  let release: () => void = () => {};
  let gate = Promise.resolve();
  let hold = false;
  const mock = new MockRunner();
  const controllable = { kind: 'mock' as const, run: async (req: any): Promise<AgentRunResult> => { if (hold) await gate; return mock.run(req); } };

  before(async () => {
    process.env.DB_FILE = ':memory:'; process.env.JUDGE_MODE = 'mock';
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RUNNERS).useValue({ mock: controllable, hermes: controllable }).compile();
    app = mod.createNestApplication();
    await app.init(); await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  after(async () => { await app.close(); });
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } }); return { status: r.status, body: (await r.json()) as any }; };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it('a finished experiment has counters that add up, a capped event log with all event kinds, and no live state', async () => {
    const e = (await j('/api/experiments')).body.find((x: any) => x.configIds.length === 3);
    const d = (await j(`/api/experiments/${e.id}`)).body.experiment as Experiment;
    assert.equal(d.status, 'completed');
    assert.equal(d.live, undefined);
    const c = d.counters!;
    assert.equal(c.passed + c.failed, 99);
    assert.equal(c.agentOk + c.agentFailed, 99);
    assert.ok(c.judgeOk > 0, 'mock judge calls were counted');
    assert.equal(c.judgeFailed, 0);
    assert.ok(c.tokens > 0);
    assert.equal(d.events!.length, 150, 'capped at the last 150');
    const kinds = new Set(d.events!.map((x) => x.kind));
    for (const k of ['run_start', 'agent_done', 'judge_call', 'run_done', 'done']) assert.ok(kinds.has(k), k);
    assert.match(d.events!.at(-1)!.message, /^Completed: \d+ passed, \d+ failed/);
  });

  it('the list endpoint omits events (small payload) but keeps counters; the detail endpoint has them', async () => {
    const e = (await j('/api/experiments')).body[0];
    assert.equal('events' in e, false);
    assert.ok(e.counters);
    assert.ok((await j(`/api/experiments/${e.id}`)).body.experiment.events.length > 0);
  });

  it('mid-run: "now testing" shows agent, task, trial and phase; events and counters update; live clears at the end', async () => {
    hold = true; gate = new Promise<void>((r) => { release = r; });
    const created = await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'live', taskIds: ['capital-city', 'sum-invoice'], configIds: ['cfg-baseline', 'cfg-strong'], trials: 2 }) });
    assert.equal(created.status, 201);
    const id = created.body.id;
    await sleep(150);
    const mid = (await j(`/api/experiments/${id}`)).body.experiment as Experiment;
    assert.equal(mid.status, 'running');
    assert.equal(mid.live?.phase, 'agent');
    assert.deepEqual([mid.live?.runNumber, mid.live?.total, mid.live?.trial, mid.live?.trials], [1, 8, 1, 2]);
    assert.ok(mid.live?.configName && mid.live?.taskName);
    assert.ok(mid.events!.some((e) => e.kind === 'run_start' && /Run 1\/8/.test(e.message)));
    assert.equal(mid.progress.done, 0);
    hold = false; release();
    await app.get(ExperimentsService).settled(id);
    const end = (await j(`/api/experiments/${id}`)).body.experiment as Experiment;
    assert.equal(end.status, 'completed');
    assert.equal(end.live, undefined);
    assert.equal(end.counters!.passed + end.counters!.failed, 8);
    assert.equal(end.progress.done, 8);
  });

  it('an agent error is logged as an error event and counted', async () => {
    const failing = { kind: 'mock' as const, run: async (): Promise<AgentRunResult> => ({ output: '', trace: [], latencyMs: 0, inputTokens: 0, outputTokens: 0, retries: 0, simulated: true, error: 'provider exploded' }) };
    const svc = app.get(ExperimentsService) as any;
    const original = svc.runners;
    svc.runners = { mock: failing, hermes: failing };
    try {
      const e = svc.create({ name: 'err', taskIds: ['capital-city'], configIds: ['cfg-baseline', 'cfg-strong'], trials: 1 });
      await svc.settled(e.id);
      const d = (await j(`/api/experiments/${e.id}`)).body.experiment as Experiment;
      assert.equal(d.counters!.agentFailed, 2);
      assert.ok(d.events!.some((x) => x.level === 'error' && x.kind === 'agent_error' && /provider exploded/.test(x.message)));
      assert.ok(d.events!.some((x) => x.level === 'warn' && x.kind === 'run_done' && /^FAIL/.test(x.message)));
    } finally { svc.runners = original; }
  });

  it('on startup an experiment left "running" is failed with an explanation (no hung spinner)', () => {
    const db = app.get(DbService);
    const stale: Experiment = { id: 'exp-stale', name: 's', taskIds: [], configIds: [], trials: 1, status: 'running', progress: { done: 1, total: 4 }, createdAt: new Date().toISOString(), mode: 'mock', seeded: false, live: { phase: 'agent', runNumber: 2, total: 4, taskName: 't', configName: 'c', trial: 1, trials: 1, startedAt: '' } };
    db.put('experiments', stale);
    app.get(ExperimentsService).onModuleInit();
    const after = db.get<Experiment>('experiments', 'exp-stale')!;
    assert.equal(after.status, 'failed');
    assert.match(after.error!, /Interrupted/);
    assert.equal(after.live, undefined);
    assert.equal(after.events!.at(-1)!.level, 'error');
  });
});

describe('GradingService judge-call hooks', () => {
  const result: AgentRunResult = { output: 'x', trace: [], latencyMs: 1, inputTokens: 1, outputTokens: 1, retries: 0, simulated: false };
  const task = { prompt: 'p', graders: [{ id: 'c1', type: 'llm_criterion' as const, dimension: 'success' as const, criterion: 'Says x' }] };
  const judge = (fail: boolean) => ({ mode: 'anthropic' as const, model: 'm1', judgeToolCalls: async () => { throw new Error('n/a'); }, judge: async () => { if (fail) throw new Error('429 slow down'); return { score: 5, evidence: 'e', mode: 'anthropic' as const, model: 'm1' }; } });
  it('fires start then finish with label, duration, model and detail for a successful call', async () => {
    const log: string[] = []; const evs: JudgeCallEvent[] = [];
    await new GradingService(judge(false), new MockJudge()).grade(task, result, { onJudgeStart: (l, m) => log.push(`start ${l} ${m}`), onJudge: (e) => { evs.push(e); log.push('done'); } });
    assert.deepEqual(log, ['start criterion c1 m1', 'done']);
    assert.deepEqual([evs[0].ok, evs[0].label, evs[0].model, evs[0].detail], [true, 'criterion c1', 'm1', '5/5']);
    assert.ok(evs[0].ms >= 0);
  });
  it('reports a failing judge call (ok=false, error text) and the run still fails safely', async () => {
    const evs: JudgeCallEvent[] = [];
    const out = await new GradingService(judge(true), new MockJudge()).grade(task, result, { onJudge: (e) => evs.push(e) });
    assert.deepEqual([evs[0].ok, evs[0].detail], [false, '429 slow down']);
    assert.equal(out.passed, false);
  });
  it('works without hooks (unchanged behaviour)', async () => {
    assert.equal((await new GradingService(judge(false), new MockJudge()).grade(task, result)).passed, true);
  });
});
