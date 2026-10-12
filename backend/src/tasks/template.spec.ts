import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import type { Task } from '../domain/types';
import { nonceFor, renderTask } from './template';

const t: Task = { id: 'mem', name: 'm', category: 'memory', createdAt: '', seeded: false, setupPrompts: ['remember {{nonce}}-orchid'], prompt: 'recall?',
  graders: [{ id: 'g', type: 'contains', dimension: 'success', value: '{{nonce}}-orchid' }], judgeRubric: 'says {{nonce}}' };

describe('nonce templating', () => {
  it('is deterministic per (task, trial), differs across trials, and is regex-safe', () => {
    assert.equal(nonceFor('mem', 1), nonceFor('mem', 1));
    assert.notEqual(nonceFor('mem', 1), nonceFor('mem', 2));
    assert.match(nonceFor('mem', 1), /^[a-z0-9]{7}$/);
  });
  it('substitutes everywhere and leaves the original task untouched', () => {
    const { task, nonce } = renderTask(t, 2);
    assert.ok(nonce);
    assert.equal(task.setupPrompts![0], `remember ${nonce}-orchid`);
    assert.equal((task.graders[0] as any).value, `${nonce}-orchid`);
    assert.equal(task.judgeRubric, `says ${nonce}`);
    assert.equal(t.graders[0].type === 'contains' && t.graders[0].value, '{{nonce}}-orchid');
  });
  it('is a no-op for tasks without placeholders', () => {
    const plain = { ...t, setupPrompts: undefined, graders: [], judgeRubric: undefined };
    assert.equal(renderTask(plain, 1).nonce, undefined);
  });
});
