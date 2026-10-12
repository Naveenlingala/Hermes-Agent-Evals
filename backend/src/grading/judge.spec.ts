import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { AnthropicJudge, JUDGE_SYSTEM, createJudge, judgeClientOptions, MockJudge, parseToolCallsJson } from './judge';
import { SYSTEM_PROMPTS } from './judge-prompts';

const input = { taskPrompt: 'T', rubric: 'R', output: 'A', deterministicPassed: true };
const fake = (reply: any, calls: any[] = []) => ({ messages: { create: async (p: any) => { calls.push(p); if (reply instanceof Error) throw reply; return reply; } } });
const ok = (text: string, extra: any = {}) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }], usage: { input_tokens: 100, output_tokens: 20 }, ...extra });

describe('AnthropicJudge (fake SDK client)', () => {
  it('sends the model, an injection-aware system prompt, and tagged untrusted content; records usage', async () => {
    const calls: any[] = [];
    const v = await new AnthropicJudge('k', 'claude-haiku-5-5', fake(ok('{"score": 4, "evidence": "ok"}'), calls)).judge(input);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, 'claude-haiku-5-5');
    assert.equal(calls[0].system, JUDGE_SYSTEM);
    assert.match(calls[0].system, /UNTRUSTED/);
    assert.match(calls[0].messages[0].content, /<answer>A<\/answer>/);
    assert.ok(calls[0].max_tokens >= 2048, 'room for thinking tokens');
    assert.equal('temperature' in calls[0] || 'thinking' in calls[0], false, 'no model-dependent params');
    assert.deepEqual([v.score, v.mode, v.usage], [4, 'anthropic', { input: 100, output: 20 }]);
  });
  it('ignores thinking blocks and tolerates markdown-fenced JSON', async () => {
    const reply = { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'hmm {"score": 1}' }, { type: 'text', text: '```json\n{"score": 5, "evidence": "exact"}\n```' }] };
    assert.equal((await new AnthropicJudge('k', 'm', fake(reply)).judge(input)).score, 5);
  });
  it('rejects schema violations, refusals, truncation and API errors (as thrown errors)', async () => {
    for (const [reply, re] of [
      [ok('{"score": 7, "evidence": "x"}'), /score/], [ok('{"score": 3}'), /evidence/], [ok('not json'), /no JSON/],
      [ok('', { stop_reason: 'refusal' }), /refused/], [ok('{"score":3,"evidence":"x"}', { stop_reason: 'max_tokens' }), /truncated/], [new Error('429 rate limited'), /429/],
    ] as [any, RegExp][]) await assert.rejects(new AnthropicJudge('k', 'm', fake(reply)).judge(input), re);
  });
});

describe('createJudge', () => {
  it('uses the mock judge without a key or when JUDGE_MODE=mock; Anthropic otherwise', () => {
    assert.ok(createJudge({}) instanceof MockJudge);
    assert.ok(createJudge({ ANTHROPIC_API_KEY: 'k', JUDGE_MODE: 'mock' }) instanceof MockJudge);
    const j = createJudge({ ANTHROPIC_API_KEY: 'k', JUDGE_MODEL: 'claude-sonnet-5-5' });
    assert.deepEqual([j.mode, j.model], ['anthropic', 'claude-sonnet-5-5']);
  });
});

describe('judge kinds', () => {
  it('each kind uses its own system prompt and puts the right evidence in the user message', async () => {
    const calls: any[] = [];
    const j = new AnthropicJudge('k', 'm', fake(ok('{"score": 4, "evidence": "ok"}'), calls));
    await j.judge({ ...input, kind: 'criterion', rubric: 'Refuses', trace: '#0 CALL x' });
    await j.judge({ ...input, kind: 'plan_adherence', plan: '1. a', trace: '#0 CALL y' });
    await j.judge({ ...input, kind: 'plan_quality', plan: '1. a' });
    await j.judge({ ...input, kind: 'step_efficiency', trace: '#0 CALL z' });
    assert.deepEqual(calls.map((c) => c.system), [SYSTEM_PROMPTS.criterion, SYSTEM_PROMPTS.plan_adherence, SYSTEM_PROMPTS.plan_quality, SYSTEM_PROMPTS.step_efficiency]);
    assert.match(calls[0].messages[0].content, /<criterion>Refuses<\/criterion>[\s\S]*<trace>#0 CALL x<\/trace>/);
    assert.match(calls[0].system, /ONLY the criterion text/);
    assert.match(calls[1].messages[0].content, /<plan>1\. a<\/plan>[\s\S]*<trace>/);
    assert.doesNotMatch(calls[2].messages[0].content, /<trace>/);
    for (const c of calls) assert.match(c.system, /UNTRUSTED/);
  });
  it('judgeToolCalls validates one verdict per listed call and records usage', async () => {
    const good = ok('{"calls":[{"index":0,"tool_ok":true,"args_ok":false,"evidence":"wrong path"}]}');
    const v = await new AnthropicJudge('k', 'm', fake(good)).judgeToolCalls({ taskPrompt: 't', trace: '', calls: [{ index: 0, tool: 'read_file', args: {} }] });
    assert.deepEqual(v.calls[0], { index: 0, toolOk: true, argsOk: false, evidence: 'wrong path' });
    assert.deepEqual(v.usage, { input: 100, output: 20 });
    for (const bad of ['{"calls":[]}', '{"calls":[{"index":1,"tool_ok":true,"args_ok":true,"evidence":"x"}]}', '{"calls":[{"index":0,"tool_ok":"yes","args_ok":true,"evidence":"x"}]}', '{"nope":1}', 'text'])
      assert.throws(() => parseToolCallsJson(bad, [0]), Error, bad);
  });
});

describe('workspace-scoped API keys', () => {
  it('sends the anthropic-workspace-id header only when a workspace id is configured', () => {
    assert.deepEqual(judgeClientOptions('k', 'wrkspc_123').defaultHeaders, { 'anthropic-workspace-id': 'wrkspc_123' });
    assert.equal('defaultHeaders' in judgeClientOptions('k'), false);
    assert.equal('defaultHeaders' in judgeClientOptions('k', ''), false);
  });
  it('createJudge reads ANTHROPIC_WORKSPACE_ID from the environment', () => {
    assert.equal((createJudge({ ANTHROPIC_API_KEY: 'k', ANTHROPIC_WORKSPACE_ID: 'wrkspc_9' }) as any).workspaceId, 'wrkspc_9');
    assert.equal((createJudge({ ANTHROPIC_API_KEY: 'k' }) as any).workspaceId, undefined);
  });
  it('a workspace error without a configured id gets an actionable hint; with an id it is passed through', async () => {
    const err = new Error('400 This API key is not scoped to a workspace, so this request must include the anthropic-workspace-id header');
    await assert.rejects(new AnthropicJudge('k', 'm', fake(err)).judge(input), /set ANTHROPIC_WORKSPACE_ID in \.env/);
    await assert.rejects(new AnthropicJudge('k', 'm', fake(err), 'wrkspc_1').judge(input), (e: Error) => !/set ANTHROPIC_WORKSPACE_ID/.test(e.message));
  });
});
