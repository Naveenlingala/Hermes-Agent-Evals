import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import type { AgentConfig } from '../domain/types';
import { Check } from '../validation';

@Injectable()
export class ConfigsService {
  constructor(private db: DbService) {}
  list() { return this.db.list<AgentConfig>('configs'); }
  get(id: string) {
    const c = this.db.get<AgentConfig>('configs', id);
    if (!c) throw new NotFoundException(`Config ${id} not found`);
    return c;
  }
  create(body: unknown): AgentConfig {
    const c = new Check(body);
    const name = c.str('name', { max: 80 });
    const description = c.str('description', { max: 400, optional: true }) ?? '';
    const runner = c.str('runner', { max: 10 });
    if (runner && runner !== 'mock' && runner !== 'hermes') c.fail('runner must be "mock" or "hermes"');
    const model = c.str('model', { max: 120 });
    const provider = c.str('provider', { max: 60, optional: true });
    const inputPerMTok = c.num('inputPerMTok', { min: 0, max: 1000 });
    const outputPerMTok = c.num('outputPerMTok', { min: 0, max: 1000 });
    const list = (key: string) => {
      const v = c.raw(key);
      if (v === undefined) return [] as string[];
      if (!Array.isArray(v) || v.length > 30 || v.some((x) => typeof x !== 'string' || !/^[A-Za-z0-9._-]{1,60}$/.test(x))) { c.fail(`${key} must be an array of names (letters, digits, . _ -)`); return []; }
      return [...new Set(v as string[])];
    };
    const toolsets = list('toolsets');
    const skills = list('skills');
    const memory = c.raw('memory') ?? 'on';
    if (memory !== 'on' && memory !== 'off') c.fail('memory must be "on" or "off"');
    const maxTurns = c.num('maxTurns', { min: 1, max: 1000, int: true, optional: true });
    const skill = c.num('mockSkill', { min: 0, max: 1, optional: true });
    c.done();
    const cfg: AgentConfig = {
      id: `cfg-${randomUUID().slice(0, 8)}`, name: name!, description, runner: runner as 'mock' | 'hermes', model: model!, provider,
      pricing: { inputPerMTok: inputPerMTok!, outputPerMTok: outputPerMTok! }, toolsets, skills, memory: memory as 'on' | 'off', maxTurns,
      mock: runner === 'mock' ? { skill: skill ?? 0.5, latencyMs: 4000 } : undefined,
      createdAt: new Date().toISOString(), seeded: false,
    };
    return this.db.put('configs', cfg);
  }
}
