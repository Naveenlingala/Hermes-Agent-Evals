<script setup lang="ts">
import { computed } from 'vue';
import { apiLog } from '../api';

const pending = computed(() => apiLog.filter((c) => c.status === undefined && !c.error));
defineProps<{ loading?: boolean; error?: string | null; empty?: boolean; emptyText?: string }>();
defineEmits<{ retry: [] }>();
</script>
<template>
  <div v-if="loading" class="state" role="status" aria-live="polite"><span class="spin" aria-hidden="true" /> Loading…
    <ul v-if="pending.length" class="pend" aria-label="In-flight requests"><li v-for="c in pending" :key="c.n"><code>{{ c.method }} {{ c.path }}</code> <span>waiting…</span></li></ul></div>
  <div v-else-if="error" class="state bad" role="alert">
    <strong>Something went wrong.</strong> <span>{{ error }}</span>
    <button class="btn sm" @click="$emit('retry')">Retry</button>
  </div>
  <div v-else-if="empty" class="state">{{ emptyText ?? 'Nothing here yet.' }}</div>
  <slot v-else />
</template>
<style scoped>
.state { display: flex; gap: 10px; align-items: center; justify-content: center; flex-wrap: wrap; padding: 40px 20px; color: var(--text-2); }
.state.bad { color: var(--red-600); }
.pend { flex-basis: 100%; list-style: none; margin: 4px 0 0; padding: 0; text-align: center; font-size: 12px; color: var(--text-3); }
.spin { width: 16px; height: 16px; border: 2px solid var(--border-strong); border-top-color: var(--green-600); border-radius: 50%; animation: s .8s linear infinite; }
@keyframes s { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pend { flex-basis: 100%; list-style: none; margin: 4px 0 0; padding: 0; text-align: center; font-size: 12px; color: var(--text-3); }
.spin { animation: none; } }
</style>
