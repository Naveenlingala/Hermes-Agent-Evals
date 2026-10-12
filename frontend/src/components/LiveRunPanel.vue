<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type { Experiment } from '@shared';
import { tokens, usd } from '../lib/format';
import { PHASES, eta, eventIcon, formatDuration as fmt, hhmmss, perConfigProgress, phaseStates } from '../lib/progress';

const props = defineProps<{ experiment: Experiment; runs: { configId: string }[]; names: Record<string, string> }>();

const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | undefined;
onMounted(() => { tick = setInterval(() => (now.value = Date.now()), 1000); });
onUnmounted(() => clearInterval(tick));

const running = computed(() => props.experiment.status === 'running');
const started = computed(() => Date.parse(props.experiment.createdAt));
const elapsed = computed(() => (props.experiment.finishedAt ? Date.parse(props.experiment.finishedAt) : now.value) - started.value);
const done = computed(() => props.experiment.progress.done);
const total = computed(() => props.experiment.progress.total);
const pct = computed(() => (total.value ? (done.value / total.value) * 100 : 0));
const left = computed(() => (running.value ? eta(started.value, now.value, done.value, total.value) : null));
const live = computed(() => props.experiment.live);
const runElapsed = computed(() => (live.value ? now.value - Date.parse(live.value.startedAt) : 0));
const steps = computed(() => phaseStates(live.value?.phase));
const c = computed(() => props.experiment.counters);
const events = computed(() => props.experiment.events ?? []);
const perConfig = computed(() => perConfigProgress(props.runs, props.experiment.configIds, props.experiment.taskIds.length * props.experiment.trials));
const headline = computed(() => (running.value ? 'Experiment running' : props.experiment.status === 'completed' ? 'Experiment completed' : 'Experiment failed'));

// Keep the newest log line in view unless the user scrolled up to read.
const logEl = ref<HTMLElement>();
let stick = true;
const onScroll = () => { const el = logEl.value; if (el) stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30; };
watch(() => events.value.length, async () => { if (!stick) return; await nextTick(); if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight; }, { immediate: true, flush: 'post' });
</script>

<template>
  <!-- Two roots on purpose: the bar is a direct child of the page so it can stay stuck to the top while results fill in below. -->
  <div class="livebar" :class="{ ok: experiment.status === 'completed', bad: experiment.status === 'failed' }">
    <div class="top">
      <span v-if="running" class="pulse" aria-hidden="true" />
      <span v-else class="state" aria-hidden="true">{{ experiment.status === 'completed' ? '✓' : '✕' }}</span>
      <strong>{{ headline }}</strong>
      <span class="faint num">elapsed {{ fmt(elapsed) }}<template v-if="left !== null"> · about {{ fmt(left) }} left</template></span>
      <span class="grow" />
      <span class="num strong">{{ done }} / {{ total }} runs</span>
    </div>
    <div class="bar" role="progressbar" :aria-valuenow="Math.round(pct)" aria-valuemin="0" aria-valuemax="100" aria-label="Experiment progress"><i :style="{ width: pct + '%' }" /></div>
    <p v-if="running" class="now" aria-live="polite">
      <span class="spin" aria-hidden="true" />
      <span v-if="live">Now testing <b>{{ live.configName }}</b> on <b>{{ live.taskName }}</b> <span class="faint">· trial {{ live.trial }}/{{ live.trials }} · run {{ live.runNumber }}/{{ live.total }}</span></span>
      <span v-else>Starting…</span>
    </p>
    <p v-else-if="experiment.status === 'failed'" class="now err">{{ experiment.error }}</p>
  </div>

  <section class="card body" aria-label="Run details">
    <div v-if="running && live" class="stepper">
      <ol class="steps" aria-label="Current run phases">
        <li v-for="(p, i) in PHASES" :key="p.key" :class="steps[i]">
          <span class="dot" aria-hidden="true">{{ steps[i] === 'done' ? '✓' : steps[i] === 'active' ? '' : i + 1 }}<i v-if="steps[i] === 'active'" class="spin sm" /></span>
          <span class="lbl">{{ p.label }}<template v-if="steps[i] === 'active'"> · {{ fmt(runElapsed) }}</template></span>
          <small v-if="steps[i] === 'active' && live.phase === 'judging' && live.label" class="faint">{{ live.label }}</small>
          <small v-else-if="steps[i] === 'active' && live.phase === 'agent'" class="faint">waiting for the agent to answer</small>
        </li>
      </ol>
    </div>

    <div v-if="c" class="counters">
      <div><span class="faint">Agent runs</span><strong class="num"><span class="g">✓ {{ c.agentOk }}</span> <span :class="c.agentFailed ? 'r' : 'faint'">✕ {{ c.agentFailed }}</span></strong></div>
      <div><span class="faint">Judge calls</span><strong class="num"><span class="g">✓ {{ c.judgeOk }}</span> <span :class="c.judgeFailed ? 'r' : 'faint'">✕ {{ c.judgeFailed }}</span></strong></div>
      <div><span class="faint">Runs passed / failed</span><strong class="num"><span class="g">{{ c.passed }}</span> / <span :class="c.failed ? 'r' : ''">{{ c.failed }}</span></strong></div>
      <div><span class="faint">Tokens</span><strong class="num">{{ tokens(c.tokens) }}</strong></div>
      <div><span class="faint">Est. cost so far</span><strong class="num">{{ usd(c.costUsd) }}</strong></div>
    </div>

    <div v-if="running" class="cfgs">
      <div v-for="p in perConfig" :key="p.configId" class="cfg"><span class="nm" :title="names[p.configId] ?? p.configId">{{ names[p.configId] ?? p.configId }}</span><span class="mini" role="progressbar" :aria-valuenow="Math.round(p.pct)" aria-valuemin="0" aria-valuemax="100" :aria-label="`${names[p.configId] ?? p.configId} progress`"><i :style="{ width: p.pct + '%' }" /></span><span class="num faint">{{ p.done }}/{{ p.total }}</span></div>
    </div>

    <details class="log" :open="running || experiment.status === 'failed'">
      <summary>Activity log <span class="faint">({{ events.length }}{{ events.length >= 150 ? '+, latest 150' : '' }})</span></summary>
      <ol ref="logEl" class="lines" role="log" aria-live="polite" @scroll="onScroll">
        <li v-for="(ev, i) in events" :key="i" :class="ev.level">
          <span class="ic" aria-hidden="true">{{ eventIcon(ev.level) }}</span><time>{{ hhmmss(ev.t) }}</time>
          <span class="msg"><span class="sr">{{ ev.level }}: </span>{{ ev.message }}</span>
          <RouterLink v-if="ev.runId" :to="`/runs/${ev.runId}`" class="open">open run</RouterLink>
        </li>
        <li v-if="!events.length" class="info"><span class="ic">•</span><span class="msg">Waiting for the first event…</span></li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.livebar { position: sticky; top: 0; z-index: 6; background: var(--surface); border: 1px solid var(--border); border-left: 4px solid var(--green-500); border-radius: var(--radius); box-shadow: var(--shadow-md); padding: 12px 16px; margin-bottom: 14px; }
.livebar.ok { border-left-color: var(--green-500); } .livebar.bad { border-left-color: var(--red-600); }
.top { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; } .grow { flex: 1; } .strong { font-weight: 700; }
.pulse { width: 10px; height: 10px; border-radius: 50%; background: var(--green-500); box-shadow: 0 0 0 0 rgba(18, 164, 85, .5); animation: pulse 1.6s infinite; }
.state { font-weight: 800; color: var(--green-700); } .bad .state { color: var(--red-600); }
.bar { height: 8px; background: var(--border); border-radius: 4px; margin: 10px 0 8px; overflow: hidden; } .bar i { display: block; height: 100%; background: var(--green-500); transition: width .4s; }
.now { margin: 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .now.err { color: var(--red-600); }
.spin { width: 14px; height: 14px; border: 2px solid var(--border-strong); border-top-color: var(--green-600); border-radius: 50%; animation: spin .8s linear infinite; flex: none; } .spin.sm { position: absolute; inset: -2px; width: auto; height: auto; }
.body { margin-bottom: 16px; padding: 14px 18px; display: grid; gap: 16px; }
.steps { list-style: none; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; }
.steps li { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: center; padding: 8px 10px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); color: var(--text-3); }
.steps li.active { border-color: var(--green-500); background: var(--green-100); color: var(--text); font-weight: 600; } .steps li.done { color: var(--green-700); }
.dot { position: relative; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; font-size: 12px; font-weight: 700; border: 1px solid currentColor; } .steps small { grid-column: 2; font-weight: 400; overflow-wrap: anywhere; }
.counters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; } .counters > div { display: grid; gap: 2px; padding: 8px 10px; background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-sm); } .counters strong { font-size: 16px; }
.g { color: var(--green-700); } .r { color: var(--red-600); }
.cfgs { display: grid; gap: 6px; } .cfg { display: grid; grid-template-columns: minmax(120px, 240px) 1fr 52px; gap: 10px; align-items: center; } .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.mini { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; } .mini i { display: block; height: 100%; background: var(--series-b); transition: width .4s; }
.log summary { cursor: pointer; font-weight: 650; margin-bottom: 8px; } .lines { list-style: none; margin: 0; padding: 0; max-height: 240px; overflow: auto; border: 1px solid var(--border); border-radius: var(--radius-sm); background: #0b1220; color: #d7e0f0; font-family: var(--mono); font-size: 12.5px; }
.lines li { display: grid; grid-template-columns: 18px 64px 1fr auto; gap: 8px; padding: 4px 10px; border-bottom: 1px solid rgba(255, 255, 255, .05); } .lines time { color: #7d8aa5; } .msg { overflow-wrap: anywhere; }
.lines .ok .ic { color: #5be08f; } .lines .error { background: rgba(196, 41, 31, .18); } .lines .error .ic { color: #ff8e86; } .lines .warn .ic { color: #ffc861; } .lines .info .ic { color: #7d8aa5; }
.open { color: #8fd3ff; } .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
@keyframes pulse { 70% { box-shadow: 0 0 0 9px rgba(18, 164, 85, 0); } 100% { box-shadow: 0 0 0 0 rgba(18, 164, 85, 0); } }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .pulse, .spin { animation: none; } .bar i, .mini i { transition: none; } }
@media (max-width: 860px) { .livebar { top: 48px; } .steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } .counters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .cfg { grid-template-columns: 1fr 1fr 48px; } .lines li { grid-template-columns: 16px 1fr; } .lines time { display: none; } }
</style>
