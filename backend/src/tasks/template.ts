import type { Task } from '../domain/types';
import { hashString } from '../stats/stats';

/** Appended to the prompt the agent receives when a task sets elicitPlan (not shown to graders/judges). */
export const PLAN_INSTRUCTION = '\n\nBefore you use any tool, first write a short numbered plan (2-5 steps) of what you will do. Then carry it out.';

/** Same nonce for every config on a given (task, trial) so A and B are compared on identical facts. */
export const nonceFor = (taskId: string, trial: number) => hashString(`nonce|${taskId}|${trial}`).toString(36).padStart(7, '0').slice(0, 7);

const fill = (s: string, nonce: string) => s.replaceAll('{{nonce}}', nonce);

/** Returns a copy of the task with `{{nonce}}` substituted in prompts, graders and rubric. */
export function renderTask(task: Task, trial: number): { task: Task; nonce?: string } {
  const text = JSON.stringify([task.prompt, task.setupPrompts, task.graders, task.judgeRubric, task.expected]);
  if (!text.includes('{{nonce}}')) return { task };
  const nonce = nonceFor(task.id, trial);
  const graders = task.graders.map((g) => {
    const o: any = { ...g };
    for (const k of ['value', 'pattern', 'argsContain', 'criterion']) if (typeof o[k] === 'string') o[k] = fill(o[k], nonce);
    return o;
  });
  return { nonce, task: { ...task, prompt: fill(task.prompt, nonce), setupPrompts: task.setupPrompts?.map((s) => fill(s, nonce)), graders, judgeRubric: task.judgeRubric && fill(task.judgeRubric, nonce), expected: task.expected && JSON.parse(fill(JSON.stringify(task.expected), nonce)) } };
}
