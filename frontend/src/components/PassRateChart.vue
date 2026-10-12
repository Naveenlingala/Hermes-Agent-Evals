<script setup lang="ts">
import { pct } from '../lib/format';
export interface Bar { name: string; rate: number; low: number; high: number; n: number; color: string }
defineProps<{ items: Bar[] }>();
</script>
<template>
  <div class="chart" role="img" :aria-label="'Pass rate by configuration: ' + items.map((i) => `${i.name} ${pct(i.rate)}`).join(', ')">
    <div v-for="i in items" :key="i.name" class="r">
      <div class="nm" :title="i.name">{{ i.name }}</div>
      <div class="track">
        <div class="fill" :style="{ width: i.rate * 100 + '%', background: i.color }" />
        <div class="whisker" :style="{ left: i.low * 100 + '%', width: (i.high - i.low) * 100 + '%' }" :title="`95% Wilson interval ${pct(i.low)} to ${pct(i.high)} (n=${i.n} runs, assumes independent runs)`"><i /></div>
      </div>
      <div class="val num"><strong>{{ pct(i.rate) }}</strong> <span class="faint">n={{ i.n }}</span></div>
    </div>
    <p class="faint note">Whisker = 95% Wilson interval over runs.</p>
  </div>
</template>
<style scoped>
.r { display: grid; grid-template-columns: minmax(90px, 160px) 1fr 100px; gap: 12px; align-items: center; margin-bottom: 12px; }
.nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.track { position: relative; height: 18px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 4px; }
.fill { position: absolute; inset: 0 auto 0 0; border-radius: 3px 0 0 3px; opacity: .9; }
.whisker { position: absolute; top: 50%; height: 2px; background: var(--text); transform: translateY(-50%); }
.whisker i { position: absolute; left: 0; right: 0; top: -5px; bottom: -5px; border-left: 2px solid var(--text); border-right: 2px solid var(--text); }
.val { text-align: right; } .note { font-size: 12px; }
@media (max-width: 620px) { .r { grid-template-columns: 1fr; gap: 4px; } .val { text-align: left; } }
</style>
