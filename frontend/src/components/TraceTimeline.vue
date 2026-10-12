<script setup lang="ts">
import type { TraceEvent } from '@shared';
import { ms } from '../lib/format';
defineProps<{ events: TraceEvent[]; highlightTools?: string[] }>();
const label: Record<string, string> = { message: 'Message', tool_call: 'Tool call', tool_result: 'Tool result', error: 'Error', retry: 'Retry' };
const body = (e: TraceEvent) => (e.type === 'tool_call' ? JSON.stringify(e.args, null, 2) : e.content);
</script>
<template>
  <ol class="tl" v-if="events.length">
    <li v-for="(e, i) in events" :id="`ev-${i}`" :key="i" :class="[e.type, { hl: e.type === 'tool_call' && highlightTools?.includes(e.tool) }]">
      <div class="meta">
        <span class="t num">+{{ ms(e.t) }}</span>
        <strong>{{ label[e.type] }}</strong>
        <code v-if="e.type === 'tool_call'" class="mono tool">{{ e.tool }}</code>
        <span v-if="e.type === 'message'" class="faint">{{ e.role }}</span>
        <span v-if="e.type === 'tool_result' && e.isError" class="err-text">error</span>
      </div>
      <!-- Agent-produced text: rendered as plain text only, never executed or interpreted as HTML -->
      <pre class="mono body">{{ body(e) }}</pre>
    </li>
  </ol>
  <p v-else class="faint pad">No trace events were recorded for this run.</p>
</template>
<style scoped>
.tl { list-style: none; margin: 0; padding: 0 20px 8px 34px; border-left: 2px solid var(--border); margin-left: 20px; }
li { position: relative; padding: 12px 0; }
li::before { content: ''; position: absolute; left: -41px; top: 17px; width: 12px; height: 12px; border-radius: 50%; background: var(--surface); border: 3px solid var(--border-strong); }
li.tool_call::before { border-color: var(--blue-600); } li.tool_result::before { border-color: var(--green-500); }
li.error::before, li.retry::before { border-color: var(--red-600); } li.hl { background: linear-gradient(90deg, var(--blue-100), transparent); margin-left: -8px; padding-left: 8px; }
.meta { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; } .t { color: var(--text-3); font-size: 12px; min-width: 56px; }
.tool { background: var(--blue-100); color: var(--blue-600); padding: 1px 7px; border-radius: 4px; }
.body { margin: 6px 0 0; white-space: pre-wrap; word-break: break-word; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 8px 10px; max-height: 240px; overflow: auto; }
.pad { padding: 20px; }
</style>
