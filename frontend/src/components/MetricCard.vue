<script setup lang="ts">
import type { MetricInfo } from '@shared';
defineProps<{ metric: MetricInfo }>();
</script>
<template>
  <article class="mcard">
    <header><h4>{{ metric.label }}</h4><span class="dir">{{ metric.direction }}</span></header>
    <p class="sum">{{ metric.summary }}</p>
    <dl>
      <dt>How it is computed</dt><dd>{{ metric.howComputed }}</dd>
      <dt>Deterministic version</dt><dd>{{ metric.deterministic }}</dd>
      <dt>LLM-judge version</dt><dd>{{ metric.llm }}</dd>
      <dt>A low value suggests</dt><dd>{{ metric.badMeans }}</dd>
      <dt>When it is N/A</dt><dd>{{ metric.naMeans }}</dd>
      <dt>Example</dt><dd class="ex">{{ metric.example }}</dd>
    </dl>
  </article>
</template>
<style scoped>
.mcard { border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 14px 16px; background: var(--surface); }
header { display: flex; justify-content: space-between; gap: 10px; align-items: baseline; flex-wrap: wrap; } h4 { margin: 0; font-size: 15px; } .dir { font-size: 12px; color: var(--text-3); }
.sum { margin: 4px 0 10px; font-weight: 550; }
dl { display: grid; grid-template-columns: 150px 1fr; gap: 6px 14px; margin: 0; } dt { color: var(--text-3); font-size: 12.5px; } dd { margin: 0; overflow-wrap: anywhere; } .ex { font-family: var(--mono); font-size: 12.5px; }
@media (max-width: 620px) { dl { grid-template-columns: 1fr; gap: 0; } dt { margin-top: 8px; } }
</style>
