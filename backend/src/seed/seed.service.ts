import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { DbService } from '../db/db.service';
import { ExperimentsService } from '../experiments/experiments.service';
import { REAL_CONFIGS, REAL_TASKS, SEED_CONFIGS, SEED_TASKS } from './seed.data';

/** Seeds demo tasks/configs and one clearly-labelled mock experiment on a fresh database. */
@Injectable()
export class SeedService implements OnApplicationBootstrap {
  constructor(private db: DbService, private exps: ExperimentsService) {}
  async onApplicationBootstrap() {
    if (process.env.SKIP_SEED === '1') return;
    // Idempotent: adds any missing seed task/config without touching existing ones.
    for (const t of [...SEED_TASKS, ...REAL_TASKS]) if (!this.db.get('tasks', t.id)) this.db.put('tasks', t);
    for (const c of [...SEED_CONFIGS, ...REAL_CONFIGS]) if (!this.db.get('configs', c.id)) this.db.put('configs', c);
    if (this.db.count('experiments') === 0) {
      const e = this.exps.create({ name: 'Demo: baseline vs candidate vs budget (MOCK data)', taskIds: SEED_TASKS.map((t) => t.id), configIds: ['cfg-baseline', 'cfg-strong', 'cfg-budget'], trials: 3 }, { seeded: true });
      await this.exps.settled(e.id);
      const ab = this.exps.create({ name: 'Demo ablation: tools only, Baseline vs Baseline + web (MOCK data)', taskIds: SEED_TASKS.map((t) => t.id), configIds: ['cfg-baseline', 'cfg-baseline-web'], trials: 5 }, { seeded: true });
      await this.exps.settled(ab.id);
    }
  }
}
