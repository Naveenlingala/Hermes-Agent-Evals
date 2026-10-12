<script setup lang="ts">
import { computed, ref } from 'vue';
import { ApiError, api } from '../api';
import MultiSelect from '../components/MultiSelect.vue';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAsync } from '../lib/useAsync';

const { data, error, loading, reload } = useAsync(api.configs);
const dlg = ref<HTMLDialogElement>();
const blank = () => ({ name: '', description: '', runner: 'mock', model: '', provider: '', inputPerMTok: 0, outputPerMTok: 0, mockSkill: 0.5, toolsets: [] as string[], skills: [] as string[], memory: 'on', maxTurns: null as number | null });
const cat = useAsync(() => api.hermesCatalog());
const toolsetOpts = computed(() => (cat.data.value?.toolsets ?? []).map((t) => ({ value: t.name, label: t.label, group: t.group, hint: t.enabled ? undefined : '(off in Hermes cli)' })));
const skillOpts = computed(() => (cat.data.value?.skills ?? []).map((k) => ({ value: k.name, group: k.group, hint: k.enabled ? undefined : '(disabled)' })));
const modelOpts = computed(() => {
  const d = cat.data.value; const seen = new Set<string>();
  const o = [{ value: 'default', group: 'Hermes', hint: d?.defaultModel ? `→ ${d.defaultModel}${d.defaultProvider ? ` via ${d.defaultProvider}` : ''}` : 'use the model Hermes is configured with' }];
  if (d?.defaultModel) o.push({ value: d.defaultModel, group: 'Hermes', hint: 'configured default' });
  for (const m of d?.usedModels ?? []) o.push({ value: m, group: 'Used by saved configs', hint: '' });
  return o.filter((x) => !seen.has(x.value) && seen.add(x.value));
});
const f = ref(blank());
const errs = ref<string[]>([]);
async function save() {
  errs.value = [];
  try { await api.createConfig({ ...f.value, maxTurns: f.value.maxTurns || undefined, provider: f.value.provider || undefined, mockSkill: f.value.runner === 'mock' ? f.value.mockSkill : undefined }); dlg.value?.close(); f.value = blank(); await reload(); }
  catch (e) { errs.value = e instanceof ApiError && e.errors.length ? e.errors : [(e as Error).message]; }
}
</script>
<template>
  <div class="page">
    <div class="page-head"><div><h1>Agent Configurations</h1><p class="muted">What is being compared. Pricing is user-supplied and used only for the cost estimate.</p></div><button class="btn primary" @click="dlg?.showModal()">＋ New configuration</button></div>
    <StateBox :loading="loading" :error="error" @retry="reload">
      <div class="grid g3"><article v-for="c in data" :key="c.id" class="card card-pad">
        <div class="row"><h2>{{ c.name }}</h2><StatusBadge :kind="c.runner === 'mock' ? 'mock' : 'info'">{{ c.runner === 'mock' ? 'mock runner' : 'real Hermes' }}</StatusBadge></div>
        <p class="muted desc">{{ c.description || 'No description.' }}</p>
        <dl><dt>Model</dt><dd class="mono">{{ c.model }}</dd><dt>Toolsets</dt><dd>{{ c.toolsets?.length ? c.toolsets.join(', ') : 'Hermes default' }}</dd><dt>Skills</dt><dd>{{ c.skills?.length ? c.skills.join(', ') : 'none' }}</dd><dt>Memory</dt><dd>{{ (c.memory ?? 'on') === 'on' ? 'on (default)' : 'off (--ignore-rules)' }}</dd><template v-if="c.maxTurns"><dt>Max turns</dt><dd class="num">{{ c.maxTurns }}</dd></template><dt>Provider</dt><dd>{{ c.provider ?? 'default' }}</dd><dt>Price / M tokens</dt><dd class="num">in ${{ c.pricing.inputPerMTok }} · out ${{ c.pricing.outputPerMTok }}</dd><template v-if="c.mock"><dt>Mock skill</dt><dd class="num">{{ c.mock.skill }}</dd></template></dl>
      </article></div>
    </StateBox>
    <dialog ref="dlg" aria-labelledby="nc"><form @submit.prevent="save"><div class="hd"><h2 id="nc">New configuration</h2></div><div class="bd">
      <div class="field"><label for="c-n">Name</label><input id="c-n" v-model="f.name" type="text" /></div>
      <div class="field"><label for="c-d">Description</label><input id="c-d" v-model="f.description" type="text" /></div>
      <div class="field"><label for="c-r">Runner</label><select id="c-r" v-model="f.runner"><option value="mock">mock (simulated, no agent run)</option><option value="hermes">hermes (local CLI)</option></select></div>
      <p v-if="cat.data.value && !cat.data.value.available" class="err-text" role="status">{{ cat.data.value.error }} You can still type custom model names; toolsets and skills lists are empty.</p>
      <div class="field"><label for="c-m">Model <span class="faint">(Hermes has no model list command: shows its configured default and models from saved configs; type to use any other)</span></label><MultiSelect id="c-m" v-model="f.model" :options="modelOpts" allow-custom placeholder="Select or type a model" :loading="cat.loading.value" /></div>
      <div class="field"><label for="c-t">Toolsets <span class="faint">(from <code>hermes tools list</code>; none selected = Hermes default; passed as --toolsets)</span></label><MultiSelect id="c-t" v-model="f.toolsets" multiple :options="toolsetOpts" placeholder="Hermes default" :loading="cat.loading.value" /></div>
      <div class="field"><label for="c-k">Skills <span class="faint">(from <code>hermes skills list</code>; passed as --skills)</span></label><MultiSelect id="c-k" v-model="f.skills" multiple :options="skillOpts" placeholder="None" :loading="cat.loading.value" /></div>
      <div class="grid g2"><div class="field"><label for="c-mem">Memory</label><select id="c-mem" v-model="f.memory"><option value="on">on (Hermes default)</option><option value="off">off (--ignore-rules)</option></select></div>
        <div class="field"><label for="c-mt">Max turns <span class="faint">(optional)</span></label><input id="c-mt" v-model.number="f.maxTurns" type="number" min="1" max="1000" /></div></div>
      <p v-if="f.memory === 'off'" class="faint" style="margin: -6px 0 12px">Hermes' --ignore-rules also skips AGENTS.md, SOUL.md, .cursorrules and preloaded skills, so "off" disables more than memory.</p>
      <div class="field"><label for="c-p">Provider <span class="faint">(optional, hermes only)</span></label><input id="c-p" v-model="f.provider" type="text" /></div>
      <div class="grid g2"><div class="field"><label for="c-i">Input $/M tokens</label><input id="c-i" v-model.number="f.inputPerMTok" type="number" min="0" step="any" /></div><div class="field"><label for="c-o">Output $/M tokens</label><input id="c-o" v-model.number="f.outputPerMTok" type="number" min="0" step="any" /></div></div>
      <div v-if="f.runner === 'mock'" class="field"><label for="c-s">Mock skill (0–1)</label><input id="c-s" v-model.number="f.mockSkill" type="number" min="0" max="1" step="0.05" /></div>
      <ul v-if="errs.length" class="err-text" role="alert"><li v-for="e in errs" :key="e">{{ e }}</li></ul>
    </div><div class="ft"><button type="button" class="btn" @click="dlg?.close()">Cancel</button><button class="btn primary">Create</button></div></form></dialog>
  </div>
</template>
<style scoped>
.desc { margin: 6px 0 12px; min-height: 40px; } dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; } dt { color: var(--text-3); } dd { margin: 0; }
.hd { padding: 14px 20px; border-bottom: 1px solid var(--border); } .bd { padding: 18px 20px; max-height: 65vh; overflow: auto; } .ft { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
</style>
