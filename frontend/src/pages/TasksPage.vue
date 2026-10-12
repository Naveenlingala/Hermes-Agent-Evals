<script setup lang="ts">
import { computed, ref } from 'vue';
import type { GraderSpec } from '@shared';
import { ApiError, api } from '../api';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { useAsync } from '../lib/useAsync';

const { data, error, loading, reload } = useAsync(api.tasks);
const open = ref<string | null>(null);
const dlg = ref<HTMLDialogElement>();
const blankForm = () => ({ name: '', category: 'general', prompt: '', rubric: '', setup: '', criteria: '', optimal: null as number | null, elicitPlan: false });
const f = ref(blankForm());
const expTools = ref<{ tool: string; args: string }[]>([]);
const jm = ref({ stepEfficiency: false, planQuality: false, planAdherence: false, toolCalls: false });
const parseArgs = (s: string) => Object.fromEntries(s.split(',').map((p) => p.trim()).filter((p) => p.includes('=')).map((p) => [p.slice(0, p.indexOf('=')).trim(), p.slice(p.indexOf('=') + 1).trim()]).filter(([k, v]) => k && v));
const blankGrader = () => ({ type: 'contains', value: '', extra: '', required: false });
const graders = ref<{ type: string; value: string; extra: string; required: boolean }[]>([blankGrader()]);
const isTool = (t: string) => ['tool_called', 'tool_not_called', 'max_tool_calls', 'min_tool_calls'].includes(t);
const errs = ref<string[]>([]);
const busy = ref(false);
const describe = (g: GraderSpec) => g.type === 'llm_criterion' ? `LLM criterion "${g.criterion}" (needs ≥ ${g.passScore ?? 4}/5)` : g.type === 'contains' || g.type === 'not_contains' ? `${g.type} "${g.value}"` : g.type === 'regex' ? `regex /${g.pattern}/` : (g.type === 'tool_called' ? `tool_called ${g.tool}${g.argsContain ? ` (args ∋ ${g.argsContain})` : ''}` : g.type === 'tool_not_called' ? `tool_not_called ${g.tool}` : g.type === 'min_tool_calls' ? `min_tool_calls ≥ ${g.min}` : `max_tool_calls ≤ ${g.max}`) + ('required' in g && g.required ? ' · REQUIRED for pass' : '');
const label = (t: string) => (t === 'regex' ? 'Pattern' : t.startsWith('tool') ? 'Tool name (* = any)' : t === 'max_tool_calls' ? 'Max calls' : t === 'min_tool_calls' ? 'Min calls' : 'Text');
const payload = computed(() => graders.value.filter((g) => g.value.trim()).map((g, i) => {
  const id = `g${i + 1}`;
  const req = isTool(g.type) ? { required: g.required } : {};
  if (g.type === 'regex') return { id, type: g.type, pattern: g.value };
  if (g.type === 'max_tool_calls') return { id, type: g.type, max: Number(g.value), ...req };
  if (g.type === 'min_tool_calls') return { id, type: g.type, min: Number(g.value), ...req };
  if (g.type === 'tool_called') return { id, type: g.type, tool: g.value, argsContain: g.extra || undefined, ...req };
  if (g.type === 'tool_not_called') return { id, type: g.type, tool: g.value, ...req };
  return { id, type: g.type, value: g.value };
}));
async function save() {
  busy.value = true; errs.value = [];
  try {
    await api.createTask({ name: f.value.name, category: f.value.category, prompt: f.value.prompt, judgeRubric: f.value.rubric || undefined, setupPrompts: f.value.setup.split('\n').map((s) => s.trim()).filter(Boolean), graders: payload.value,
      criteria: f.value.criteria.split('\n').map((s) => s.trim()).filter(Boolean),
      expected: { tools: expTools.value.filter((t) => t.tool.trim()).map((t) => ({ tool: t.tool.trim(), args: Object.keys(parseArgs(t.args)).length ? parseArgs(t.args) : undefined })), optimalSteps: f.value.optimal || undefined },
      judgeMetrics: jm.value, elicitPlan: f.value.elicitPlan || undefined });
    dlg.value?.close(); f.value = blankForm(); expTools.value = []; jm.value = { stepEfficiency: false, planQuality: false, planAdherence: false, toolCalls: false }; graders.value = [blankGrader()]; await reload();
  } catch (e) { errs.value = e instanceof ApiError && e.errors.length ? e.errors : [(e as Error).message]; }
  busy.value = false;
}
</script>
<template>
  <div class="page">
    <div class="page-head"><div><h1>Tasks</h1><p class="muted">A prompt plus graders. Deterministic graders decide pass/fail; the optional rubric feeds the LLM judge (quality only).</p></div><button class="btn primary" @click="dlg?.showModal()">＋ New task</button></div>
    <StateBox :loading="loading" :error="error" :empty="data?.length === 0" empty-text="No tasks." @retry="reload">
      <div class="card table-wrap"><table><thead><tr><th>Task</th><th>Category</th><th>Graders</th><th>Judge</th><th></th></tr></thead><tbody>
        <template v-for="t in data" :key="t.id">
          <tr><td><strong>{{ t.name }}</strong> <StatusBadge v-if="t.seeded" kind="mock">sample</StatusBadge> <StatusBadge v-if="!t.mock" kind="info">real Hermes only</StatusBadge><div class="faint mono">{{ t.id }}</div></td><td>{{ t.category }}</td><td class="num">{{ t.graders.length }}</td><td>{{ t.judgeRubric ? 'rubric' : '—' }}</td>
            <td><button class="btn sm" :aria-expanded="open === t.id" @click="open = open === t.id ? null : t.id">{{ open === t.id ? 'Hide' : 'Details' }}</button></td></tr>
          <tr v-if="open === t.id"><td colspan="5"><p class="label">Prompt</p><pre class="mono pre">{{ t.prompt }}</pre><template v-if="t.setupPrompts?.length"><p class="label">Setup prompts <span class="faint">(run first, each in its own session; <code v-pre>{{nonce}}</code> is replaced per trial)</span></p><ol><li v-for="s in t.setupPrompts" :key="s" class="mono">{{ s }}</li></ol></template><template v-if="t.expected?.tools?.length || t.expected?.optimalSteps"><p class="label">Expected tools <span class="faint">(drive tool / argument correctness and step efficiency)</span></p><ul><li v-for="e in t.expected?.tools" :key="e.tool + JSON.stringify(e.args)" class="mono">{{ e.tool }}<span v-if="e.args"> · {{ Object.entries(e.args).map(([k, v]) => `${k} ∋ ${v}`).join(', ') }}</span></li><li v-if="t.expected?.optimalSteps" class="mono">optimal steps: {{ t.expected.optimalSteps }}</li></ul></template><p v-if="t.elicitPlan" class="faint small">Plan requested: the agent is asked to state a numbered plan first.</p><template v-if="t.judgeMetrics"><p class="label">LLM-evaluated metrics</p><p class="mono">{{ Object.keys(t.judgeMetrics).join(', ') }}</p></template><p class="label">Graders &amp; criteria</p><ul><li v-for="g in t.graders" :key="g.id"><span class="mono">{{ describe(g) }}</span> <span class="faint">— {{ g.dimension }}</span></li></ul><template v-if="t.judgeRubric"><p class="label">Judge rubric</p><p>{{ t.judgeRubric }}</p></template></td></tr>
        </template></tbody></table></div>
    </StateBox>
    <dialog ref="dlg" aria-labelledby="nt"><form @submit.prevent="save"><div class="hd"><h2 id="nt">New task</h2></div><div class="bd">
      <div class="field"><label for="t-n">Name</label><input id="t-n" v-model="f.name" type="text" /></div>
      <div class="field"><label for="t-c">Category</label><input id="t-c" v-model="f.category" type="text" /></div>
      <div class="field"><label for="t-p">Prompt</label><textarea id="t-p" v-model="f.prompt" /></div>
      <div class="field"><label for="t-s">Setup prompts <span class="faint">(optional, one per line, max 3; run first as separate Hermes sessions, e.g. to plant a fact for a memory test. Use <code v-pre>{{nonce}}</code> for a per-trial unique token in prompts and graders. Real Hermes only.)</span></label><textarea id="t-s" v-model="f.setup" /></div>
      <div class="field"><label for="t-cr">Success criteria <span class="faint">(optional, one per line, max 5; plain English, judged by an LLM from the answer and the trace, and they decide pass/fail. Use these when the outcome cannot be checked deterministically.)</span></label><textarea id="t-cr" v-model="f.criteria" placeholder="Refuses the destructive command&#10;Offers a safer alternative" /></div>
      <p class="label">Graders (deterministic, optional if you have criteria)</p>
      <div v-for="(g, i) in graders" :key="i" class="grow"><select v-model="g.type" :aria-label="`Grader ${i + 1} type`"><option v-for="t in ['contains', 'not_contains', 'regex', 'tool_called', 'tool_not_called', 'max_tool_calls', 'min_tool_calls']" :key="t">{{ t }}</option></select>
        <input v-model="g.value" type="text" :placeholder="label(g.type)" :aria-label="label(g.type)" /><input v-if="g.type === 'tool_called'" v-model="g.extra" type="text" placeholder="args contain (optional)" aria-label="Args contain" />
        <label v-if="isTool(g.type)" class="faint req"><input v-model="g.required" type="checkbox" /> required for pass</label>
        <button type="button" class="btn sm" :disabled="graders.length === 1" aria-label="Remove grader" @click="graders.splice(i, 1)">✕</button></div>
      <button type="button" class="btn sm" @click="graders.push(blankGrader())">＋ Add grader</button>
      <p class="label" style="margin-top: 14px">Expected tools <span class="faint">(optional; scores tool and argument correctness)</span></p>
      <div v-for="(e, i) in expTools" :key="i" class="grow"><input v-model="e.tool" type="text" placeholder="tool name (* = any)" :aria-label="`Expected tool ${i + 1}`" /><input v-model="e.args" type="text" placeholder="args: key=substring, key2=substring (optional)" :aria-label="`Expected args ${i + 1}`" /><button type="button" class="btn sm" aria-label="Remove expected tool" @click="expTools.splice(i, 1)">✕</button></div>
      <button type="button" class="btn sm" @click="expTools.push({ tool: '', args: '' })">＋ Add expected tool</button>
      <div class="field" style="margin-top: 10px"><label for="t-os">Optimal number of tool calls <span class="faint">(optional; caps step efficiency)</span></label><input id="t-os" v-model.number="f.optimal" type="number" min="1" max="100" /></div>
      <p class="label">Also evaluate with the LLM judge <span class="faint">(extra judge calls per run; the deterministic score is always computed)</span></p>
      <label class="faint req" style="margin: 8px 0"><input v-model="f.elicitPlan" type="checkbox" /> <span>Ask the agent to state a plan first <span class="faint">(Hermes does not plan visibly on its own, so plan quality / adherence are N/A without this. It appends "write a short numbered plan before using tools" to the prompt the agent receives, for every configuration; grading and judging use your original prompt.)</span></span></label>
      <div class="row"><label class="faint req"><input v-model="jm.stepEfficiency" type="checkbox" /> step efficiency</label><label class="faint req"><input v-model="jm.planQuality" type="checkbox" /> plan quality</label><label class="faint req"><input v-model="jm.planAdherence" type="checkbox" /> plan adherence</label><label class="faint req"><input v-model="jm.toolCalls" type="checkbox" /> tool + argument correctness (per call)</label></div>
      <div class="field" style="margin-top: 14px"><label for="t-r">Judge rubric <span class="faint">(optional)</span></label><textarea id="t-r" v-model="f.rubric" /></div>
      <ul v-if="errs.length" class="err-text" role="alert"><li v-for="e in errs" :key="e">{{ e }}</li></ul>
    </div><div class="ft"><button type="button" class="btn" @click="dlg?.close()">Cancel</button><button class="btn primary" :disabled="busy">{{ busy ? 'Saving…' : 'Create task' }}</button></div></form></dialog>
  </div>
</template>
<style scoped>
.pre { white-space: pre-wrap; background: var(--surface-2); border: 1px solid var(--border); padding: 8px 10px; border-radius: 6px; margin: 4px 0 10px; } ul { margin: 4px 0 10px; padding-left: 18px; }
.hd { padding: 14px 20px; border-bottom: 1px solid var(--border); } .bd { padding: 18px 20px; max-height: 65vh; overflow: auto; } .ft { padding: 12px 20px; border-top: 1px solid var(--border); display: flex; justify-content: flex-end; gap: 8px; }
.grow { display: grid; grid-template-columns: 150px 1fr auto; gap: 8px; margin-bottom: 8px; } .grow input:nth-of-type(2) { grid-column: 2; } .req { grid-column: 1 / -1; font-size: 12.5px; display: flex; gap: 6px; align-items: center; } @media (max-width: 620px) { .grow { grid-template-columns: 1fr auto; } .grow select { grid-column: 1 / -1; } }
</style>
