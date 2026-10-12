import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Judge, JudgeInput, JudgeVerdict } from './judge';
import { MockJudge } from './judge';
import { GOLDEN, GOLDEN_TOOL_CALLS } from './judge-golden';
import { evaluateJudge } from './judge-eval';

const make = (fn: (i: JudgeInput, n: number) => number | Error): Judge => {
  let n = 0;
  return { mode: 'mock', model: 'fake', judgeToolCalls: async () => { throw new Error('n/a'); }, judge: async (i): Promise<JudgeVerdict> => { const r = fn(i, n++); if (r instanceof Error) throw r; return { score: r, evidence: 'e', mode: 'mock', model: 'fake', usage: { input: 10, output: 2 } }; } };
};
const oracle = make((i) => { const c = GOLDEN.find((g) => g.output === i.output)!; return Math.round((c.expected.min + c.expected.max) / 2); });

describe('golden set', () => {
  it('is well-formed: unique ids, valid bands, all four categories, injection cases present', () => {
    assert.equal(new Set(GOLDEN.map((g) => g.id)).size, GOLDEN.length);
    for (const g of GOLDEN) assert.ok(g.expected.min >= 1 && g.expected.max <= 5 && g.expected.min <= g.expected.max, g.id);
    assert.deepEqual([...new Set(GOLDEN.map((g) => g.category))].sort(), ['correct', 'injection', 'partial', 'wrong']);
    assert.ok(GOLDEN.filter((g) => g.category === 'injection').length >= 3);
  });
});

describe('evaluateJudge', () => {
  it('a faithful judge passes every check', async () => {
    const r = await evaluateJudge(oracle, GOLDEN, { repeats: 3 });
    assert.equal(r.passed, true, JSON.stringify(r.checks));
    assert.equal(r.metrics.calls, GOLDEN.length * 3);
    assert.equal(r.metrics.usage.input, GOLDEN.length * 3 * 10);
  });
  it('a judge that always says 5 fails discrimination, bands and injection resistance', async () => {
    const r = await evaluateJudge(make(() => 5), GOLDEN, { repeats: 2 });
    assert.equal(r.passed, false);
    const failed = r.checks.filter((c) => !c.passed).map((c) => c.name);
    assert.ok(failed.includes('Resists answer-side prompt injection'));
    assert.ok(failed.includes('Separates correct from wrong answers'));
  });
  it('an injectable judge (high score when the answer demands one) is caught', async () => {
    const injectable = make((i) => (/score of 5|"score": 5|maximum score/i.test(i.output) ? 5 : Math.round((GOLDEN.find((g) => g.output === i.output)!.expected.min + GOLDEN.find((g) => g.output === i.output)!.expected.max) / 2)));
    const r = await evaluateJudge(injectable, GOLDEN, { repeats: 1 });
    assert.equal(r.metrics.injectionResisted.passed, 0);
    assert.equal(r.checks.find((c) => c.name.startsWith('Resists'))!.passed, false);
  });
  it('an unstable judge (random 1 vs 5) fails the stability check', async () => {
    const r = await evaluateJudge(make((_, n) => (n % 2 ? 1 : 5)), GOLDEN, { repeats: 2 });
    assert.equal(r.checks.find((c) => c.name.startsWith('Stable'))!.passed, false);
  });
  it('a judge that throws counts as schema-invalid and cannot pass', async () => {
    const r = await evaluateJudge(make(() => new Error('bad json')), GOLDEN, { repeats: 1 });
    assert.equal(r.metrics.schemaValidRate, 0);
    assert.equal(r.passed, false);
    assert.equal(r.cases[0].errors[0], 'bad json');
  });
  it('the keyword mock judge is NOT a calibrated judge (the harness must reject it)', async () => {
    const r = await evaluateJudge(new MockJudge(), GOLDEN, { repeats: 1 });
    assert.equal(r.passed, false);
  });
});

describe('evaluateJudge: new judge kinds and per-call verdicts', () => {
  const kinds = [...new Set(GOLDEN.map((g) => g.kind ?? 'rubric'))];
  it('golden set covers rubric, criterion, step efficiency, plan quality and plan adherence', () => {
    assert.deepEqual(kinds.sort(), ['criterion', 'plan_adherence', 'plan_quality', 'rubric', 'step_efficiency']);
    for (const g of GOLDEN.filter((c) => c.kind === 'plan_quality' || c.kind === 'plan_adherence')) assert.ok(g.plan, g.id);
    for (const g of GOLDEN.filter((c) => c.kind === 'step_efficiency' || c.kind === 'plan_adherence')) assert.ok(g.trace, g.id);
    assert.equal(new Set(GOLDEN.map((g) => g.id)).size, GOLDEN.length);
    assert.equal(new Set(GOLDEN.map((g) => g.output)).size, GOLDEN.length, 'unique outputs (the oracle keys on them)');
  });
  const truthful: Judge = { ...oracle, judgeToolCalls: async (i) => {
    const c = GOLDEN_TOOL_CALLS.find((x) => x.taskPrompt === i.taskPrompt && x.trace === i.trace)!;
    return { calls: i.calls.map((x) => ({ index: x.index, toolOk: c.expected.find((e) => e.index === x.index)!.toolOk ?? true, argsOk: c.expected.find((e) => e.index === x.index)!.argsOk ?? true, evidence: 'e' })), mode: 'mock', model: 'fake' };
  } };
  it('a faithful judge passes every check including per-kind agreement and per-call verdicts', async () => {
    const r = await evaluateJudge(truthful, GOLDEN, { repeats: 2, toolCallCases: GOLDEN_TOOL_CALLS });
    assert.equal(r.passed, true, JSON.stringify(r.checks.filter((c) => !c.passed)));
    assert.equal(r.metrics.toolCalls!.accuracy, 1);
    assert.ok(r.checks.some((c) => c.name === "Agreement on 'criterion' prompts"));
  });
  it('a judge that approves every tool call fails the per-call check', async () => {
    const lenient: Judge = { ...truthful, judgeToolCalls: async (i) => ({ calls: i.calls.map((x) => ({ index: x.index, toolOk: true, argsOk: true, evidence: 'fine' })), mode: 'mock', model: 'fake' }) };
    const r = await evaluateJudge(lenient, GOLDEN, { repeats: 1, toolCallCases: GOLDEN_TOOL_CALLS });
    assert.equal(r.checks.find((c) => c.name.startsWith('Per-call'))!.passed, false);
  });
  it('a judge that cannot return valid per-call JSON is schema-invalid', async () => {
    const broken: Judge = { ...truthful, judgeToolCalls: async () => { throw new Error('bad shape'); } };
    const r = await evaluateJudge(broken, GOLDEN, { repeats: 1, toolCallCases: GOLDEN_TOOL_CALLS });
    assert.equal(r.metrics.toolCalls!.schemaValidRate, 0);
    assert.equal(r.passed, false);
  });
  it('an always-5 judge fails a specific kind (criteria), not just overall', async () => {
    const r = await evaluateJudge(make(() => 5), GOLDEN, { repeats: 1 });
    assert.equal(r.checks.find((c) => c.name === "Agreement on 'criterion' prompts")!.passed, false);
  });
});
