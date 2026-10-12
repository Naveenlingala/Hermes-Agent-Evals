<script setup lang="ts">
import { computed } from 'vue';
import type { Interval } from '@shared';
const props = defineProps<{ diff: number | null; interval: Interval | null; tone: 'good' | 'bad' | 'neutral' }>();
// Range is symmetric around zero so "crosses zero" is visible.
const span = computed(() => Math.max(Math.abs(props.interval?.low ?? 0), Math.abs(props.interval?.high ?? 0), Math.abs(props.diff ?? 0), 1e-12) * 1.15);
const pos = (v: number) => 50 + (v / span.value) * 50;
</script>
<template>
  <div v-if="interval && diff !== null" class="ci" :title="`95% bootstrap interval of the paired difference. ${interval.low <= 0 && interval.high >= 0 ? 'Includes zero: not distinguishable from no change.' : 'Excludes zero.'}`">
    <div class="zero" />
    <div class="range" :class="tone" :style="{ left: pos(interval.low) + '%', width: pos(interval.high) - pos(interval.low) + '%' }" />
    <div class="dot" :style="{ left: pos(diff) + '%' }" />
  </div>
  <span v-else class="faint" title="Not enough paired tasks to report an interval">no interval</span>
</template>
<style scoped>
.ci { position: relative; height: 14px; min-width: 110px; background: var(--surface-2); border-radius: 3px; }
.zero { position: absolute; left: 50%; top: -2px; bottom: -2px; border-left: 1px dashed var(--text-3); }
.range { position: absolute; top: 5px; height: 4px; border-radius: 2px; background: var(--border-strong); }
.range.good { background: #8dd6ad; } .range.bad { background: #ee9b94; }
.dot { position: absolute; top: 2px; width: 10px; height: 10px; margin-left: -5px; border-radius: 50%; background: var(--text); }
</style>
