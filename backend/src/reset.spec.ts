import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import { ExperimentsService } from './experiments/experiments.service';

describe('reset + request tracing (in-memory DB)', () => {
  let app: INestApplication; let base: string;
  before(async () => {
    process.env.DB_FILE = ':memory:'; process.env.JUDGE_MODE = 'mock'; process.env.HERMES_BIN = 'definitely-not-hermes-bin';
    app = (await Test.createTestingModule({ imports: [AppModule] }).compile()).createNestApplication();
    await app.init(); await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  after(async () => { await app.close(); });
  const j = async (path: string, init?: RequestInit) => { const r = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json' } }); return { status: r.status, headers: r.headers, body: (await r.json()) as any }; };

  it('traces requests with an id, redacts secrets, and exposes them at /api/debug/requests', async () => {
    const r = await j('/api/tasks', { method: 'POST', body: JSON.stringify({ name: '', apiKey: 'sk-secret-123' }) });
    assert.equal(r.status, 400);
    const id = r.headers.get('x-request-id')!; assert.ok(id);
    const t = (await j('/api/debug/requests')).body as any[];
    const e = t.find((x) => x.id === id);
    assert.equal(e.status, 400); assert.equal(e.method, 'POST');
    assert.ok(e.requestBody.includes('[redacted]') && !e.requestBody.includes('sk-secret'));
    assert.ok(!t.some((x) => x.path?.startsWith('/api/debug')), 'debug polling must not trace itself');
    const later = (await j(`/api/debug/requests?since=${t.at(-1).seq}`)).body as any[];
    assert.ok(later.every((x) => x.seq > t.at(-1).seq));
  });

  it('serves the Hermes catalog as 200 with available=false when Hermes is not installed, plus models from saved configs', async () => {
    const r = await j('/api/hermes/catalog');
    assert.equal(r.status, 200); assert.equal(r.body.available, false); assert.match(r.body.error, /Could not read from Hermes/);
    assert.deepEqual(r.body.toolsets, []);
    assert.ok(r.body.usedModels.includes('demo-small'));
  });

  it('refuses to reset (409) while an experiment is running, then succeeds once it settles', async () => {
    const exp = (await j('/api/experiments', { method: 'POST', body: JSON.stringify({ name: 'x', taskIds: ['t'], configIds: ['a', 'b'] }) }));
    assert.equal(exp.status, 400); // unknown ids -> nothing started
    const tasks = (await j('/api/tasks')).body.filter((t: any) => t.mock).slice(0, 1).map((t: any) => t.id);
    const svc = app.get(ExperimentsService);
    const created = svc.create({ name: 'x', taskIds: tasks, configIds: ['cfg-baseline', 'cfg-strong'], trials: 2 }); // starts async; still in flight this tick
    assert.throws(() => svc.reset(), /running/);
    assert.ok((await j('/api/tasks')).body.length > 0, 'data untouched by refused reset');
    await app.get(ExperimentsService).settled(created.id);
  });

  it('clears all data and leaves empty lists / a working overview', async () => {
    const r = await j('/api/reset', { method: 'POST' });
    assert.equal(r.status, 201); assert.ok(r.body.deleted > 0);
    for (const p of ['tasks', 'configs', 'experiments']) assert.deepEqual((await j(`/api/${p}`)).body, []);
    assert.equal((await j('/api/overview')).status, 200);
    assert.equal((await j('/api/reset', { method: 'POST' })).body.deleted, 0); // idempotent
    const ev = (await j('/api/debug/requests')).body.filter((x: any) => x.kind === 'event').map((x: any) => x.name);
    assert.ok(ev.includes('reset') && ev.includes('experiment.start') && ev.includes('run.finished'));
  });
});
