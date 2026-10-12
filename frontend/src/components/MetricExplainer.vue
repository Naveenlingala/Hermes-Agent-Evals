<script setup lang="ts">
import { computed } from 'vue';
import type { MetricInfo } from '@shared';
import { GLOSSARY, groupMetrics } from '../lib/metrics';
import MetricCard from './MetricCard.vue';

const props = defineProps<{ metrics: MetricInfo[]; glossary?: boolean }>();
const groups = computed(() => groupMetrics(props.metrics));
</script>
<template>
  <div class="explainer">
    <section v-for="g in groups" :key="g.key">
      <h3>{{ g.title }}</h3><p class="muted blurb">{{ g.blurb }}</p>
      <div class="cards"><MetricCard v-for="m in g.metrics" :id="`metric-${m.key}`" :key="m.key" :metric="m" /></div>
    </section>
    <section v-if="glossary">
      <h3>Reading the statistics</h3><p class="muted blurb">Terms used in the comparison above.</p>
      <dl class="gl"><template v-for="t in GLOSSARY" :key="t.term"><dt>{{ t.term }}</dt><dd>{{ t.text }}</dd></template></dl>
    </section>
  </div>
</template>
<style scoped>
.explainer { display: grid; gap: 22px; } h3 { margin: 0; } .blurb { margin: 2px 0 10px; font-size: 13px; } .cards { display: grid; gap: 12px; }
.gl { display: grid; grid-template-columns: 180px 1fr; gap: 8px 16px; margin: 0; } .gl dt { font-weight: 650; } .gl dd { margin: 0; }
@media (max-width: 620px) { .gl { grid-template-columns: 1fr; gap: 0; } .gl dt { margin-top: 10px; } }
</style>
