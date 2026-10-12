<script setup lang="ts">
import { computed } from 'vue';
import { api } from '../api';
import CostLatencyScatter from '../components/CostLatencyScatter.vue';
import PassRateChart from '../components/PassRateChart.vue';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { configColor } from '../lib/colors';
import { ms, pct, signed, usd } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ui } from '../ui';

const { data, error, loading, reload } = useAsync(api.overview);
const best = computed(() => data.value?.leaderboard[0]);
const bars = computed(() => (data.value?.leaderboard ?? []).map((s) => ({ name: s.configName, rate: s.passRate, low: s.passRateCi.low, high: s.passRateCi.high, n: s.runs, color: configColor(s.configId) })));
const pts = computed(() => (data.value?.leaderboard ?? []).map((s) => ({ name: s.configName, cost: s.meanCostUsd, latency: s.meanLatencyMs, color: configColor(s.configId) })));
const second = computed(() => data.value?.leaderboard[1]);
const overlap = computed(() => !!best.value && !!second.value && second.value.passRateCi.high >= best.value.passRateCi.low);
</script>
<template>
  <div class="page">
    <div class="page-head">
      <div><h1>Which configuration should ship?</h1><p class="muted">Pass rate, cost and latency across every recorded run, with the failures that explain them.</p></div>
      <button class="btn primary" @click="ui.newExperimentOpen = true">＋ New Experiment</button>
    </div>
    <StateBox :loading="loading" :error="error" :empty="data?.runs === 0" empty-text="No runs yet. Start a new experiment." @retry="reload">
      <template v-if="data">
        <div v-if="data.dataMode.mockRuns" class="mock-banner" role="note"><strong>◇ Demonstration data.</strong> {{ data.dataMode.mockRuns }} of {{ data.runs }} runs come from the <em>mock</em> runner (seeded, simulated latency/tokens). {{ data.dataMode.hermesRuns }} runs used real Hermes.</div>
        <div class="grid g4 kpis">
          <div class="card card-pad kpi"><span class="label faint">Best pass rate</span><strong class="big num">{{ pct(best?.passRate) }}</strong><span class="muted">{{ best?.configName }} · 95% CI {{ pct(best?.passRateCi.low) }}–{{ pct(best?.passRateCi.high) }}</span></div>
          <div class="card card-pad kpi"><span class="label faint">Cost per run</span><strong class="big num">{{ usd(best?.meanCostUsd) }}</strong><span class="muted">estimated, {{ best?.configName }}</span></div>
          <div class="card card-pad kpi"><span class="label faint">Mean latency</span><strong class="big num">{{ ms(best?.meanLatencyMs) }}</strong><span class="muted">p95 {{ ms(best?.p95LatencyMs) }}</span></div>
          <div class="card card-pad kpi"><span class="label faint">Recorded</span><strong class="big num">{{ data.runs }} runs</strong><span class="muted">{{ data.experiments }} experiments</span></div>
        </div>
        <p v-if="overlap" class="muted caveat">The top two configurations' pass-rate intervals overlap, so "best" here is not a statistically supported winner. Use a paired experiment comparison.</p>
        <div class="grid g2 sec">
          <section class="card"><div class="card-head"><h2>Pass rate by configuration</h2></div><div class="card-pad"><PassRateChart :items="bars" /></div></section>
          <section class="card"><div class="card-head"><h2>Latency vs. cost</h2></div><div class="card-pad"><CostLatencyScatter :points="pts" /></div></section>
        </div>
        <div class="grid g2 sec">
          <section class="card"><div class="card-head"><h2>Hardest tasks</h2><span class="faint">lowest pass rate, all configs</span></div>
            <div class="table-wrap"><table><thead><tr><th>Task</th><th>Pass rate</th><th>Top failure reason</th></tr></thead><tbody>
              <tr v-for="t in data.hardestTasks" :key="t.taskId"><td>{{ t.taskName }}</td><td class="num"><StatusBadge :kind="t.passRate < 0.5 ? 'fail' : t.passRate < 0.8 ? 'warn' : 'pass'">{{ pct(t.passRate) }}</StatusBadge></td><td class="muted reason">{{ t.topFailure ?? '—' }}</td></tr>
            </tbody></table></div></section>
          <section class="card"><div class="card-head"><h2>Regressions</h2><RouterLink v-if="data.latestExperimentId" :to="`/experiments/${data.latestExperimentId}`">Open latest comparison →</RouterLink></div>
            <p v-if="!data.recentRegressions.length" class="card-pad muted">No task regressions (B vs A) in recent experiments.</p>
            <ul v-else class="reg"><li v-for="r in data.recentRegressions" :key="r.experimentId + r.taskId"><StatusBadge kind="fail">{{ signed(r.delta, (n) => pct(n)) }}</StatusBadge> <RouterLink :to="`/experiments/${r.experimentId}`"><strong>{{ r.taskName }}</strong></RouterLink><br /><span class="faint">{{ r.bName }} vs {{ r.aName }} · {{ r.experimentName }}</span></li></ul></section>
        </div>
      </template>
    </StateBox>
  </div>
</template>
<style scoped>
.kpi { display: grid; gap: 4px; } .big { font-size: 30px; letter-spacing: -0.02em; line-height: 1.1; } .label { text-transform: uppercase; font-size: 11.5px; letter-spacing: .05em; }
.sec { margin-top: 16px; align-items: start; } .caveat { margin-top: 12px; font-size: 13px; }
.reason { max-width: 340px; font-size: 13px; overflow-wrap: anywhere; } .reg { list-style: none; margin: 0; padding: 4px 20px 12px; } .reg li { padding: 10px 0; border-bottom: 1px solid var(--border); } .reg li:last-child { border: 0; }
</style>
