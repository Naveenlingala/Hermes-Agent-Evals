import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { TraceEvent } from '../domain/types';
import { analyzeCalls, argMatches, argumentCorrectness, compactTrace, extractPlan, stepEfficiency, toolCorrectness } from './trajectory';

const call = (callId: string, tool: string, args: unknown = {}): TraceEvent => ({ t: 0, type: 'tool_call', callId, tool, args });
const res = (callId: string, content: string, isError?: boolean): TraceEvent => ({ t: 0, type: 'tool_result', callId, content, isError });
const say = (content: string): TraceEvent => ({ t: 0, type: 'message', role: 'assistant', content });

describe('analyzeCalls / stepEfficiency', () => {
  it('flags redundant (identical tool+args, key order irrelevant) and errored calls', () => {
    const trace = [call('1', 'web', { q: 'a', n: 1 }), res('1', 'ok'), call('2', 'web', { n: 1, q: 'a' }), res('2', 'ok'), call('3', 'terminal', { c: 'x' }), res('3', '{"output":"","exit_code":1,"error":null}')];
    const rows = analyzeCalls(trace);
    assert.deepEqual(rows.map((r) => [r.redundant, r.errored]), [[false, false], [true, false], [false, true]]);
    assert.ok(Math.abs(stepEfficiency(rows).value! - 1 / 3) < 1e-9);
  });
  it('treats Hermes {error: ...} results and isError as errors; null error as fine', () => {
    const rows = analyzeCalls([call('1', 't'), res('1', '{"output":"x","exit_code":0,"error":null}'), call('2', 't', { a: 1 }), res('2', 'boom', true), call('3', 't', { a: 2 }), res('3', '{"error":"bad arg"}')]);
    assert.deepEqual(rows.map((r) => r.errored), [false, true, true]);
  });
  it('optimalSteps caps the score; no calls is N/A not 0', () => {
    const rows = analyzeCalls([call('1', 'a', 1), call('2', 'a', 2), call('3', 'a', 3), call('4', 'a', 4)]);
    assert.equal(stepEfficiency(rows, 2).value, 0.5);
    assert.equal(stepEfficiency(rows).value, 1);
    assert.deepEqual(stepEfficiency([]), { value: null, reason: 'no tool calls were made' });
  });
});

describe('toolCorrectness / argumentCorrectness', () => {
  const exp = { tools: [{ tool: 'web_extract', args: { urls: 'example.com' } }, { tool: 'terminal' }] };
  it('F1 over expected vs used tool names', () => {
    const only = analyzeCalls([call('1', 'web_extract', { urls: ['https://example.com'] })], exp);
    assert.ok(Math.abs(toolCorrectness(only, exp).value! - 2 / 3) < 1e-9, 'recall .5, precision 1');
    const both = analyzeCalls([call('1', 'web_extract', {}), call('2', 'terminal', {})], exp);
    assert.equal(toolCorrectness(both, exp).value, 1);
    const extra = analyzeCalls([call('1', 'web_extract', {}), call('2', 'terminal', {}), call('3', 'browser', {})], exp);
    assert.ok(toolCorrectness(extra, exp).value! < 1);
    assert.equal(toolCorrectness([], exp).value, 0);
  });
  it('wildcard tool matches anything; no expectations is N/A', () => {
    assert.equal(toolCorrectness(analyzeCalls([call('1', 'whatever')]), { tools: [{ tool: '*' }] }).value, 1);
    assert.equal(toolCorrectness([], undefined).value, null);
    assert.equal(argumentCorrectness([], { tools: [{ tool: 'x' }] }).value, null);
  });
  it('argument matching is per-key substring, case-insensitive, with a * anywhere key', () => {
    assert.equal(argMatches({ urls: ['HTTPS://Example.com/a'] }, { urls: 'example.com' }), true);
    assert.equal(argMatches({ path: 'a.txt' }, { path: 'notes.txt' }), false);
    assert.equal(argMatches({ nested: { q: 'Hermes' } }, { '*': 'hermes' }), true);
    assert.equal(argMatches({}, { missing: 'x' }), false);
  });
  it('argumentCorrectness is the fraction of expected-with-args satisfied; per-call rows carry the verdict', () => {
    const rows = analyzeCalls([call('1', 'web_extract', { urls: ['https://other.org'] })], exp);
    assert.equal(argumentCorrectness(rows, exp).value, 0);
    assert.equal(rows[0].toolOk, true);
    assert.equal(rows[0].argsOk, false);
    const good = analyzeCalls([call('1', 'web_extract', { urls: ['https://example.com'] })], exp);
    assert.equal(argumentCorrectness(good, exp).value, 1);
    assert.equal(analyzeCalls([call('1', 'browser')], exp)[0].toolOk, false);
    assert.equal(analyzeCalls([call('1', 'browser')])[0].toolOk, null);
  });
});

describe('extractPlan', () => {
  it('prefers a todo/plan tool call', () => {
    const p = extractPlan([say('thinking'), call('1', 'todo', { items: ['a', 'b'] })]);
    assert.equal(p?.source, 'tool');
    assert.match(p!.text, /items/);
  });
  it('uses narration before the first tool call when it reads like a plan', () => {
    const p = extractPlan([say('Plan:\n1. Fetch the page\n2. Read the heading'), call('1', 'web_extract')]);
    assert.equal(p?.source, 'narration');
    assert.equal(extractPlan([say('First I will fetch the page, then read the heading carefully.'), call('1', 'x')])?.source, 'narration');
  });
  it('returns null (N/A) with no narration, non-plan chatter, or no tool calls', () => {
    assert.equal(extractPlan([call('1', 'x')]), null);
    assert.equal(extractPlan([say('ok'), call('1', 'x')]), null);
    assert.equal(extractPlan([say('1. a\n2. b')]), null);
  });
});

describe('compactTrace', () => {
  it('renders calls/results and flags truncation without exceeding the budget', () => {
    const trace = Array.from({ length: 50 }, (_, i) => call(String(i), 'tool', { i }));
    const { text, truncated } = compactTrace(trace, 400);
    assert.equal(truncated, true);
    assert.match(text, /truncated: \d+ more events/);
    assert.ok(text.length < 600);
    assert.equal(compactTrace([call('1', 'a')]).truncated, false);
  });
});
