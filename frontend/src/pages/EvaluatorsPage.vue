<script setup lang="ts">
import { api } from '../api';
import MetricExplainer from '../components/MetricExplainer.vue';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAsync } from '../lib/useAsync';

const { data, error, loading, reload } = useAsync(api.evaluators);
</script>
<template>
  <div class="page">
    <div class="page-head"><div><h1>Evaluators</h1><p class="muted">Deterministic graders decide pass/fail. The LLM judge measures answer quality separately and never changes pass/fail.</p></div></div>
    <StateBox :loading="loading" :error="error" @retry="reload">
      <template v-if="data">
        <section class="card"><div class="card-head"><h2>Metrics</h2><span class="faint">what each one means and how it is computed</span></div><div class="card-pad"><MetricExplainer :metrics="data.metrics" /></div></section>
        <section class="card" style="margin-top: 16px"><div class="card-head"><h2>Deterministic graders</h2><span class="faint mono">{{ data.deterministicVersion }}</span></div>
          <div class="table-wrap"><table><thead><tr><th>Type</th><th>Metric dimension</th><th>Checks</th></tr></thead><tbody>
            <tr v-for="g in data.deterministic" :key="g.type"><td class="mono">{{ g.type }}</td><td><StatusBadge :kind="g.dimension === 'success' ? 'pass' : 'info'">{{ g.dimension === 'success' ? 'task success' : 'tool correctness' }}</StatusBadge></td><td>{{ g.description }}</td></tr></tbody></table></div></section>
        <section class="card card-pad" style="margin-top: 16px"><div class="row"><h2>LLM judge</h2><StatusBadge :kind="data.judge.mode === 'mock' ? 'mock' : 'info'">{{ data.judge.mode === 'mock' ? 'mock judge (no API key set)' : data.judge.model }}</StatusBadge><span class="faint mono">{{ data.judge.version }}</span></div>
          <p class="muted" style="margin-top: 8px">{{ data.judge.note }} Responses must match <code class="mono">{{ data.judge.schema }}</code>; invalid responses are recorded as judge errors and excluded from the quality metric. Judge scores are an ordinal rating, not statistical confidence.</p>
          <p v-if="data.judge.mode === 'mock'" class="mock-banner" style="margin: 12px 0 0">The mock judge only measures rubric keyword coverage. Set <code>ANTHROPIC_API_KEY</code> to use a real judge (not verified in this build).</p></section>
      </template>
    </StateBox>
  </div>
</template>
