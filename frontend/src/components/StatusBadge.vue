<script setup lang="ts">
defineProps<{ kind: 'pass' | 'fail' | 'warn' | 'info' | 'mock' | 'neutral' }>();
const icon = { pass: '✓', fail: '✕', warn: '!', info: 'i', mock: '◇', neutral: '•' } as const;
</script>
<template>
  <span class="badge" :class="kind"><span class="ic" aria-hidden="true">{{ icon[kind] }}</span><slot /></span>
</template>
<style scoped>
.badge { display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 7px; border-radius: 999px; font-size: 12px; font-weight: 650; white-space: nowrap; border: 1px solid transparent; }
.ic { font-weight: 800; font-size: 11px; }
.pass { background: var(--green-100); color: var(--green-700); border-color: #bfe8cf; }
.fail { background: var(--red-100); color: var(--red-600); border-color: #f6c2bd; }
.warn, .mock { background: var(--amber-100); color: var(--amber-600); border-color: #f1d28a; }
.info { background: var(--blue-100); color: var(--blue-600); border-color: #c5d4f7; }
.neutral { background: var(--surface-2); color: var(--text-2); border-color: var(--border); }
</style>
