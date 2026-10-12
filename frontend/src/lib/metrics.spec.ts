import { describe, expect, it } from 'vitest';
import type { MetricInfo } from '@shared';
import { GLOSSARY, GROUPS, groupMetrics } from './metrics';

const m = (key: string, group: MetricInfo['group']): MetricInfo => ({ key, group, label: key, summary: 's', howComputed: 'h', deterministic: 'd', llm: 'l', direction: 'dir', badMeans: 'b', naMeans: 'n', example: 'e' });

describe('metric grouping', () => {
  it('groups in a fixed reading order and drops empty groups', () => {
    const g = groupMetrics([m('a', 'efficiency'), m('b', 'outcome'), m('c', 'outcome')]);
    expect(g.map((x) => x.key)).toEqual(['outcome', 'efficiency']);
    expect(g[0].metrics.map((x) => x.key)).toEqual(['b', 'c']);
  });
  it('knows every group the backend can emit', () => {
    expect(GROUPS.map((g) => g.key).sort()).toEqual(['component', 'efficiency', 'outcome', 'trajectory']);
  });
  it('glossary covers the terms shown on the comparison page', () => {
    const terms = GLOSSARY.map((g) => g.term);
    for (const t of ['95% interval', 'Inconclusive', 'N/A', 'Paired by task']) expect(terms).toContain(t);
    for (const g of GLOSSARY) expect(g.text.length).toBeGreaterThan(30);
  });
});
