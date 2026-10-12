import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SEED_CONFIGS, SEED_TASKS } from '../seed/seed.data';
import { HermesRunner, buildHermesArgs, hermesModelEnv, parseHermesStream } from './hermes.runner';
import { MockRunner } from './mock.runner';

describe('MockRunner', () => {
  it('is deterministic per (task, config, trial), marked simulated', async () => {
    const r = new MockRunner();
    const req = { task: SEED_TASKS[0], config: SEED_CONFIGS[0], trial: 1 };
    const a = await r.run(req), b = await r.run(req);
    assert.deepEqual(a, b);
    assert.equal(a.simulated, true);
  });
  it('errors cleanly when a task has no mock scenario', async () => {
    const res = await new MockRunner().run({ task: { id: 'x', prompt: 'p' }, config: SEED_CONFIGS[0], trial: 1 });
    assert.match(res.error!, /no mock scenario/);
  });
});

describe('parseHermesStream', () => {
  // Synthetic fixture shaped after the documented event types; inner field names are assumptions.
  const lines = [
    { type: 'system', subtype: 'init', timestamp: 1000 },
    { type: 'tool_use', id: 'u1', name: 'terminal', input: { command: 'ls' }, timestamp: 1100 },
    { type: 'tool_result', tool_use_id: 'u1', content: 'a.txt', timestamp: 1200 },
    { type: 'text', text: 'Done.', timestamp: 1300 },
    { type: 'result', exit_code: 0, text: 'Done.', input_tokens: 12, output_tokens: 3, timestamp: 1400 },
  ].map((l) => JSON.stringify(l)).join('\n');
  it('extracts output, tool trace and tokens', () => {
    const p = parseHermesStream(lines, 1000);
    assert.equal(p.output, 'Done.');
    assert.equal(p.error, undefined);
    assert.equal(p.inputTokens, 12);
    assert.deepEqual(p.trace.filter((e) => e.type === 'tool_call').map((e: any) => e.tool), ['terminal']);
  });
  it('parses a real Hermes v0.21.7 failure stream (captured locally, provider not configured)', () => {
    const real = [
      '{"type": "system", "subtype": "init", "model": "anthropic/claude-opus-4.6", "session_id": "s1", "timestamp": 1791804422600}',
      '{"type": "result", "session_id": "s1", "exit_code": 1, "text": "", "tokens": {"input": 0, "output": 0, "total": 0, "cache_read": 0, "cache_write": 0}, "duration_ms": 3, "error": "credentials or agent init failed", "timestamp": 1791804422603}',
    ].join('\n');
    const p = parseHermesStream(real, 1791804422600);
    assert.match(p.error!, /exit_code 1: credentials or agent init failed/);
    assert.match((p.trace[0] as any).content, /model=anthropic\/claude-opus-4.6/);
  });
  it('parses a REAL Hermes v0.21.7 tool-using stream (shape captured with a free model, terminal toolset)', () => {
    const cmd = 'expr 123456 \\* 654321';
    const real = [
      { type: 'system', subtype: 'init', model: 'upstage/solar-mini4:free', session_id: 's', timestamp: 1000 },
      { type: 'tool_use', name: 'terminal', input: { command: cmd }, timestamp: 1100 },
      { type: 'tool_result', name: 'terminal', output: JSON.stringify({ output: '80779853376', exit_code: 0, error: null }), duration_ms: 94, is_error: false, timestamp: 1200 },
      { type: 'text', text: '8', timestamp: 1300 }, { type: 'text', text: '0', timestamp: 1301 },
      { type: 'result', session_id: 's', exit_code: 0, text: '80779853376', tokens: { input: 2725, output: 182, total: 5307, cache_read: 2400, cache_write: 0 }, duration_ms: 6116, timestamp: 1400 },
    ].map((e) => JSON.stringify(e)).join('\n');
    const p = parseHermesStream(real, 1000);
    assert.equal(p.output, '80779853376');
    assert.equal(p.error, undefined);
    const call: any = p.trace.find((e) => e.type === 'tool_call');
    assert.deepEqual([call.tool, call.args.command], ['terminal', cmd]);
    const result: any = p.trace.find((e) => e.type === 'tool_result');
    assert.match(result.content, /80779853376/);
    assert.equal(result.isError, false);
    assert.deepEqual([p.inputTokens, p.outputTokens], [2725, 182]);
  });
  it('keeps narration before a tool call as an assistant message (so plan metrics can see it)', () => {
    const lines = [
      { type: 'text', text: 'Plan:\n1. fetch the page\n' }, { type: 'text', text: '2. read the heading' },
      { type: 'tool_use', name: 'web_extract', input: { urls: ['https://example.com'] } },
      { type: 'tool_result', name: 'web_extract', output: 'ok' },
      { type: 'text', text: 'Example ' }, { type: 'text', text: 'Domain' },
      { type: 'result', exit_code: 0, text: 'Example Domain', tokens: { input: 1, output: 1 } },
    ].map((e) => JSON.stringify(e)).join('\n');
    const p = parseHermesStream(lines, 0);
    const first: any = p.trace[0];
    assert.deepEqual([first.type, first.role], ['message', 'assistant']);
    assert.match(first.content, /1\. fetch the page\n2\. read the heading/);
    assert.equal(p.trace[1].type, 'tool_call');
    assert.equal(p.output, 'Example Domain');
  });
  it('reads token counts from the real tokens:{input,output} shape', () => {
    const p = parseHermesStream(JSON.stringify({ type: 'result', exit_code: 0, text: 'ok', tokens: { input: 21, output: 4 } }), 0);
    assert.deepEqual([p.inputTokens, p.outputTokens, p.error], [21, 4, undefined]);
  });
  it('flags a stream with no terminal result and tolerates junk lines', () => {
    const p = parseHermesStream('garbage\n' + JSON.stringify({ type: 'text', text: 'hi' }), 0);
    assert.match(p.error!, /without a terminal/);
  });
  it('flags non-zero exit_code', () => {
    assert.match(parseHermesStream(JSON.stringify({ type: 'result', exit_code: 2, text: '' }), 0).error!, /exit_code 2/);
  });
});

describe('HermesRunner', () => {
  it('reports a missing binary as a run error rather than throwing', async () => {
    const res = await new HermesRunner('definitely-not-hermes-bin', 2000).run({ task: { id: 'x', prompt: 'p' }, config: SEED_CONFIGS[3], trial: 1 });
    assert.match(res.error!, /Could not start/);
    assert.equal(res.simulated, false);
  });
});

describe('buildHermesArgs', () => {
  it('maps toolsets, skills, max turns and memory=off to documented Hermes flags', () => {
    const a = buildHermesArgs({ provider: 'nous', toolsets: ['web', 'file'], skills: ['x', 'y'], maxTurns: 7, memory: 'off' });
    assert.deepEqual(a, ['chat', '--format', 'stream-json', '--query-file', '-', '--provider', 'nous', '--toolsets', 'web,file', '--skills', 'x,y', '--max-turns', '7', '--ignore-rules']);
  });
  it('adds nothing extra for defaults', () => {
    assert.deepEqual(buildHermesArgs({ toolsets: [], skills: [], memory: 'on' }), ['chat', '--format', 'stream-json', '--query-file', '-']);
  });
});

describe('hermesModelEnv', () => {
  it('overrides only for an explicit model; default leaves Hermes own model alone', () => {
    assert.deepEqual(hermesModelEnv('x/y'), { HERMES_INFERENCE_MODEL: 'x/y' });
    assert.deepEqual(hermesModelEnv('default'), {});
    assert.deepEqual(hermesModelEnv(''), {});
  });
});

describe('HermesRunner setup prompts (fake hermes executable)', () => {
  // A stand-in `hermes` that echoes its stdin as the answer and counts invocations; no model, no network.
  const dir = mkdtempSync(join(tmpdir(), 'fake-hermes-'));
  const bin = join(dir, 'hermes');
  writeFileSync(bin, `#!${process.execPath}
let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
  const fail = s.includes('FAIL');
  console.log(JSON.stringify({type:'system',subtype:'init',model:'fake',session_id:'s'}));
  console.log(JSON.stringify({type:'result',exit_code:fail?1:0,text:fail?'':'echo:'+s.trim(),tokens:{input:5,output:2},error:fail?'boom':undefined}));
});`);
  chmodSync(bin, 0o755);
  const cfg = SEED_CONFIGS[3];
  it('runs setup steps first, then the task prompt; output is the task answer; metrics are summed', async () => {
    const r = await new HermesRunner(bin, 10000).run({ task: { id: 't', prompt: 'main?', setupPrompts: ['plant A', 'plant B'] }, config: cfg, trial: 1 });
    assert.equal(r.error, undefined);
    assert.equal(r.output, 'echo:main?');
    assert.deepEqual([r.inputTokens, r.outputTokens], [15, 6]);
    const labels = r.trace.filter((e) => e.type === 'message' && e.role === 'system' && e.content.startsWith('—')).map((e: any) => e.content);
    assert.equal(labels.length, 3);
    assert.match(labels[0], /setup step 1\/2: plant A/);
    assert.match(labels[2], /task prompt/);
  });
  it('a failing setup step aborts with a clear error and never runs the task prompt', async () => {
    const r = await new HermesRunner(bin, 10000).run({ task: { id: 't', prompt: 'main?', setupPrompts: ['FAIL now'] }, config: cfg, trial: 1 });
    assert.match(r.error!, /Setup step 1 failed: .*boom/);
    assert.equal(r.output, '');
  });
  it('without setup prompts it is a single plain run', async () => {
    const r = await new HermesRunner(bin, 10000).run({ task: { id: 't', prompt: 'hello' }, config: cfg, trial: 1 });
    assert.equal(r.output, 'echo:hello');
  });
});
