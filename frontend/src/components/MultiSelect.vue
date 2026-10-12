<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

export interface Option { value: string; label?: string; group?: string; hint?: string; disabled?: boolean }
const props = defineProps<{ id: string; options: Option[]; multiple?: boolean; allowCustom?: boolean; placeholder?: string; loading?: boolean }>();
/** string[] when `multiple`, otherwise a single string. */
const model = defineModel<string[] | string>({ required: true });

const root = ref<HTMLElement>();
const open = ref(false);
const q = ref('');
const selected = computed(() => (Array.isArray(model.value) ? model.value : model.value ? [model.value] : []));
const shown = computed(() => {
  const t = q.value.trim().toLowerCase();
  return props.options.filter((o) => !t || o.value.toLowerCase().includes(t) || o.label?.toLowerCase().includes(t) || o.group?.toLowerCase().includes(t));
});
const groups = computed(() => {
  const m = new Map<string, Option[]>();
  for (const o of shown.value) m.set(o.group ?? '', [...(m.get(o.group ?? '') ?? []), o]);
  return [...m.entries()];
});
const canAdd = computed(() => props.allowCustom && q.value.trim() && !props.options.some((o) => o.value === q.value.trim()) && !selected.value.includes(q.value.trim()));

function toggle(v: string) {
  if (!props.multiple) { model.value = v; open.value = false; q.value = ''; return; }
  const cur = selected.value;
  model.value = cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
}
function addCustom() { const v = q.value.trim(); if (!v) return; toggle(v); q.value = ''; }
const away = (e: Event) => { if (root.value && !root.value.contains(e.target as Node)) open.value = false; };
onMounted(() => document.addEventListener('pointerdown', away));
onBeforeUnmount(() => document.removeEventListener('pointerdown', away));
</script>
<template>
  <div ref="root" class="ms" @keydown.esc="open = false">
    <button :id="id" type="button" class="trigger" aria-haspopup="listbox" :aria-expanded="open" @click="open = !open">
      <span v-if="!selected.length" class="ph">{{ placeholder ?? 'Select…' }}</span>
      <span v-else-if="!multiple" class="mono">{{ selected[0] }}</span>
      <span v-else class="chips"><span v-for="v in selected" :key="v" class="chip">{{ v }}<span class="x" role="button" tabindex="-1" :aria-label="`Remove ${v}`" @click.stop="toggle(v)">×</span></span></span>
      <span aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="pop">
      <input v-model="q" type="text" class="srch" :aria-label="`Filter ${id}`" :placeholder="allowCustom ? 'Search or type a custom value…' : 'Search…'" @keydown.enter.prevent="canAdd ? addCustom() : undefined" />
      <div role="listbox" :aria-multiselectable="multiple" class="list">
        <p v-if="loading" class="none">Reading from Hermes…</p>
        <p v-else-if="!groups.length && !canAdd" class="none">No matches.</p>
        <template v-for="[g, opts] in groups" :key="g">
          <div v-if="g" class="grp">{{ g }}</div>
          <label v-for="o in opts" :key="o.value" class="opt" :class="{ off: o.disabled }">
            <input :type="multiple ? 'checkbox' : 'radio'" :name="id" :checked="selected.includes(o.value)" @change="toggle(o.value)" />
            <span class="mono">{{ o.value }}</span><span v-if="o.label" class="hint">{{ o.label }}</span><span v-if="o.hint" class="hint">{{ o.hint }}</span>
          </label>
        </template>
        <button v-if="canAdd" type="button" class="add" @click="addCustom">Use “{{ q.trim() }}”</button>
      </div>
      <div v-if="multiple" class="foot"><span>{{ selected.length }} selected</span><button type="button" class="lk" :disabled="!selected.length" @click="model = []">Clear</button></div>
    </div>
  </div>
</template>
<style scoped>
.ms { position: relative; }
.trigger { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; font: inherit; text-align: left; padding: 7px 10px; min-height: 38px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); background: #fff; color: var(--text); cursor: pointer; }
.trigger:focus-visible { outline: none; box-shadow: var(--focus); border-color: var(--green-500); }
.ph { color: var(--text-3); } .chips { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
.chip { display: inline-flex; align-items: center; gap: 4px; background: var(--surface-2); border: 1px solid var(--border); border-radius: 10px; padding: 1px 8px; font-size: 12.5px; } .x { cursor: pointer; color: var(--text-3); } .x:hover { color: var(--red-600); }
.pop { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 4px); background: #fff; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); box-shadow: var(--shadow-md, 0 8px 24px rgba(10, 23, 48, .16)); }
.srch { border: 0 !important; border-bottom: 1px solid var(--border) !important; border-radius: 0 !important; }
.list { max-height: 240px; overflow: auto; padding: 4px 0; }
.grp { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text-3); padding: 6px 12px 2px; font-weight: 650; }
.opt { display: flex; align-items: baseline; gap: 8px; padding: 5px 12px; cursor: pointer; font-weight: 400; } .opt:hover { background: var(--surface-2); } .opt input { width: auto; flex: none; } .opt.off { opacity: .55; }
.hint { color: var(--text-3); font-size: 12px; } .none { padding: 10px 12px; color: var(--text-3); margin: 0; }
.add { display: block; width: 100%; text-align: left; background: none; border: 0; border-top: 1px solid var(--border); padding: 8px 12px; font: inherit; font-weight: 600; color: var(--green-700); cursor: pointer; }
.foot { display: flex; justify-content: space-between; padding: 6px 12px; border-top: 1px solid var(--border); font-size: 12px; color: var(--text-3); } .lk { background: none; border: 0; font: inherit; color: var(--green-700); cursor: pointer; } .lk:disabled { opacity: .4; cursor: default; }
</style>
