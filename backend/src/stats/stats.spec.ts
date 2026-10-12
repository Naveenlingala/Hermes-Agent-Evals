import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { RunRecord, Task } from '../domain/types';
import { compare, summarize } from './aggregate';
import { bootstrapMeanCi, wilson } from './stats';

describe('stats', () => {
  it('wilson interval is bounded and contains p', () => {
    const w = wilson(8, 10);
    assert.ok(w.low > 0.4 && w.high < 1 && w.low < 0.8 && w.high > 0.8);
    assert.deepEqual(wilson(0, 0), { low: 0, high: 1 });
  });
  it('bootstrap CI is deterministic and excludes zero for consistent gains', () => {
    const d = [0.3, 0.4, 0.2, 0.5, 0.3, 0.4];
    assert.deepEqual(bootstrapMeanCi(d), bootstrapMeanCi(d));
    assert.ok(bootstrapMeanCi(d).low > 0);
  });
});

const run = (taskId: string, configId: string, trial: number, passed: boolean): RunRecord => ({
  id: `${taskId}-${configId}-${trial}`, experimentId: 'e', taskId, configId, trial, runner: 'mock', startedAt: '', finishedAt: '',
  result: { output: '', trace: [], latencyMs: 100, inputTokens: 10, outputTokens: 10, retries: 0, simulated: true },
  grades: [], passed, toolScore: null, quality: null, costUsd: 0.01, failureReasons: passed ? [] : ['why'],
  taskSnapshot: {} as any, configSnapshot: {} as any,
});
const tasks = (n: number): Task[] => Array.from({ length: n }, (_, i) => ({ id: `t${i}`, name: `T${i}`, category: 'c', prompt: '', graders: [], createdAt: '', seeded: false }));

describe('compare', () => {
  const build = (n: number, bWins: boolean) => {
    const runs: RunRecord[] = [];
    for (let i = 0; i < n; i++) for (const trial of [1, 2]) { runs.push(run(`t${i}`, 'A', trial, false)); runs.push(run(`t${i}`, 'B', trial, bWins)); }
    return compare('e', runs, tasks(n), summarize(runs, 'A', 'A'), summarize(runs, 'B', 'B'));
  };
  it('declares B better only with enough tasks and a CI above zero', () => {
    const c = build(6, true);
    assert.equal(c.uncertainty.verdict, 'b_better');
    assert.equal(c.wins, 6);
    assert.ok(c.metrics[0].ci!.low > 0);
  });
  it('withholds intervals and verdict with too few tasks', () => {
    const c = build(3, true);
    assert.equal(c.uncertainty.sufficient, false);
    assert.equal(c.metrics[0].ci, null);
    assert.equal(c.uncertainty.verdict, 'inconclusive');
  });
  it('flags regressions and incomplete tasks', () => {
    const runs = [run('t0', 'A', 1, true), run('t0', 'B', 1, false), run('t1', 'A', 1, true)];
    const c = compare('e', runs, tasks(2), summarize(runs, 'A', 'A'), summarize(runs, 'B', 'B'));
    assert.equal(c.tasks[0].status, 'regression');
    assert.equal(c.tasks[0].failureReasonB, 'why');
    assert.equal(c.tasks[1].status, 'incomplete');
  });
});
