import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { AgentRunResult, GraderSpec } from '../domain/types';
import { DeterministicSpec, runDeterministicGrader } from './deterministic';
import { MockJudge, parseJudgeJson } from './judge';
import { GradingService } from './grading.service';

const res = (output: string, tools: { tool: string; args?: unknown }[] = [], error?: string): AgentRunResult => ({
  output, error, latencyMs: 1, inputTokens: 1, outputTokens: 1, retries: 0, simulated: false,
  trace: tools.map((t, i) => ({ t: i, type: 'tool_call' as const, callId: `c${i}`, tool: t.tool, args: t.args ?? {} })),
});
const g = (s: GraderSpec, r: AgentRunResult) => runDeterministicGrader(s as DeterministicSpec, r);
const noTc = async () => { throw new Error('n/a'); };

describe('deterministic graders', () => {
  it('contains is case-insensitive by default and honours caseSensitive', () => {
    const s = { id: 'a', type: 'contains', dimension: 'success', value: 'Canberra' } as const;
    assert.equal(g(s, res('it is CANBERRA')).passed, true);
    assert.equal(g({ ...s, caseSensitive: true }, res('it is CANBERRA')).passed, false);
  });
  it('not_contains fails when forbidden text appears', () => {
    assert.equal(g({ id: 'a', type: 'not_contains', dimension: 'success', value: 'sk-' }, res('key sk-123')).passed, false);
  });
  it('regex matches and reports evidence; empty output fails', () => {
    const s = { id: 'a', type: 'regex', dimension: 'success', pattern: '\\b29\\b' } as const;
    assert.equal(g(s, res('29 days')).passed, true);
    const bad = g(s, res(''));
    assert.equal(bad.passed, false);
    assert.match(bad.evidence, /did not match/);
  });
  it('tool_called checks name and args; tool_not_called / max_tool_calls', () => {
    const r = res('x', [{ tool: 'read_file', args: { path: 'notes.txt' } }]);
    assert.equal(g({ id: 'a', type: 'tool_called', dimension: 'tool', tool: 'read_file', argsContain: 'notes.txt' }, r).passed, true);
    assert.equal(g({ id: 'a', type: 'tool_called', dimension: 'tool', tool: 'read_file', argsContain: 'other' }, r).passed, false);
    assert.equal(g({ id: 'a', type: 'tool_not_called', dimension: 'tool', tool: 'read_file' }, r).passed, false);
    assert.equal(g({ id: 'a', type: 'max_tool_calls', dimension: 'tool', max: 0 }, r).passed, false);
  });
});

describe('judge schema validation', () => {
  it('accepts valid JSON, even wrapped in prose', () => {
    assert.deepEqual(parseJudgeJson('Here: {"score": 4, "evidence": "ok"}'), { score: 4, evidence: 'ok' });
  });
  it('rejects out-of-range, non-integer, missing evidence and non-JSON', () => {
    assert.throws(() => parseJudgeJson('{"score": 9, "evidence": "x"}'));
    assert.throws(() => parseJudgeJson('{"score": 3.5, "evidence": "x"}'));
    assert.throws(() => parseJudgeJson('{"score": 3}'));
    assert.throws(() => parseJudgeJson('no json'));
  });
});

describe('GradingService', () => {
  const task = { prompt: 'p', judgeRubric: 'mentions canberra capital', graders: [
    { id: 'ok', type: 'contains', dimension: 'success', value: 'canberra' },
    { id: 't', type: 'tool_called', dimension: 'tool', tool: 'x' },
  ] as GraderSpec[] };
  it('passes on success graders only; tool score is separate; judge is labelled mock', async () => {
    const out = await new GradingService(new MockJudge()).grade(task, res('Canberra is the capital'));
    assert.equal(out.passed, true);
    assert.equal(out.toolScore, 0);
    assert.ok(out.quality !== null);
    assert.equal(out.grades.at(-1)!.judge!.mode, 'mock');
  });
  it('an execution error fails the run and skips the judge', async () => {
    const out = await new GradingService(new MockJudge()).grade(task, res('Canberra', [], 'boom'));
    assert.equal(out.passed, false);
    assert.equal(out.quality, null);
    assert.match(out.failureReasons[0], /boom/);
  });
  it('simulated (mock-runner) results are judged by the mock judge even when a real judge is configured', async () => {
    const real = { mode: 'anthropic' as const, model: 'm', judge: async () => { throw new Error('must not be called'); }, judgeToolCalls: noTc };
    const out = await new GradingService(real).grade(task, { ...res('Canberra capital'), simulated: true });
    assert.equal(out.grades.at(-1)!.judge!.mode, 'mock');
  });
  it('a throwing judge records an error without failing deterministic result', async () => {
    const bad = { mode: 'mock' as const, model: 'm', judge: async () => { throw new Error('schema'); }, judgeToolCalls: noTc };
    const out = await new GradingService(bad).grade(task, res('canberra'));
    assert.equal(out.passed, true);
    assert.equal(out.quality, null);
    assert.equal(out.grades.at(-1)!.error, 'schema');
  });
});

describe('tool graders: wildcard, min_tool_calls, required gating', () => {
  const withTool = res('Example Domain', [{ tool: 'web_extract', args: { urls: ['https://example.com'] } }]);
  it("tool '*' matches any tool name but still checks args", () => {
    assert.equal(g({ id: 'a', type: 'tool_called', dimension: 'tool', tool: '*', argsContain: 'example.com' }, withTool).passed, true);
    assert.equal(g({ id: 'a', type: 'tool_called', dimension: 'tool', tool: '*', argsContain: 'other.org' }, withTool).passed, false);
    assert.equal(g({ id: 'a', type: 'tool_called', dimension: 'tool', tool: '*' }, res('x')).passed, false);
  });
  it('min_tool_calls requires at least N calls', () => {
    assert.equal(g({ id: 'a', type: 'min_tool_calls', dimension: 'tool', min: 1 }, withTool).passed, true);
    assert.match(g({ id: 'a', type: 'min_tool_calls', dimension: 'tool', min: 1 }, res('guessed')).evidence, /without using tools/);
  });
  const task = { prompt: 'p', graders: [
    { id: 'ans', type: 'contains', dimension: 'success', value: 'Example Domain' },
    { id: 'fetched', type: 'tool_called', dimension: 'tool', tool: '*', argsContain: 'example.com', required: true },
  ] as GraderSpec[] };
  it('a required tool grader makes a correct-but-unverified answer FAIL', async () => {
    const out = await new GradingService(new MockJudge()).grade(task, res('Example Domain'));
    assert.equal(out.passed, false);
    assert.match(out.failureReasons.join(' '), /fetched/);
  });
  it('a non-required tool grader does not gate pass/fail', async () => {
    const t = { ...task, graders: [task.graders[0], { ...task.graders[1], required: false } as GraderSpec] };
    assert.equal((await new GradingService(new MockJudge()).grade(t, res('Example Domain'))).passed, true);
  });
  it('passes when the answer is right and the required tool use is proven', async () => {
    assert.equal((await new GradingService(new MockJudge()).grade(task, withTool)).passed, true);
  });
});
