<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import type { Experiment } from '@shared';
import { api, apiLog, type Health } from './api';
import NewExperimentDialog from './components/NewExperimentDialog.vue';
import RequestLog from './components/RequestLog.vue';
import { ui } from './ui';

const health = ref<Health | null>(null);
const down = ref(false);
onMounted(async () => { try { health.value = await api.health(); } catch { down.value = true; } });
// Global "an experiment is running" indicator: polls only while something runs, so progress stays visible from any page.
const route = useRoute();
const runningExps = ref<Experiment[]>([]);
let pollTimer: ReturnType<typeof setTimeout> | undefined;
async function checkRunning() {
  clearTimeout(pollTimer);
  try { runningExps.value = (await api.experiments()).filter((e) => e.status === 'running'); } catch { /* backend down: keep last state */ }
  if (runningExps.value.length) pollTimer = setTimeout(checkRunning, 2000);
}
onMounted(checkRunning);
onUnmounted(() => clearTimeout(pollTimer));
watch(() => route.fullPath, checkRunning);
const topRunning = computed(() => runningExps.value[0]);
watch(topRunning, (e) => { document.title = e ? `(${e.progress.done}/${e.progress.total}) Agent Evals` : 'Agent Evals'; }, { deep: true, immediate: true });
const confirming = ref(false);
const resetting = ref(false);
const resetError = ref<string | null>(null);
async function doReset() {
  resetting.value = true; resetError.value = null;
  try { await api.reset(); window.location.assign('/'); }
  catch (e) { resetError.value = (e as Error).message; confirming.value = false; }
  finally { resetting.value = false; }
}
const nav = [
  { to: '/', label: 'Overview', d: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/experiments', label: 'Experiments', d: 'M9 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-10V3M8 3h8' },
  { to: '/tasks', label: 'Tasks', d: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2' },
  { to: '/configs', label: 'Agent Configurations', d: 'M4 6h10M18 6h2M4 12h2M10 12h10M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4' },
  { to: '/evaluators', label: 'Evaluators', d: 'M12 3l8 4v5c0 5-3.5 8-8 9-4.5-1-8-4-8-9V7zM9 12l2 2 4-4' },
];
</script>
<template>
  <a href="#main" class="skip">Skip to content</a>
  <div class="shell">
    <header class="topbar">
      <button class="burger" :aria-expanded="ui.navOpen" aria-controls="side" aria-label="Toggle navigation" @click="ui.navOpen = !ui.navOpen">☰</button>
      <strong>Agent Evals</strong>
      <RouterLink v-if="topRunning" :to="`/experiments/${topRunning.id}`" class="topchip"><span class="pulse" aria-hidden="true" />{{ topRunning.progress.done }}/{{ topRunning.progress.total }}</RouterLink>
    </header>
    <aside id="side" class="side" :class="{ open: ui.navOpen }">
      <div class="brand"><span class="logo" aria-hidden="true">◆</span> Agent Evals<small>for Hermes Agent</small></div>
      <button class="cta" @click="ui.newExperimentOpen = true">＋ New Experiment</button>
      <RouterLink v-if="topRunning" :to="`/experiments/${topRunning.id}`" class="chip" aria-live="polite">
        <span class="pulse" aria-hidden="true" /><span class="ct"><strong>Running · {{ topRunning.progress.done }}/{{ topRunning.progress.total }}</strong><small>{{ topRunning.live ? `${topRunning.live.configName} · ${topRunning.live.taskName}` : topRunning.name }}</small></span>
      </RouterLink>
      <nav aria-label="Primary">
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="nav" active-class="" exact-active-class="" :class="{ on: $route.path === n.to || (n.to !== '/' && $route.path.startsWith(n.to + '/')) }">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="n.d" /></svg>{{ n.label }}
        </RouterLink>
      </nav>
      <div class="foot">
        <button class="linkbtn" :aria-expanded="ui.logOpen" @click="ui.logOpen = !ui.logOpen">▤ Request log ({{ apiLog.length }})</button>
        <div class="reset">
          <button v-if="!confirming" class="linkbtn danger" @click="confirming = true">Reset all data</button>
          <div v-else role="alertdialog" aria-label="Confirm reset" class="confirm">
            <span>Delete all tasks, configs, experiments and runs?</span>
            <button class="dbtn" :disabled="resetting" @click="doReset">{{ resetting ? 'Deleting…' : 'Yes, delete everything' }}</button>
            <button class="linkbtn" :disabled="resetting" @click="confirming = false">Cancel</button>
          </div>
          <div v-if="resetError" class="st bad" role="alert">{{ resetError }}</div>
        </div>
        <div v-if="down" class="st bad">● Backend unreachable</div>
        <template v-else-if="health"><div class="st">● Backend ready</div><div class="st dim">Judge: {{ health.judge.mode === 'mock' ? 'mock (no API key)' : health.judge.model }}</div></template>
        <div v-else class="st dim">Connecting…</div>
      </div>
    </aside>
    <div v-if="ui.navOpen" class="scrim" @click="ui.navOpen = false" />
    <main id="main" class="main"><RouterView /></main>
  </div>
  <NewExperimentDialog />
  <RequestLog />
</template>
<style scoped>
.shell { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100%; }
.side { background: var(--navy-900); color: var(--navy-text); padding: 20px 14px; display: flex; flex-direction: column; gap: 18px; position: sticky; top: 0; height: 100vh; }
.brand { color: var(--navy-text-strong); font-weight: 700; font-size: 17px; display: grid; grid-template-columns: auto 1fr; column-gap: 8px; align-items: center; padding: 0 8px; } .brand small { grid-column: 2; color: var(--navy-text); font-weight: 500; font-size: 12px; } .logo { color: #3ddc84; font-size: 20px; grid-row: span 2; }
.cta { background: var(--green-500); color: #04210f; border: 0; font: inherit; font-weight: 700; padding: 11px 14px; border-radius: var(--radius-sm); cursor: pointer; text-align: left; } .cta:hover { background: #2bbd6a; }
nav { display: grid; gap: 2px; } .nav { display: flex; align-items: center; gap: 11px; padding: 9px 12px; border-radius: var(--radius-sm); color: var(--navy-text); font-weight: 550; text-decoration: none; } .nav:hover { background: var(--navy-800); color: #fff; text-decoration: none; }
.nav.on { background: var(--navy-700); color: #fff; box-shadow: inset 3px 0 0 #3ddc84; }
.foot { margin-top: auto; font-size: 12px; padding: 0 8px; } .st { color: #7ee2a8; } .st.dim { color: var(--navy-text); } .st.bad { color: #ff8e86; }
.linkbtn { background: none; border: 0; padding: 4px 0; color: var(--navy-text); font: inherit; cursor: pointer; text-align: left; display: block; } .linkbtn:hover { color: #fff; } .linkbtn.danger { color: #ff8e86; }
.reset { margin-bottom: 10px; } .confirm { display: grid; gap: 6px; color: #ffd0cc; } .dbtn { background: #c4291f; color: #fff; border: 0; font: inherit; font-weight: 700; padding: 7px 10px; border-radius: var(--radius-sm); cursor: pointer; } .dbtn:disabled { opacity: .6; }
.main { min-width: 0; } .topbar, .scrim { display: none; }
.chip { display: flex; gap: 10px; align-items: center; padding: 9px 12px; border-radius: var(--radius-sm); background: var(--navy-700); color: #fff; text-decoration: none; border: 1px solid rgba(61, 220, 132, .35); } .chip:hover { background: var(--navy-800); text-decoration: none; }
.ct { display: grid; min-width: 0; } .ct small { color: var(--navy-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; }
.pulse { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #3ddc84; animation: pulse 1.6s infinite; } .topchip { margin-left: auto; display: inline-flex; gap: 6px; align-items: center; color: #fff; font-weight: 700; text-decoration: none; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(61, 220, 132, .55); } 70% { box-shadow: 0 0 0 9px rgba(61, 220, 132, 0); } 100% { box-shadow: 0 0 0 0 rgba(61, 220, 132, 0); } }
@media (prefers-reduced-motion: reduce) { .pulse { animation: none; } }
.skip { position: absolute; left: -999px; } .skip:focus { left: 8px; top: 8px; z-index: 50; background: #fff; padding: 8px 12px; }
:global(.side a:focus-visible), :global(.cta:focus-visible) { box-shadow: 0 0 0 3px rgba(61, 220, 132, .5); }
@media (max-width: 860px) {
  .shell { grid-template-columns: minmax(0, 1fr); }
  .topbar { display: flex; align-items: center; gap: 12px; background: var(--navy-900); color: #fff; padding: 10px 14px; position: sticky; top: 0; z-index: 20; } .burger { background: none; border: 1px solid var(--navy-700); color: #fff; font-size: 18px; border-radius: 6px; padding: 2px 10px; cursor: pointer; }
  .side { position: fixed; z-index: 30; inset: 0 auto 0 0; width: 270px; transform: translateX(-100%); transition: transform .18s; } .side.open { transform: none; }
  .scrim { display: block; position: fixed; inset: 0; background: rgba(10, 23, 48, .5); z-index: 25; }
}
@media (prefers-reduced-motion: reduce) { .side { transition: none; } }
</style>
