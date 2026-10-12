import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DbService } from '../db/db.service';
import type { Task } from '../domain/types';
import { Check, parseExpected, parseGraders, parseJudgeMetrics } from '../validation';
import type { GraderSpec } from '../domain/types';

@Injectable()
export class TasksService {
  constructor(private db: DbService) {}
  list() { return this.db.list<Task>('tasks'); }
  get(id: string) {
    const t = this.db.get<Task>('tasks', id);
    if (!t) throw new NotFoundException(`Task ${id} not found`);
    return t;
  }
  create(body: unknown): Task {
    const c = new Check(body);
    const name = c.str('name', { max: 120 });
    const prompt = c.str('prompt', { max: 8000 });
    const category = c.str('category', { max: 40, optional: true }) ?? 'general';
    const judgeRubric = c.str('judgeRubric', { max: 1000, optional: true });
    const rawCriteria = c.raw('criteria');
    let criteria: string[] = [];
    if (rawCriteria !== undefined) {
      if (!Array.isArray(rawCriteria) || rawCriteria.length > 5 || rawCriteria.some((x) => typeof x !== 'string' || !x.trim() || x.length > 500)) c.fail('criteria must be up to 5 non-empty strings (max 500 chars each)');
      else criteria = rawCriteria.map((x: string) => x.trim());
    }
    const rawG = c.raw('graders');
    const noDeterministic = rawG === undefined || (Array.isArray(rawG) && rawG.length === 0);
    if (noDeterministic && !criteria.length) c.fail('Define at least one grader or one success criterion');
    const graders: GraderSpec[] = noDeterministic ? [] : parseGraders(rawG, c);
    criteria.forEach((criterion, i) => graders.push({ id: `criterion${i + 1}`, type: 'llm_criterion', dimension: 'success', criterion, passScore: 4 }));
    const expected = parseExpected(c.raw('expected'), c);
    const elicitPlan = c.raw('elicitPlan') === true ? true : undefined;
    const judgeMetrics = parseJudgeMetrics(c.raw('judgeMetrics'), c);
    const rawSetup = c.raw('setupPrompts');
    let setupPrompts: string[] | undefined;
    if (rawSetup !== undefined) {
      if (!Array.isArray(rawSetup) || rawSetup.length > 3 || rawSetup.some((x) => typeof x !== 'string' || !x.trim() || x.length > 2000)) c.fail('setupPrompts must be up to 3 non-empty strings (max 2000 chars each)');
      else setupPrompts = rawSetup.map((x: string) => x.trim());
    }
    c.done();
    const task: Task = { id: `task-${randomUUID().slice(0, 8)}`, name: name!, prompt: prompt!, category, setupPrompts: setupPrompts?.length ? setupPrompts : undefined, graders, expected, judgeMetrics, elicitPlan, judgeRubric, createdAt: new Date().toISOString(), seeded: false };
    return this.db.put('tasks', task);
  }
}
