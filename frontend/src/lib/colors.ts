export const SERIES = ['#5b6b84', '#12a455', '#2a5bd7', '#b7791f', '#8b5cf6', '#0e9aa7'];
export const seriesColor = (i: number) => SERIES[i % SERIES.length];

import { api } from '../api';
import { ref } from 'vue';

const order = ref<string[]>([]);
api.configs().then((c) => (order.value = c.map((x) => x.id))).catch(() => {});
/** Stable per-config colour (position in the config list), consistent across pages. */
export const configColor = (id: string) => seriesColor(Math.max(0, order.value.indexOf(id)));
