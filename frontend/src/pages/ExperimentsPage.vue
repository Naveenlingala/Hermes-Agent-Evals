<script setup lang="ts">
import { api } from '../api';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { when } from '../lib/format';
import { useAsync } from '../lib/useAsync';
import { ui } from '../ui';

const { data, error, loading, reload } = useAsync(api.experiments, { keepPolling: (d) => d.some((e) => e.status === 'running') });
</script>
<template>
  <div class="page">
    <div class="page-head"><div><h1>Experiments</h1><p class="muted">Each experiment runs the same tasks against several configurations.</p></div><button class="btn primary" @click="ui.newExperimentOpen = true">＋ New Experiment</button></div>
    <StateBox :loading="loading" :error="error" :empty="data?.length === 0" empty-text="No experiments yet." @retry="reload">
      <div class="card table-wrap"><table><thead><tr><th>Name</th><th>Data</th><th>Status</th><th>Progress</th><th>Configs × tasks × trials</th><th>Started</th></tr></thead><tbody>
        <tr v-for="e in data" :key="e.id">
          <td><RouterLink :to="`/experiments/${e.id}`"><strong>{{ e.name }}</strong></RouterLink><div v-if="e.status === 'running'" class="faint small" aria-live="polite">{{ e.live ? `Now: ${e.live.configName} · ${e.live.taskName} (trial ${e.live.trial}/${e.live.trials})` : 'Starting…' }}</div></td>
          <td><StatusBadge :kind="e.mode === 'mock' ? 'mock' : 'info'">{{ e.mode === 'mock' ? 'mock' : e.mode === 'hermes' ? 'real Hermes' : 'mixed' }}</StatusBadge></td>
          <td><StatusBadge :kind="e.status === 'completed' ? 'pass' : e.status === 'failed' ? 'fail' : 'warn'">{{ e.status }}</StatusBadge></td>
          <td class="num">{{ e.progress.done }}/{{ e.progress.total }}<div v-if="e.status === 'running'" class="mini" role="progressbar" :aria-valuenow="Math.round((e.progress.done / e.progress.total) * 100)" aria-valuemin="0" aria-valuemax="100"><i :style="{ width: (e.progress.done / e.progress.total) * 100 + '%' }" /></div></td>
          <td class="num">{{ e.configIds.length }} × {{ e.taskIds.length }} × {{ e.trials }}</td>
          <td class="muted">{{ when(e.createdAt) }}</td>
        </tr></tbody></table></div>
    </StateBox>
  </div>
</template>
<style scoped>
.small { font-size: 12px; } .mini { width: 90px; height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 4px; } .mini i { display: block; height: 100%; background: var(--green-500); transition: width .4s; }
</style>
