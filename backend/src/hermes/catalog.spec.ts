import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { parseModel, parseSkills, parseToolsets, readCatalog } from './catalog';

const TOOLS = `Built-in toolsets (cli):
  ✓ enabled  web  🔍 Web Search & Scraping
  ✗ disabled  video  🎬 Video Analysis

Plugin toolsets (cli):
  ✗ disabled  a2a  🔌 A2A
`;
const SKILLS = `                                Installed Skills
┏━━━━━━┳━━━━━━┳━━━━━━━━━┳━━━━━━━━━┳━━━━━━━━━┓
┃ Name ┃ Category ┃ Source  ┃ Trust   ┃ Status  ┃
┡━━━━━━╇━━━━━━╇━━━━━━━━━╇━━━━━━━━━╇━━━━━━━━━┩
│ apple-notes │ apple │ builtin │ builtin │ enabled │
│ findmy │ apple │ builtin │ builtin │ disabled │
└──────┴──────┴─────────┴─────────┴─────────┘
`;

describe('hermes catalog parsing', () => {
  it('parses toolsets with groups and enabled state', () => {
    const t = parseToolsets(TOOLS);
    assert.deepEqual(t.map((x) => [x.name, x.enabled, x.group]), [['web', true, 'Built-in toolsets'], ['video', false, 'Built-in toolsets'], ['a2a', false, 'Plugin toolsets']]);
    assert.equal(t[0].label, '🔍 Web Search & Scraping');
  });
  it('parses the skills table and skips header/border rows', () => {
    assert.deepEqual(parseSkills(SKILLS).map((x) => [x.name, x.group, x.enabled]), [['apple-notes', 'apple', true], ['findmy', 'apple', false]]);
  });
  it('parses the configured model; garbage yields nothing instead of throwing', () => {
    assert.deepEqual(parseModel('default: a/b:free\nprovider: nous\n'), { model: 'a/b:free', provider: 'nous' });
    assert.deepEqual(parseModel('???'), { model: undefined, provider: undefined });
    assert.deepEqual(parseToolsets('boom\n  ✓ enabled  b@d;name label'), []);
  });
  it('reports unavailable (not a throw) when Hermes cannot run, and partial results when only some commands fail', async () => {
    const none = await readCatalog('definitely-not-hermes-bin');
    assert.equal(none.available, false); assert.match(none.error!, /Could not read from Hermes/);
    const part = await readCatalog('h', async (_b, a) => { if (a[0] === 'skills') throw new Error('nope'); return a[0] === 'tools' ? TOOLS : 'default: m1\n'; });
    assert.equal(part.available, true); assert.equal(part.toolsets.length, 3); assert.equal(part.defaultModel, 'm1'); assert.match(part.error!, /skills list: nope/);
  });
});
