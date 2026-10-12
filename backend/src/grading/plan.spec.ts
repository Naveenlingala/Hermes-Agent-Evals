import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import type { AgentRunResult, TraceEvent } from '../domain/types';
import { ExperimentsService } from '../experiments/experiments.service';
import { RUNNERS } from '../runner/runner';
import { PLAN_INSTRUCTION } from '../tasks/template';
import { GradingService } from './grading.service';
import { MockJudge } from './judge';
import { METRIC_CATALOG } from './metric-catalog';
import { extractPlan } from './trajectory';

const call = (callId: string, tool: string, args: unknown = {}): TraceEvent => ({ t: 0, type: 'tool_call', callId, tool, args });
const say = (content: string): TraceEvent => ({ t: 0, type: 'message', role: 'assistant', content });
const run = (tr: TraceEvent[]): AgentRunResult => ({ output: 'ok', trace: tr, latencyMs: 1, inputTokens: 1, outputTokens: 1, retries: 0, simulated: false });
const base = { prompt: 'p', graders: [{ id: 'd', type: 'contains' as const, dimension: 'success' as const, value: 'ok' }] };
const svc = () => new GradingService(new MockJudge());

describe('plan N/A reasons are actionable', () => {
  const on = { planQuality: true, planAdherence: true };
  it('not enabled -> tells the user to enable the LLM option and plan elicitation', async () => {
    const m = (await svc().grade(base, run([call('1', 'x')]))).metrics;
    assert.equal(m.planQuality.value, null);
    assert.match(m.planQuality.reason!, /Not enabled.*Ask the agent to state a plan first/);
  });
  it('enabled, tools used, no plan, not elicited -> says Hermes does not plan by default and what to enable', async () => {
    const m = (await svc().grade({ ...base, judgeMetrics: on }, run([call('1', 'x')]))).metrics;
    assert.match(m.planAdherence.reason!, /did not state a plan on its own.*Enable "Ask the agent to state a plan first"/);
  });
  it('enabled, elicited, still no plan -> says the model ignored the instruction', async () => {
    const m = (await svc().grade({ ...base, judgeMetrics: on, elicitPlan: true }, run([call('1', 'x')]))).metrics;
    assert.match(m.planQuality.reason!, /asked to state a plan but did not/);
  });
  it('enabled, no tool calls -> says there is nothing to follow', async () => {
    const m = (await svc().grade({ ...base, judgeMetrics: on, elicitPlan: true }, run([]))).metrics;
    assert.match(m.planQuality.reason!, /no tool calls/);
  });
  it('a stated plan produces a score and no reason', async () => {
    const m = (await svc().grade({ ...base, judgeMetrics: on, elicitPlan: true }, run([say('Plan:\n1. Use x to fetch\n2. Reply'), call('1', 'x')]))).metrics;
    assert.equal(m.planQuality.source, 'llm');
    assert.equal(m.planQuality.reason, undefined);
    assert.ok(m.planQuality.value !== null && m.planAdherence.value !== null);
  });
});

describe('plan extraction accepts common plan formats', () => {
  it('"Step 1:", "1)", bullets, and a plan mixed with other narration', () => {
    for (const text of ['Step 1: fetch the page\nStep 2: read the title', '1) fetch the page\n2) read the title', '- fetch the page\n- read the title', "Sure! Here's my plan:\n1. fetch\n2. read\nLet me start."]) {
      assert.equal(extractPlan([say(text), call('1', 'x')])?.source, 'narration', text);
    }
  });
  it('plain chatter is not a plan', () => assert.equal(extractPlan([say('Okay, working on it now.'), call('1', 'x')]), null));
});

describe('metric catalog', () => {
  it('has complete, non-empty entries with unique keys', () => {
    assert.equal(new Set(METRIC_CATALOG.map((m) => m.key)).size, METRIC_CATALOG.length);
    for (const m of METRIC_CATALOG) for (const f of ['key', 'group', 'label', 'summary', 'howComputed', 'deterministic', 'llm', 'direction', 'badMeans', 'naMeans', 'example'] as const) assert.ok(String(m[f]).trim().length > 3, `${m.key}.${f}`);
  });
});

describe('plan elicitation + catalog coverage (API, in-memory)', () => {
  let app: INestApplication; let base: string; const prompts: string[] = [];
  before(async () => {
    process.env.DB_FILE = ':memory:'; process.env.JUDGE_MODE = 'mock';
    const rec = { kind: 'mock' as const, run: async (req: any): Promise<AgentRunResult> => { prompts.push(req.task.prompt); return { output: 'Example Domain', trace: [], latencyMs: 1, inputTokens: 1, outputTokens: 1, retries: 0, simulated: true }; } };
    const mod = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(RUNNERS).useValue({ mock: rec, hermes: rec }).compile();
    app = mod.createNestApplication(); await app.init(); await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  after(async () => { await app.close(); });
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } }); return { status: r.status, body: (await r.json()) as any }; };

  it('every metric the comparison can show has a catalog entry served by /api/evaluators', async () => {
    const e = (await j('/api/experiments')).body.find((x: any) => x.configIds.length === 3);
    const keys = (await j(`/api/experiments/${e.id}/comparison?a=cfg-baseline&b=cfg-strong`)).body.metrics.map((m: any) => m.metric);
    const served = (await j('/api/evaluators')).body.metrics.map((m: any) => m.key);
    for (const k of keys) assert.ok(served.includes(k), `missing catalog entry for ${k}`);
  });
  it('elicitPlan is validated (only boolean true is kept) and the real web seed tasks opt in', async () => {
    const mk = (extra: any) => j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: 'n', prompt: 'p', graders: [{ type: 'contains', value: 'x' }], ...extra }) });
    assert.equal((await mk({ elicitPlan: true })).body.elicitPlan, true);
    assert.equal((await mk({ elicitPlan: 'yes' })).body.elicitPlan, undefined);
    assert.equal((await j('/api/tasks/real-web-example')).body.elicitPlan, true);
  });
  it('the agent receives the plan instruction; grading, the stored prompt and the run snapshot keep the original prompt', async () => {
    const t = (await j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: 'plan task', prompt: 'Fetch example.com', elicitPlan: true, graders: [{ type: 'contains', value: 'Example Domain' }] }) })).body;
    const e = await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'p', taskIds: [t.id], configIds: ['cfg-baseline', 'cfg-strong'], trials: 1 }) });
    assert.equal(e.status, 400, 'a task without a mock scenario cannot run on mock configs');
    // run it through the service with a mock scenario attached so the (fake) runner is used
    const svc = app.get(ExperimentsService) as any;
    svc.db.put('tasks', { ...t, mock: { difficulty: 0, good: { output: 'Example Domain', tools: [] }, bad: { output: 'x', tools: [] } } });
    prompts.length = 0;
    const exp = svc.create({ name: 'p', taskIds: [t.id], configIds: ['cfg-baseline', 'cfg-strong'], trials: 1 });
    await svc.settled(exp.id);
    assert.equal(prompts.length, 2);
    for (const p of prompts) assert.equal(p, 'Fetch example.com' + PLAN_INSTRUCTION);
    const runs = (await j(`/api/experiments/${exp.id}`)).body.runs;
    const full = (await j(`/api/runs/${runs[0].id}`)).body;
    assert.equal(full.taskSnapshot.prompt, 'Fetch example.com');
    assert.equal(full.taskSnapshot.elicitPlan, true);
    assert.equal(full.passed, true, 'graded against the original task');
    assert.match(full.result.trace[0].content, /plan requested.*appended to the prompt/);
  });
});
