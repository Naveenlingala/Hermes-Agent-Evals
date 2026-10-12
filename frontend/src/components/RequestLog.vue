<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue';
import { api, apiLog, type TraceEntry } from '../api';
import { ui } from '../ui';

const tab = ref<'client' | 'backend'>('client');
const open = ref<number | null>(null);
const trace = ref<TraceEntry[]>([]);
const traceErr = ref<string | null>(null);
let timer: ReturnType<typeof setInterval> | undefined;
async function poll() {
  try {
    const more = await api.trace(trace.value.at(-1)?.seq ?? 0);
    if (more.length) trace.value = [...trace.value, ...more].slice(-300);
    traceErr.value = null;
  } catch (e) { traceErr.value = (e as Error).message; }
}
watch(() => ui.logOpen && tab.value === 'backend', (on) => {
  clearInterval(timer);
  if (on) { poll(); timer = setInterval(poll, 2000); }
}, { immediate: true });
onUnmounted(() => clearInterval(timer));
const tone = (s?: number, err?: string) => (err || (s ?? 0) >= 400 ? 'bad' : s === undefined ? 'wait' : 'ok');
const time = (iso: string) => iso.slice(11, 23);
</script>
<template>
  <section v-if="ui.logOpen" class="log" aria-label="Request log">
    <header>
      <strong>Request log</strong>
      <div class="tabs" role="group" aria-label="Log source">
        <button :aria-pressed="tab === 'client'" @click="tab = 'client'">Browser ({{ apiLog.length }})</button>
        <button :aria-pressed="tab === 'backend'" @click="tab = 'backend'">Backend trace</button>
      </div>
      <button class="btn sm" @click="ui.logOpen = false">Close</button>
    </header>
    <div v-if="tab === 'client'" class="body">
      <p v-if="!apiLog.length" class="dim">No requests yet.</p>
      <table v-else>
        <thead><tr><th>Time</th><th>Request</th><th>Status</th><th>ms</th><th>Trace id</th></tr></thead>
        <tbody>
          <template v-for="c in apiLog" :key="c.n">
            <tr class="row" tabindex="0" :aria-expanded="open === c.n" @click="open = open === c.n ? null : c.n" @keydown.enter="open = open === c.n ? null : c.n">
              <td>{{ time(c.startedAt) }}</td><td><code>{{ c.method }} {{ c.path }}</code></td>
              <td><span class="pill" :class="tone(c.status, c.error)">{{ c.error && c.status === undefined ? 'FAILED' : c.status ?? 'pending…' }}</span></td>
              <td>{{ c.ms ?? '…' }}</td><td><code>{{ c.traceId ?? '–' }}</code></td>
            </tr>
            <tr v-if="open === c.n"><td colspan="5" class="det">
              <div v-if="c.error" class="err-text">{{ c.error }}</div>
              <div v-if="c.request"><b>Request</b><pre>{{ c.request }}</pre></div>
              <div v-if="c.response"><b>Response</b><pre>{{ c.response }}</pre></div>
            </td></tr>
          </template>
        </tbody>
      </table>
    </div>
    <div v-else class="body">
      <p v-if="traceErr" class="err-text">{{ traceErr }}</p>
      <p v-else-if="!trace.length" class="dim">No backend entries yet.</p>
      <table v-else>
        <thead><tr><th>Time</th><th>Kind</th><th>Entry</th><th>Status</th><th>ms</th><th>Id</th></tr></thead>
        <tbody><tr v-for="e in [...trace].reverse()" :key="e.seq">
          <td>{{ time(e.ts) }}</td><td>{{ e.kind }}</td>
          <td><code>{{ e.name }}</code><div v-if="e.attrs" class="dim">{{ JSON.stringify(e.attrs) }}</div><div v-if="e.requestBody" class="dim">{{ e.requestBody }}</div></td>
          <td><span v-if="e.status" class="pill" :class="tone(e.status)">{{ e.status }}</span></td><td>{{ e.durationMs ?? '' }}</td><td><code>{{ e.id ?? '' }}</code></td>
        </tr></tbody>
      </table>
    </div>
  </section>
</template>
<style scoped>
.log { position: fixed; z-index: 40; left: 252px; right: 0; bottom: 0; height: 42vh; background: var(--surface); border-top: 2px solid var(--navy-900); box-shadow: 0 -4px 16px rgba(10, 23, 48, .12); display: flex; flex-direction: column; }
header { display: flex; align-items: center; gap: 14px; padding: 8px 14px; border-bottom: 1px solid var(--border); } header .btn { margin-left: auto; }
.body { overflow: auto; padding: 0 14px 14px; font-size: 12.5px; } .dim { color: var(--text-3); }
.row { cursor: pointer; } .row:focus-visible { outline: 2px solid var(--green-600); }
.pill { font-weight: 700; padding: 1px 8px; border-radius: 10px; border: 1px solid currentColor; } .pill.ok { color: var(--green-700); } .pill.bad { color: var(--red-600); } .pill.wait { color: var(--text-3); }
.det { background: var(--surface-2); } pre { white-space: pre-wrap; word-break: break-word; margin: 2px 0 8px; font-size: 12px; }
@media (max-width: 860px) { .log { left: 0; height: 60vh; } }
</style>
