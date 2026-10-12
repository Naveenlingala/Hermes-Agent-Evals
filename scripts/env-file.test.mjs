import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEnv, upsertEnv } from './env-file.mjs';

test('upsert adds, replaces, and preserves comments and other keys', () => {
  let t = '# header\nPORT=3000\n';
  t = upsertEnv(t, 'ANTHROPIC_API_KEY', 'sk-ant-abc');
  t = upsertEnv(t, 'PORT', '4000');
  assert.equal(t, '# header\nPORT=4000\nANTHROPIC_API_KEY=sk-ant-abc\n');
});
test('does not treat a commented-out key as set', () => {
  assert.equal(upsertEnv('# FOO=1\n', 'FOO', '2'), '# FOO=1\nFOO=2\n');
});
test('quotes unusual values and round-trips through parseEnv', () => {
  const v = 'a b#"c\\d';
  assert.equal(parseEnv(upsertEnv('', 'K', v)).get('K'), v);
});
test('rejects multi-line values', () => assert.throws(() => upsertEnv('', 'K', 'a\nb')));
test('parseEnv handles export, quotes and blanks', () => {
  const m = parseEnv('export A=1\nB="two"\nC=\n\n# D=4\n');
  assert.deepEqual([...m], [['A', '1'], ['B', 'two'], ['C', '']]);
});
