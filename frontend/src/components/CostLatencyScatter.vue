<script setup lang="ts">
import { computed } from 'vue';
import { ms, usd } from '../lib/format';
const props = defineProps<{ points: { name: string; cost: number; latency: number; color: string }[] }>();
const W = 460, H = 240, P = { l: 56, r: 24, t: 14, b: 40 };
const mx = computed(() => Math.max(...props.points.map((p) => p.cost), 1e-9) * 1.2);
const my = computed(() => Math.max(...props.points.map((p) => p.latency), 1) * 1.2);
const x = (c: number) => P.l + (c / mx.value) * (W - P.l - P.r);
const y = (l: number) => H - P.b - (l / my.value) * (H - P.t - P.b);
</script>
<template>
  <svg :viewBox="`0 0 ${W} ${H}`" class="sc" role="img" aria-label="Latency versus cost per run, by configuration (lower-left is better)">
    <line :x1="P.l" :x2="W - P.r" :y1="H - P.b" :y2="H - P.b" stroke="var(--border-strong)" />
    <line :x1="P.l" :x2="P.l" :y1="P.t" :y2="H - P.b" stroke="var(--border-strong)" />
    <text :x="(W + P.l) / 2" :y="H - 6" text-anchor="middle" class="ax">mean cost per run (est.) →</text>
    <text :x="12" :y="(H - P.b) / 2" class="ax" :transform="`rotate(-90 12 ${(H - P.b) / 2})`" text-anchor="middle">mean latency →</text>
    <text :x="P.l" :y="H - P.b + 14" class="tk">$0</text><text :x="W - P.r" :y="H - P.b + 14" class="tk" text-anchor="end">{{ usd(mx) }}</text>
    <text :x="P.l - 6" :y="H - P.b" class="tk" text-anchor="end">0</text><text :x="P.l - 6" :y="P.t + 8" class="tk" text-anchor="end">{{ ms(my) }}</text>
    <g v-for="(p, i) in points" :key="p.name">
      <circle :cx="x(p.cost)" :cy="y(p.latency)" r="7" :fill="p.color" stroke="#fff" stroke-width="2"><title>{{ p.name }}: {{ usd(p.cost) }}/run, {{ ms(p.latency) }}</title></circle>
      <text :x="x(p.cost) + (x(p.cost) > W * 0.6 ? -11 : 11)" :y="y(p.latency) + 4" class="lb" :text-anchor="x(p.cost) > W * 0.6 ? 'end' : 'start'">{{ ['A', 'B', 'C', 'D', 'E', 'F'][i] }} · {{ p.name }}</text>
    </g>
  </svg>
</template>
<style scoped>
.sc { width: 100%; height: auto; } .ax, .tk { font-size: 11px; fill: var(--text-3); } .lb { font-size: 12px; fill: var(--text); font-weight: 600; }
</style>
