<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Comparison, MetricDiff } from '@shared';
import { api } from '../api';
import type { AgentConfig } from '@shared';
import CiBar from '../components/CiBar.vue';
import LiveRunPanel from '../components/LiveRunPanel.vue';
import MetricCard from '../components/MetricCard.vue';
import CostLatencyScatter from '../components/CostLatencyScatter.vue';
import DeltaChart from '../components/DeltaChart.vue';
import PassRateChart from '../components/PassRateChart.vue';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { configColor } from '../lib/colors';
import { ci, diffTone, ms, pct, signed, tokens, usd } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const route = useRoute();
const id = route.params.id as string;
const exp = useAsync(() => api.experiment(id), { keepPolling: (d) => d.experiment.status === 'running' });
const a = ref(''); const b = ref('');
const cmp = ref<Comparison | null>(null);
const cmpError = ref<string | null>(null);
const cmpLoading = ref(false);
const filter = ref<'all' | 'regression' | 'improvement' | 'tie'>('all');
const sortKey = ref<'name' | 'delta'>('delta');
const sortDir = ref(1);

const allConfigs = useAsync(() => api.configs());
const catalog = useAsync(api.evaluators);
const infoOf = (key: string) => catalog.data.value?.metrics.find((m) => m.key === key);
const openMetric = ref<Set<string>>(new Set());
const toggleMetric = (k: string) => { const s = new Set(openMetric.value); if (s.has(k)) s.delete(k); else s.add(k); openMetric.value = s; };
const cfgOf = (cid: string) => allConfigs.data.value?.find((c) => c.id === cid);
const list = (v: string[] | undefined) => (v?.length ? v.join(', ') : 'default / none');
const differences = computed(() => {
  const x = cfgOf(a.value), y = cfgOf(b.value);
  if (!x || !y) return [];
  const f: [string, (c: AgentConfig) => string][] = [['Model', (c) => c.model], ['Provider', (c) => c.provider ?? 'default'], ['Toolsets', (c) => list(c.toolsets)], ['Skills', (c) => list(c.skills)], ['Memory', (c) => c.memory ?? 'on'], ['Max turns', (c) => String(c.maxTurns ?? 'default')], ['Runner', (c) => c.runner]];
  return f.map(([label, get]) => ({ label, a: get(x), b: get(y), same: get(x) === get(y) }));
});
const configs = computed(() => exp.data.value?.summaries ?? []);
const configIds = computed(() => exp.data.value?.experiment.configIds ?? []);
const nameOf = (cid: string) => configs.value.find((c) => c.configId === cid)?.configName ?? cid;
const status = computed(() => exp.data.value?.experiment.status);
watch(configIds, (ids) => { if (ids.length >= 2 && !a.value) { a.value = ids[0]; b.value = ids[1]; } }, { immediate: true });

async function loadCmp() {
  if (!a.value || !b.value || a.value === b.value) return;
  cmpLoading.value = true; cmpError.value = null;
  try { cmp.value = await api.comparison(id, a.value, b.value); } catch (e) { cmpError.value = (e as Error).message; }
  cmpLoading.value = false;
}
watch([a, b, () => exp.data.value?.experiment.progress.done], loadCmp, { immediate: true });
const swap = () => ([a.value, b.value] = [b.value, a.value]);

const runById = computed(() => new Map((exp.data.value?.runs ?? []).map((r) => [r.id, r])));
const rows = computed(() => {
  const t = (cmp.value?.tasks ?? []).filter((r) => filter.value === 'all' || r.status === filter.value);
  return [...t].sort((x, y) => sortDir.value * (sortKey.value === 'name' ? x.taskName.localeCompare(y.taskName) : (x.delta ?? 9) - (y.delta ?? 9)));
});
function sortBy(k: 'name' | 'delta') { if (sortKey.value === k) sortDir.value *= -1; else { sortKey.value = k; sortDir.value = 1; } }

const fmt = (m: MetricDiff, v: number | null) => (v === null ? '—' : m.unit === 'ratio' ? pct(v, 1) : m.unit === 'ms' ? ms(v) : m.unit === 'usd' ? usd(v) : tokens(v));
const fmtDiff = (m: MetricDiff) => (m.diff === null ? '—' : signed(m.diff, (n) => fmt(m, n)));
const bars = computed(() => configs.value.map((s) => ({ name: s.configName, rate: s.passRate, low: s.passRateCi.low, high: s.passRateCi.high, n: s.runs, color: configColor(s.configId) })));
const pts = computed(() => configs.value.map((s) => ({ name: s.configName, cost: s.meanCostUsd, latency: s.meanLatencyMs, color: configColor(s.configId) })));
const verdictText = computed(() => {
  const c = cmp.value; if (!c) return '';
  const u = c.uncertainty;
  if (!u.sufficient) return `Not enough data to compare: ${u.note}`;
  if (u.verdict === 'b_better') return `${c.b.configName} is better on pass rate; the paired 95% interval excludes zero (${u.nTasks} tasks, ${u.minTrials}+ trials each).`;
  if (u.verdict === 'a_better') return `${c.a.configName} is better on pass rate; the paired 95% interval excludes zero (${u.nTasks} tasks, ${u.minTrials}+ trials each).`;
  return `No winner: the paired pass-rate difference's 95% interval includes zero (${u.nTasks} tasks, ${u.minTrials} trial(s) each). The difference could be noise.`;
});
const configNames = computed(() => Object.fromEntries((allConfigs.data.value ?? []).map((c) => [c.id, c.name])));
const progress = computed(() => { const p = exp.data.value?.experiment.progress; return p ? (p.done / p.total) * 100 : 0; });
</script>
<template>
  <div class="page">
    <StateBox :loading="exp.loading.value" :error="exp.error.value" @retry="exp.reload">
      <template v-if="exp.data.value">
        <nav class="crumbs faint" aria-label="Breadcrumb"><RouterLink to="/experiments">Experiments</RouterLink> / {{ exp.data.value.experiment.name }}</nav>
        <div class="page-head">
          <div><h1>{{ exp.data.value.experiment.name }}</h1>
            <div class="row"><StatusBadge :kind="status === 'completed' ? 'pass' : status === 'failed' ? 'fail' : 'warn'">{{ status }}</StatusBadge>
              <StatusBadge :kind="exp.data.value.experiment.mode === 'mock' ? 'mock' : 'info'">{{ exp.data.value.experiment.mode === 'mock' ? 'mock data — simulated agent' : exp.data.value.experiment.mode === 'hermes' ? 'real Hermes' : 'mixed mock + real' }}</StatusBadge>
              <span class="faint num">{{ exp.data.value.experiment.taskIds.length }} task{{ exp.data.value.experiment.taskIds.length === 1 ? '' : 's' }} · {{ exp.data.value.experiment.trials }} trial{{ exp.data.value.experiment.trials === 1 ? '' : 's' }} · {{ exp.data.value.experiment.progress.done }}/{{ exp.data.value.experiment.progress.total }} runs</span></div></div>
          <div class="row pick">
            <label class="faint" for="sel-a">A (baseline)</label><select id="sel-a" v-model="a"><option v-for="c in configs" :key="c.configId" :value="c.configId">{{ c.configName }}</option></select>
            <button class="btn sm" aria-label="Swap A and B" @click="swap">⇄</button>
            <label class="faint" for="sel-b">B (candidate)</label><select id="sel-b" v-model="b"><option v-for="c in configs" :key="c.configId" :value="c.configId">{{ c.configName }}</option></select>
          </div>
        </div>
        <LiveRunPanel v-if="exp.data.value.experiment.counters" :experiment="exp.data.value.experiment" :runs="exp.data.value.runs" :names="configNames" />
        <div v-else-if="status === 'running'" class="prog" role="progressbar" :aria-valuenow="Math.round(progress)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: progress + '%' }" /></div>
        <p v-if="exp.data.value.experiment.error" class="err-text" role="alert">{{ exp.data.value.experiment.error }}</p>
        <p v-if="a === b" class="err-text" role="alert">Pick two different configurations.</p>

        <p v-if="status === 'running'" class="mock-banner" role="note">Partial results: the numbers below update as runs finish and are not final until the experiment completes ({{ exp.data.value.experiment.progress.done }} of {{ exp.data.value.experiment.progress.total }} runs so far).</p>
        <StateBox :loading="cmpLoading && !cmp" :error="cmpError" :empty="!cmp">
          <template v-if="cmp && a !== b">
            <section class="card hero">
              <div class="side"><span class="faint lab">A · baseline</span><h2>{{ cmp.a.configName }}</h2><strong class="big num">{{ pct(cmp.a.passRate, 1) }}</strong><span class="faint">pass rate · 95% CI {{ ci(cmp.a.passRateCi, (n) => pct(n)) }} · n={{ cmp.a.runs }}</span></div>
              <div class="mid">
                <StatusBadge :kind="cmp.uncertainty.verdict === 'inconclusive' ? 'warn' : 'pass'">{{ cmp.uncertainty.verdict === 'b_better' ? 'B better' : cmp.uncertainty.verdict === 'a_better' ? 'A better' : cmp.uncertainty.sufficient ? 'Inconclusive' : 'Insufficient data' }}</StatusBadge>
                <div class="wlt" aria-label="Task-level wins, losses, ties for B"><span class="w"><b class="num">{{ cmp.wins }}</b> improved</span><span class="l"><b class="num">{{ cmp.losses }}</b> regressed</span><span><b class="num">{{ cmp.ties }}</b> tied</span></div>
              </div>
              <div class="side"><span class="faint lab">B · candidate</span><h2>{{ cmp.b.configName }}</h2><strong class="big num">{{ pct(cmp.b.passRate, 1) }}</strong><span class="faint">pass rate · 95% CI {{ ci(cmp.b.passRateCi, (n) => pct(n)) }} · n={{ cmp.b.runs }}</span></div>
            </section>
            <p class="verdict" :class="cmp.uncertainty.verdict"><strong>{{ verdictText }}</strong><br /><span class="faint">{{ cmp.uncertainty.note }}</span></p>

            <section class="card sec"><div class="card-head"><h2>What differs between A and B</h2><span class="faint">{{ differences.filter((d) => !d.same).length }} of {{ differences.length }} settings differ; with several, the effect can't be attributed to one</span></div>
              <div class="table-wrap"><table><thead><tr><th>Setting</th><th>A</th><th>B</th></tr></thead><tbody>
                <tr v-for="d in differences" :key="d.label" :class="{ same: d.same }"><td>{{ d.label }}</td><td class="mono">{{ d.a }}</td><td class="mono"><strong v-if="!d.same">{{ d.b }} ≠</strong><template v-else>{{ d.b }}</template></td></tr></tbody></table></div></section>

            <section class="card sec"><div class="card-head"><h2>Metric differences (B − A)</h2><span class="faint">success, quality, tools, latency, tokens and cost are reported separately</span></div>
              <div class="table-wrap"><table><thead><tr><th>Metric</th><th>A</th><th>B</th><th>Difference</th><th>95% interval (paired, by task)</th><th></th></tr></thead><tbody>
                <template v-for="m in cmp.metrics" :key="m.metric"><tr><td><span class="mname">{{ m.label }}</span> <button v-if="infoOf(m.metric)" type="button" class="minfo" :aria-expanded="openMetric.has(m.metric)" :aria-label="`Explain ${m.label}`" @click="toggleMetric(m.metric)">{{ openMetric.has(m.metric) ? '−' : 'i' }}</button><div class="faint small">{{ infoOf(m.metric)?.summary ?? (m.higherIsBetter ? 'higher is better' : 'lower is better') }}</div></td><td class="num">{{ fmt(m, m.a) }}</td><td class="num">{{ fmt(m, m.b) }}</td>
                  <td class="num"><StatusBadge :kind="({ good: 'pass', bad: 'fail', neutral: 'neutral' } as const)[diffTone(m.diff, m.higherIsBetter)]">{{ fmtDiff(m) }}</StatusBadge></td>
                  <td><CiBar :diff="m.diff" :interval="m.ci" :tone="diffTone(m.diff, m.higherIsBetter)" /><span v-if="m.ci" class="faint small num">{{ signed(m.ci.low, (n) => fmt(m, n)) }} to {{ signed(m.ci.high, (n) => fmt(m, n)) }}</span></td>
                  <td class="faint small">{{ m.ci ? (m.ci.low <= 0 && m.ci.high >= 0 ? 'includes 0' : 'excludes 0') : '' }}</td></tr>
                  <tr v-if="openMetric.has(m.metric) && infoOf(m.metric)" class="explain"><td colspan="6"><MetricCard :metric="infoOf(m.metric)!" /></td></tr></template></tbody></table></div></section>

            <div class="grid g2 sec">
              <section class="card"><div class="card-head"><h2>Per-task change in pass rate</h2></div><div class="card-pad"><DeltaChart :rows="cmp.tasks.map((t) => ({ id: t.taskId, name: t.taskName, delta: t.delta }))" /></div></section>
              <section class="card"><div class="card-head"><h2>Latency vs. cost</h2><span class="faint">all configs in this experiment</span></div><div class="card-pad"><CostLatencyScatter :points="pts" /></div></section>
            </div>

            <section class="card sec"><div class="card-head"><h2>Task results</h2>
              <div class="tabs" role="group" aria-label="Filter tasks"><button v-for="f in (['all', 'regression', 'improvement', 'tie'] as const)" :key="f" :aria-pressed="filter === f" @click="filter = f">{{ f === 'all' ? 'All' : f === 'regression' ? 'Regressions' : f === 'improvement' ? 'Improvements' : 'Ties' }}</button></div></div>
              <p v-if="!rows.length" class="card-pad muted">No tasks match this filter.</p>
              <div v-else class="table-wrap"><table><thead><tr>
                <th class="sortable" :aria-sort="sortKey === 'name' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'" @click="sortBy('name')">Task</th><th>A pass</th><th>B pass</th>
                <th class="sortable" :aria-sort="sortKey === 'delta' ? (sortDir > 0 ? 'ascending' : 'descending') : 'none'" @click="sortBy('delta')" title="Sort by B − A (default: regressions first)">Δ</th><th>Trials (open run)</th><th>Why B fails</th></tr></thead><tbody>
                <tr v-for="t in rows" :key="t.taskId">
                  <td><strong>{{ t.taskName }}</strong><div class="faint small">{{ t.category }}</div></td>
                  <td class="num">{{ pct(t.passRateA) }}</td><td class="num">{{ pct(t.passRateB) }}</td>
                  <td><StatusBadge :kind="t.status === 'regression' ? 'fail' : t.status === 'improvement' ? 'pass' : 'neutral'">{{ t.delta === null ? 'incomplete' : t.status === 'tie' ? 'tie' : signed(t.delta, (n) => pct(n)) }}</StatusBadge></td>
                  <td><div class="chips"><span class="faint small">A</span><RouterLink v-for="r in t.runIdsA" :key="r" :to="`/runs/${r}`" class="chip" :class="runById.get(r)?.passed ? 'p' : 'f'" :aria-label="`A run ${runById.get(r)?.passed ? 'passed' : 'failed'}`">{{ runById.get(r)?.passed ? '✓' : '✕' }}</RouterLink>
                    <span class="faint small">B</span><RouterLink v-for="r in t.runIdsB" :key="r" :to="`/runs/${r}`" class="chip" :class="runById.get(r)?.passed ? 'p' : 'f'" :aria-label="`B run ${runById.get(r)?.passed ? 'passed' : 'failed'}`">{{ runById.get(r)?.passed ? '✓' : '✕' }}</RouterLink></div></td>
                  <td class="reason small muted">{{ t.failureReasonB ?? '' }}</td></tr></tbody></table></div></section>
          </template>
        </StateBox>

        <section class="card sec"><div class="card-head"><h2>All configurations in this experiment</h2></div>
          <div class="grid g2" style="padding: 18px 20px"><PassRateChart :items="bars" />
            <div class="table-wrap"><table><thead><tr><th>Config</th><th>Quality</th><th>Tool corr.</th><th>Arg corr.</th><th>Step eff.</th><th>Latency</th><th>Tokens</th><th>Cost/run</th></tr></thead><tbody>
              <tr v-for="s in configs" :key="s.configId"><td>{{ s.configName }}</td><td class="num">{{ pct(s.meanQuality) }}</td><td class="num">{{ pct(s.meanMetrics?.toolCorrectness) }}</td><td class="num">{{ pct(s.meanMetrics?.argumentCorrectness) }}</td><td class="num">{{ pct(s.meanMetrics?.stepEfficiency) }}</td><td class="num">{{ ms(s.meanLatencyMs) }}</td><td class="num">{{ tokens(s.meanTokens) }}</td><td class="num">{{ usd(s.meanCostUsd) }}</td></tr></tbody></table></div></div></section>
      </template>
    </StateBox>
  </div>
</template>
<style scoped>
.crumbs { margin-bottom: 8px; font-size: 13px; } .pick select { width: auto; max-width: 220px; } .sec { margin-top: 16px; } .small { font-size: 12px; }
.hero { display: grid; grid-template-columns: 1fr auto 1fr; gap: 12px; padding: 22px 24px; align-items: center; }
.side { display: grid; gap: 3px; } .side:last-child { text-align: right; } .lab { text-transform: uppercase; font-size: 11px; letter-spacing: .05em; } .big { font-size: 40px; line-height: 1.1; letter-spacing: -0.03em; }
.mid { display: grid; gap: 10px; justify-items: center; } .wlt { display: flex; gap: 14px; font-size: 13px; } .wlt b { font-size: 18px; } .w b { color: var(--green-600); } .l b { color: var(--red-600); }
.verdict { margin-top: 12px; padding: 12px 16px; border-radius: var(--radius-sm); background: var(--amber-100); border: 1px solid #f1d28a; } .verdict.b_better, .verdict.a_better { background: var(--green-100); border-color: #bfe8cf; }
.prog { height: 6px; background: var(--border); border-radius: 3px; margin-bottom: 14px; overflow: hidden; } .prog i { display: block; height: 100%; background: var(--green-500); transition: width .3s; }
.chips { display: flex; gap: 5px; align-items: center; flex-wrap: wrap; } .chip { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 6px; font-weight: 800; font-size: 12px; text-decoration: none !important; border: 1px solid; }
.chip.p { background: var(--green-100); color: var(--green-700); border-color: #bfe8cf; } .chip.f { background: var(--red-100); color: var(--red-600); border-color: #f6c2bd; } .chip:hover { filter: brightness(.95); }
.same td { color: var(--text-3); } .mname { font-weight: 600; } .minfo { width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); font: 700 12px/1 var(--font); cursor: pointer; padding: 0; vertical-align: 1px; } .minfo:hover { background: var(--surface-2); } .explain td { background: var(--surface-2); } .tip { text-decoration: underline dotted var(--text-3); cursor: help; }
.reason { max-width: 320px; overflow-wrap: anywhere; }
@media (max-width: 760px) { .hero { grid-template-columns: 1fr; } .side:last-child { text-align: left; } .big { font-size: 32px; } }
</style>
