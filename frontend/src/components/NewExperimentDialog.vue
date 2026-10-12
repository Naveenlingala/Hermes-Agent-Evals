<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { AgentConfig, Task } from '@shared';
import { ApiError, api } from '../api';
import { ui } from '../ui';
import StatusBadge from './StatusBadge.vue';

const router = useRouter();
const dlg = ref<HTMLDialogElement>();
const tasks = ref<Task[]>([]);
const configs = ref<AgentConfig[]>([]);
const name = ref('');
const trials = ref(3);
const selTasks = ref<string[]>([]);
const selConfigs = ref<string[]>([]);
const errors = ref<string[]>([]);
const loadError = ref('');
const busy = ref(false);

watch(() => ui.newExperimentOpen, async (open) => {
  if (open) {
    errors.value = []; loadError.value = '';
    try {
      [tasks.value, configs.value] = await Promise.all([api.tasks(), api.configs()]);
      if (!selTasks.value.length) selTasks.value = tasks.value.filter((t) => t.mock).map((t) => t.id);
      if (!selConfigs.value.length) selConfigs.value = configs.value.filter((c) => c.runner === 'mock').slice(0, 2).map((c) => c.id);
    } catch (e) { loadError.value = (e as Error).message; }
    dlg.value?.showModal();
  } else dlg.value?.close();
});

const mockSelected = computed(() => configs.value.some((c) => selConfigs.value.includes(c.id) && c.runner === 'mock'));
const runnable = (t: Task) => !!t.mock || !mockSelected.value;
const shownTasks = computed(() => tasks.value);
watch(mockSelected, () => { selTasks.value = selTasks.value.filter((id) => runnable(tasks.value.find((t) => t.id === id)!)); });
const usesHermes = computed(() => configs.value.some((c) => selConfigs.value.includes(c.id) && c.runner === 'hermes'));
const total = computed(() => selTasks.value.length * selConfigs.value.length * trials.value);
const toggle = (arr: string[], id: string) => (arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id]);

async function submit() {
  errors.value = [];
  if (!name.value.trim()) errors.value.push('Give the experiment a name.');
  if (!selTasks.value.length) errors.value.push('Select at least one task.');
  if (selConfigs.value.length < 2) errors.value.push('Select at least two configurations to compare.');
  if (errors.value.length) return;
  busy.value = true;
  try {
    const e = await api.createExperiment({ name: name.value, taskIds: selTasks.value, configIds: selConfigs.value, trials: trials.value });
    ui.newExperimentOpen = false; name.value = '';
    router.push(`/experiments/${e.id}`);
  } catch (e) { errors.value = e instanceof ApiError && e.errors.length ? e.errors : [(e as Error).message]; }
  busy.value = false;
}
</script>
<template>
  <dialog ref="dlg" aria-labelledby="ne-title" @close="ui.newExperimentOpen = false">
    <form class="wrap" @submit.prevent="submit">
      <div class="hd"><h2 id="ne-title">New experiment</h2><button type="button" class="btn sm" @click="ui.newExperimentOpen = false" aria-label="Close">✕</button></div>
      <div class="bd">
        <p v-if="loadError" class="err-text" role="alert">{{ loadError }}</p>
        <div class="field"><label for="ne-name">Name</label><input id="ne-name" v-model="name" type="text" maxlength="120" placeholder="e.g. Toolset ablation, week 41" /></div>
        <fieldset class="field"><legend class="label">Configurations <span class="faint">(pick 2 or more; first is baseline A)</span></legend>
          <label v-for="c in configs" :key="c.id" class="opt" :class="{ on: selConfigs.includes(c.id) }">
            <input type="checkbox" :checked="selConfigs.includes(c.id)" @change="selConfigs = toggle(selConfigs, c.id)" />
            <span><strong>{{ c.name }}</strong> <StatusBadge :kind="c.runner === 'mock' ? 'mock' : 'info'">{{ c.runner === 'mock' ? 'mock' : 'real Hermes' }}</StatusBadge><br /><span class="faint">{{ c.model }} · tools: {{ c.toolsets?.length ? c.toolsets.join('+') : 'default' }} · skills: {{ c.skills?.length ? c.skills.join('+') : 'none' }} · memory {{ c.memory ?? 'on' }}</span></span>
          </label>
        </fieldset>
        <p v-if="usesHermes" class="mock-banner" role="note">A real Hermes config is selected: this runs the local <code>hermes</code> CLI for every run and may take time and incur model cost.</p>
        <fieldset class="field"><legend class="label">Tasks <button type="button" class="btn sm" @click="selTasks = selTasks.length ? [] : tasks.filter(runnable).map((t) => t.id)">{{ selTasks.length ? 'Clear' : 'Select all runnable' }}</button></legend>
          <div class="tasks"><label v-for="t in shownTasks" :key="t.id" class="opt sm" :class="{ on: selTasks.includes(t.id), off: !runnable(t) }"><input type="checkbox" :disabled="!runnable(t)" :checked="selTasks.includes(t.id)" @change="selTasks = toggle(selTasks, t.id)" /><span>{{ t.name }} <span class="faint">· {{ t.category }}<template v-if="!t.mock"> · real Hermes only{{ !runnable(t) ? ' (deselect mock configs to enable)' : '' }}</template></span></span></label></div>
        </fieldset>
        <div class="field"><label for="ne-trials">Trials per task <span class="faint">(repeat runs reveal variance; ≥3 recommended)</span></label><input id="ne-trials" v-model.number="trials" type="number" min="1" max="20" /></div>
        <ul v-if="errors.length" class="err-text" role="alert"><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </div>
      <div class="ft"><span class="faint">{{ total }} runs</span><button class="btn primary" :disabled="busy">{{ busy ? 'Starting…' : 'Run experiment' }}</button></div>
    </form>
  </dialog>
</template>
<style scoped>
.wrap { display: flex; flex-direction: column; max-height: calc(100vh - 32px); } .hd, .ft { display: flex; justify-content: space-between; align-items: center; padding: 14px 20px; } .hd { border-bottom: 1px solid var(--border); } .ft { border-top: 1px solid var(--border); }
.bd { padding: 18px 20px; overflow: auto; } fieldset { border: 0; padding: 0; margin: 0 0 14px; min-width: 0; } legend { display: flex; gap: 10px; align-items: center; margin-bottom: 8px; padding: 0; }
.opt { display: flex; gap: 10px; align-items: flex-start; border: 1px solid var(--border); border-radius: var(--radius-sm); padding: 9px 12px; margin-bottom: 6px; cursor: pointer; } .opt.on { border-color: var(--green-500); background: var(--green-100); } .opt.sm { padding: 6px 10px; }
.opt.off { opacity: .55; cursor: not-allowed; } .opt input { margin-top: 3px; accent-color: var(--green-600); } .tasks { max-height: 190px; overflow: auto; }
</style>
