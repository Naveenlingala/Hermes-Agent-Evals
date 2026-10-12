import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { ExperimentsService } from './experiments/experiments.service';

describe('API (in-memory DB, mock runner)', () => {
  let app: INestApplication; let base: string;
  before(async () => {
    process.env.DB_FILE = ':memory:';
    process.env.JUDGE_MODE = 'mock';
    process.env.HERMES_BIN = 'definitely-not-hermes-bin'; // must be set before the runner is constructed
    const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = mod.createNestApplication();
    await app.init(); await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  after(async () => { await app.close(); });
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } }); return { status: r.status, body: (await r.json()) as any }; };

  it('seeds tasks, configs and a completed demo experiment', async () => {
    assert.equal((await j('/api/tasks')).body.length, 22);
    const exps = (await j('/api/experiments')).body;
    assert.equal(exps.length, 2);
    assert.ok(exps.every((e: any) => e.status === 'completed' && e.seeded));
    assert.equal(exps.find((e: any) => e.configIds.length === 3).progress.done, 99);
  });
  it('compares two configs with uncertainty and exposes run traces', async () => {
    const e = (await j('/api/experiments')).body.find((x: any) => x.configIds.length === 3);
    const cmp = (await j(`/api/experiments/${e.id}/comparison?a=cfg-baseline&b=cfg-strong`)).body;
    assert.equal(cmp.tasks.length, 11);
    assert.equal(cmp.wins + cmp.losses + cmp.ties, 11);
    const keys = cmp.metrics.map((m: any) => m.metric);
    for (const k of ['toolCorrectness', 'argumentCorrectness', 'stepEfficiency', 'planQuality', 'planAdherence', 'taskCompletion']) assert.ok(keys.includes(k), k);
    assert.equal(cmp.uncertainty.sufficient, true);
    const detail = (await j(`/api/experiments/${e.id}`)).body;
    const run = (await j(`/api/runs/${detail.runs[0].id}`)).body;
    assert.ok(run.grades.length > 0 && run.configSnapshot && run.taskSnapshot);
  });
  it('stores toolsets/skills/memory on configs and snapshots them on runs; validates them', async () => {
    const ok = await j('/api/configs', { method: 'POST', body: JSON.stringify({ name: 'c', runner: 'mock', model: 'm', inputPerMTok: 1, outputPerMTok: 1, toolsets: ['web'], skills: ['math-helper'], memory: 'off', maxTurns: 5 }) });
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.body.toolsets, ok.body.skills, ok.body.memory, ok.body.maxTurns], [['web'], ['math-helper'], 'off', 5]);
    const bad = await j('/api/configs', { method: 'POST', body: JSON.stringify({ name: 'c', runner: 'mock', model: 'm', inputPerMTok: 1, outputPerMTok: 1, toolsets: ['a b;rm'], memory: 'maybe' }) });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.errors.length, 2);
  });
  it('tools ablation: removing a required toolset makes the task fail in the mock run', async () => {
    const ab = (await j('/api/experiments')).body.find((x: any) => x.configIds.includes('cfg-baseline-web'));
    const cmp = (await j(`/api/experiments/${ab.id}/comparison?a=cfg-baseline&b=cfg-baseline-web`)).body;
    const t = cmp.tasks.find((x: any) => x.taskId === 'efficient-lookup');
    assert.equal(t.passRateA, 0);
    assert.ok(t.passRateB > 0.5);
  });
  it('refuses real-only tasks on mock configs, with a clear message', async () => {
    const r = await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'x', taskIds: ['real-mul-1', 'capital-city'], configIds: ['cfg-baseline', 'cfg-strong'] }) });
    assert.equal(r.status, 400);
    assert.match(r.body.errors[0], /no mock scenario.*Terminal arithmetic 1/);
  });
  it('accepts setupPrompts on tasks, rejects too many, and exposes the real-only seed tasks', async () => {
    const mk = (extra: any) => j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: 'n', prompt: 'p', graders: [{ type: 'contains', value: 'x' }], ...extra }) });
    assert.equal((await mk({ setupPrompts: ['remember {{nonce}}'] })).body.setupPrompts[0], 'remember {{nonce}}');
    assert.equal((await mk({ setupPrompts: ['a', 'b', 'c', 'd'] })).status, 400);
    const mem = (await j('/api/tasks/real-memory-codename')).body;
    assert.equal(mem.setupPrompts.length, 1);
    assert.equal(mem.mock, undefined);
  });
  it('creates a criteria-only (non-deterministic) task and validates criteria/expected/judgeMetrics', async () => {
    const mk = (b: any) => j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: 'n', prompt: 'p', ...b }) });
    const ok = await mk({ criteria: ['Mentions the capital', 'Is polite'], expected: { tools: [{ tool: 'web_extract', args: { urls: 'example.com' } }], optimalSteps: 2 }, judgeMetrics: { stepEfficiency: true, bogus: true } });
    assert.equal(ok.status, 201);
    assert.deepEqual(ok.body.graders.map((g: any) => [g.type, g.passScore]), [['llm_criterion', 4], ['llm_criterion', 4]]);
    assert.deepEqual(ok.body.judgeMetrics, { stepEfficiency: true });
    assert.equal((await mk({})).status, 400, 'needs a grader or a criterion');
    assert.equal((await mk({ criteria: ['1', '2', '3', '4', '5', '6'] })).status, 400);
    assert.equal((await mk({ criteria: ['ok'], expected: { tools: [{ tool: '' }] } })).status, 400);
    assert.equal((await mk({ criteria: ['ok'], expected: { optimalSteps: 0 } })).status, 400);
  });
  it('mock runs carry trajectory/component metrics and per-call rows; criteria-only seed task is graded by the (mock) judge', async () => {
    const e = (await j('/api/experiments')).body.find((x: any) => x.configIds.length === 3);
    const runs = (await j(`/api/experiments/${e.id}`)).body.runs;
    const fs = runs.find((r: any) => r.taskId === 'file-summary' && r.configId === 'cfg-baseline');
    const m = (await j(`/api/runs/${fs.id}`)).body.metrics;
    assert.equal(m.plan.source, 'narration');
    assert.ok(m.toolCorrectness.value !== null && m.calls.length >= 1);
    assert.equal(m.planAdherence.source, 'llm', 'opted in via judgeMetrics; judged by the mock judge for simulated runs');
    assert.ok(m.calls[0].llmToolOk !== undefined);
    const cr = runs.find((r: any) => r.taskId === 'criteria-destructive');
    const full = (await j(`/api/runs/${cr.id}`)).body;
    const g = full.grades.filter((x: any) => x.type === 'llm_criterion');
    assert.equal(g.length, 2);
    assert.ok(g.every((x: any) => x.judge.mode === 'mock'));
  });
  it('rejects invalid input with a 400 and a list of errors', async () => {
    const r = await j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: '', graders: [{ type: 'regex', pattern: '(' }] }) });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.length >= 2);
    assert.equal((await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'x', taskIds: ['nope'], configIds: ['cfg-baseline', 'cfg-strong'] }) })).status, 400);
    assert.equal((await j('/api/runs/missing')).status, 404);
  });
  it('a hermes config with no Hermes installed yields graded failures, not a crash', async () => {
    const r = await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'real', taskIds: ['capital-city'], configIds: ['cfg-baseline', 'cfg-hermes'], trials: 1 }) });
    assert.equal(r.status, 201);
    await app.get(ExperimentsService).settled(r.body.id);
    const d = (await j(`/api/experiments/${r.body.id}`)).body;
    assert.equal(d.experiment.status, 'completed');
    assert.equal(d.experiment.mode, 'mixed');
    const h = d.runs.find((x: any) => x.runner === 'hermes');
    assert.equal(h.passed, false);
    assert.match(h.failureReasons[0], /Could not start/);
  });
  it('overview aggregates leaderboard and labels mock data', async () => {
    const o = (await j('/api/overview')).body;
    assert.ok(o.leaderboard.length >= 3);
    assert.ok(o.dataMode.mockRuns >= 190);
  });
});
