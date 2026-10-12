import type { MetricInfo } from '@shared';

export const GROUPS: { key: MetricInfo['group']; title: string; blurb: string }[] = [
  { key: 'outcome', title: 'Outcome', blurb: 'Did the agent get the task done, and how good was the answer?' },
  { key: 'component', title: 'Component (tool decisions)', blurb: 'Judged one tool call at a time: right tool, right arguments.' },
  { key: 'trajectory', title: 'Trajectory (the whole run)', blurb: 'Judged across the full chain of steps: efficiency and planning.' },
  { key: 'efficiency', title: 'Efficiency', blurb: 'What the run cost in time, tokens and money.' },
];

export function groupMetrics(metrics: MetricInfo[]) {
  return GROUPS.map((g) => ({ ...g, metrics: metrics.filter((m) => m.group === g.key) })).filter((g) => g.metrics.length);
}

/** Terms used on the comparison page, explained for non-statisticians. */
export const GLOSSARY: { term: string; text: string }[] = [
  { term: 'A and B', text: 'A is the baseline configuration, B is the candidate. Every difference is B − A, so a positive pass-rate difference means B passed more often.' },
  { term: 'Paired by task', text: 'Each task is compared with itself (A on that task vs B on that task), then the per-task differences are averaged. This removes the effect of some tasks simply being harder.' },
  { term: 'Improved / regressed / tied', text: 'Counted per task from B\'s point of view: improved = B\'s pass rate on that task is higher than A\'s, regressed = lower, tied = equal.' },
  { term: '95% interval', text: 'The range the true difference plausibly lies in, given this much data. It is a bootstrap over tasks, so it needs at least 5 shared tasks. If it includes 0, the data cannot tell B apart from A.' },
  { term: 'Includes 0 / excludes 0', text: 'Includes 0 = the difference could be noise. Excludes 0 = a real difference is likely (for that metric). Only the pass-rate interval decides the headline verdict.' },
  { term: 'Wilson interval', text: 'The interval next to each configuration\'s own pass rate. It treats every run as independent, so it is more optimistic than the paired interval.' },
  { term: 'Inconclusive', text: 'The headline verdict when the paired pass-rate interval includes 0, or when there are too few shared tasks. It means "no winner yet", not "they are equal". Add tasks or trials.' },
  { term: 'N/A', text: 'A metric that could not be computed (for example no plan was stated). It is excluded from averages and is never counted as 0.' },
  { term: 'Mock vs real', text: 'Mock runs are simulated and use a keyword-based mock judge. They test the platform, not any agent\'s quality. The badge at the top of the page says which you are looking at.' },
  { term: 'Judge noise', text: 'LLM-judged scores can vary between repeats. Use 3 or more trials, and calibrate the judge with `npm run judge:eval` before trusting criteria that decide pass/fail.' },
];
