<script setup lang="ts">
import { pct, signed } from '../lib/format';
defineProps<{ rows: { id: string; name: string; delta: number | null }[] }>();
const sorted = <T extends { delta: number | null }>(r: T[]) => [...r].filter((x) => x.delta !== null).sort((a, b) => a.delta! - b.delta!);
</script>
<template>
  <div class="d" role="img" aria-label="Per-task change in pass rate, B minus A">
    <div v-for="r in sorted(rows)" :key="r.id" class="row">
      <div class="nm" :title="r.name">{{ r.name }}</div>
      <div class="axis">
        <div class="mid" />
        <div class="bar" :class="r.delta! > 0 ? 'up' : r.delta! < 0 ? 'down' : 'flat'" :style="r.delta! >= 0 ? { left: '50%', width: r.delta! * 50 + '%' } : { right: '50%', width: -r.delta! * 50 + '%' }" />
      </div>
      <div class="v num">{{ r.delta === 0 ? '0 (tie)' : signed(r.delta!, (n) => pct(n)) }}</div>
    </div>
    <div class="legend faint"><span>◀ regression (B worse)</span><span>improvement (B better) ▶</span></div>
  </div>
</template>
<style scoped>
.row { display: grid; grid-template-columns: minmax(100px, 170px) 1fr 74px; gap: 10px; align-items: center; margin-bottom: 8px; }
.nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.axis { position: relative; height: 14px; background: var(--surface-2); border-radius: 3px; }
.mid { position: absolute; left: 50%; top: -2px; bottom: -2px; border-left: 1px solid var(--border-strong); }
.bar { position: absolute; top: 2px; bottom: 2px; border-radius: 2px; }
.up { background: var(--green-500); } .down { background: var(--red-600); } .flat { background: transparent; }
.v { text-align: right; font-size: 12.5px; }
.legend { display: flex; justify-content: space-between; font-size: 12px; margin-top: 6px; }
</style>
