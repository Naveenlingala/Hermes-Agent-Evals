<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { api } from '../api';
import StateBox from '../components/StateBox.vue';
import StatusBadge from '../components/StatusBadge.vue';
import TraceTimeline from '../components/TraceTimeline.vue';
import { ms, pct, tokens, usd, when } from '../lib/format';
import { useAsync } from '../lib/useAsync';

const id = useRoute().params.id as string;
const { data: run, error, loading, reload } = useAsync(() => api.run(id));
const tiles = computed(() => {
  const m = run.value?.metrics;
  if (!m) return [];
  const completion = { value: m.taskCompletion, source: 'deterministic' as const, deterministic: m.taskCompletion, llm: null, reason: undefined };
  return [
    { key: 'taskCompletion', level: 'trajectory', label: 'Task completion', m: completion, def: 'Mean score of the success graders (deterministic checks and LLM criteria). Pass/fail is decided by those graders.' },
    { key: 'stepEfficiency', level: 'trajectory', label: 'Step efficiency', m: m.stepEfficiency, def: '1 - (repeated identical + errored tool calls)/calls, capped by optimal steps when the task sets them; or the LLM rating when enabled.' },
    { key: 'planQuality', level: 'trajectory', label: 'Plan quality', m: m.planQuality, def: 'LLM rating of whether the plan was logical, complete and efficient. N/A without a plan.' },
    { key: 'planAdherence', level: 'trajectory', label: 'Plan adherence', m: m.planAdherence, def: 'LLM rating of whether the executed calls followed the plan. N/A without a plan.' },
    { key: 'toolCorrectness', level: 'component', label: 'Tool correctness', m: m.toolCorrectness, def: 'F1 of expected tools used vs used tools that were expected; or the share of calls the LLM judged to use the right tool.' },
    { key: 'argumentCorrectness', level: 'component', label: 'Argument correctness', m: m.argumentCorrectness, def: 'Share of expected argument matchers satisfied; or the share of calls the LLM judged to have correct arguments.' },
  ];
});
const failedTools = computed(() => run.value?.grades.filter((g) => !g.passed && g.config.tool).map((g) => String(g.config.tool)) ?? []);
</script>
<template>
  <div class="page">
    <StateBox :loading="loading" :error="error" @retry="reload">
      <template v-if="run">
        <nav class="faint crumbs" aria-label="Breadcrumb"><RouterLink to="/experiments">Experiments</RouterLink> / <RouterLink :to="`/experiments/${run.experimentId}`">Experiment</RouterLink> / Run</nav>
        <div class="page-head"><div><h1>{{ run.taskSnapshot.name }}</h1>
          <div class="row"><StatusBadge :kind="run.passed ? 'pass' : 'fail'">{{ run.passed ? 'Passed' : 'Failed' }}</StatusBadge>
            <StatusBadge :kind="run.runner === 'mock' ? 'mock' : 'info'">{{ run.runner === 'mock' ? 'mock runner — simulated, no agent executed' : 'real Hermes' }}</StatusBadge>
            <StatusBadge v-if="run.taskSnapshot.elicitPlan" kind="info">plan requested</StatusBadge>
            <span class="muted">{{ run.configSnapshot.name }} · trial {{ run.trial }} · {{ when(run.startedAt) }}</span></div></div></div>

        <section v-if="!run.passed" class="card fail-box" role="alert"><h2>Why this run failed</h2>
          <ul><li v-for="(r, i) in run.failureReasons" :key="i">{{ r }}</li></ul>
          <a v-if="run.result.trace.length" href="#trace" class="btn sm">Jump to trace</a></section>

        <div class="grid g4 sec">
          <div class="card card-pad"><span class="faint">Latency{{ run.result.simulated ? ' (simulated)' : '' }}</span><strong class="big num">{{ ms(run.result.latencyMs) }}</strong></div>
          <div class="card card-pad"><span class="faint">Tokens{{ run.result.simulated ? ' (estimated)' : '' }}</span><strong class="big num">{{ tokens(run.result.inputTokens + run.result.outputTokens) }}</strong><span class="faint small num">{{ tokens(run.result.inputTokens) }} in · {{ tokens(run.result.outputTokens) }} out</span></div>
          <div class="card card-pad"><span class="faint">Estimated cost</span><strong class="big num">{{ usd(run.costUsd) }}</strong></div>
          <div class="card card-pad"><span class="faint">Retries / errors</span><strong class="big num">{{ run.result.retries }} / {{ run.result.error ? 1 : 0 }}</strong></div>
        </div>

        <div class="grid g2 sec">
          <section class="card"><div class="card-head"><h2>Task</h2></div><div class="card-pad"><pre class="mono txt">{{ run.taskSnapshot.prompt }}</pre></div></section>
          <section class="card"><div class="card-head"><h2>Final agent output</h2></div><div class="card-pad"><pre v-if="run.result.output" class="mono txt">{{ run.result.output }}</pre><p v-else class="muted">No output was produced.</p></div></section>
        </div>

        <section class="card sec"><div class="card-head"><h2>Grader scores &amp; explanations</h2><span class="faint">task success {{ run.passed ? 'met' : 'not met' }} · tool score {{ pct(run.toolScore) }} · quality {{ pct(run.quality) }}</span></div>
          <div class="table-wrap"><table><thead><tr><th>Result</th><th>Grader</th><th>Dimension</th><th>Score</th><th>Evidence</th></tr></thead><tbody>
            <tr v-for="g in run.grades" :key="g.graderId"><td><StatusBadge :kind="g.error ? 'warn' : g.passed ? 'pass' : 'fail'">{{ g.error ? 'error' : g.passed ? 'pass' : 'fail' }}</StatusBadge></td>
              <td><span class="mono">{{ g.graderId }}</span><div class="faint small">{{ g.type }} · {{ g.version }}</div></td><td>{{ g.dimension }}</td><td class="num">{{ pct(g.score) }}</td>
              <td>{{ g.evidence }}<div v-if="g.error" class="err-text small">{{ g.error }}</div>
                <div v-if="g.judge" class="small"><StatusBadge :kind="g.judge.mode === 'mock' ? 'mock' : 'info'">judge: {{ g.judge.mode === 'mock' ? 'mock' : g.judge.model }}</StatusBadge></div>
                <details class="small"><summary>Grader config &amp; input</summary><pre class="mono txt">{{ JSON.stringify(g.config, null, 2) }}
— examined —
{{ g.input }}</pre></details>
                <a v-if="g.type.startsWith('tool') || g.type === 'max_tool_calls'" href="#trace" class="small">View trace</a></td></tr></tbody></table></div></section>

        <section v-if="run.metrics" id="metrics" class="card sec"><div class="card-head"><h2>Trajectory &amp; component metrics</h2><span class="faint">N/A means "could not be computed", never 0</span></div>
          <div class="grid g3 tiles"><div v-for="t in tiles" :key="t.key" class="tile" :title="t.def"><span class="faint small">{{ t.level }} metric</span><strong>{{ t.label }}</strong><span class="big num">{{ t.m.value === null ? 'N/A' : pct(t.m.value) }}</span>
            <span class="row"><StatusBadge v-if="t.m.source" :kind="t.m.source === 'llm' ? (run.runner === 'mock' ? 'mock' : 'info') : 'neutral'">{{ t.m.source === 'llm' ? (run.runner === 'mock' ? 'LLM metric · mock judge' : 'LLM judge') : 'deterministic' }}</StatusBadge></span>
            <span v-if="t.m.source === 'llm' && t.m.deterministic !== null" class="faint small">deterministic: {{ pct(t.m.deterministic) }}</span><span v-if="t.m.value === null" class="faint small">{{ t.m.reason }}</span></div></div>
          <div v-if="run.metrics.plan" class="card-pad"><p class="label">Plan <span class="faint">(extracted from {{ run.metrics.plan.source === 'tool' ? 'a todo/plan tool call' : 'assistant narration before the first tool call' }})</span></p><pre class="mono txt">{{ run.metrics.plan.text }}</pre></div>
          <div v-if="run.metrics.calls.length" class="table-wrap"><table><thead><tr><th>#</th><th>Tool call</th><th>Tool</th><th>Arguments</th><th>Flags</th><th>LLM evidence</th></tr></thead><tbody>
            <tr v-for="c in run.metrics.calls" :key="c.index"><td class="num">{{ c.index + 1 }}</td>
              <td><a :href="`#ev-${c.eventIndex}`"><code class="mono">{{ c.tool }}</code></a><div class="mono faint small args">{{ JSON.stringify(c.args) }}</div></td>
              <td><StatusBadge v-if="c.toolOk !== null" :kind="c.toolOk ? 'pass' : 'fail'">{{ c.toolOk ? 'expected' : 'unexpected' }}</StatusBadge><span v-else class="faint">—</span><div v-if="c.llmToolOk !== undefined" class="small"><StatusBadge :kind="c.llmToolOk ? 'pass' : 'fail'">LLM: {{ c.llmToolOk ? 'right tool' : 'wrong tool' }}</StatusBadge></div></td>
              <td><StatusBadge v-if="c.argsOk !== null" :kind="c.argsOk ? 'pass' : 'fail'">{{ c.argsOk ? 'match' : 'mismatch' }}</StatusBadge><span v-else class="faint">—</span><div v-if="c.llmArgsOk !== undefined" class="small"><StatusBadge :kind="c.llmArgsOk ? 'pass' : 'fail'">LLM: {{ c.llmArgsOk ? 'args ok' : 'args wrong' }}</StatusBadge></div></td>
              <td><StatusBadge v-if="c.redundant" kind="warn">repeated</StatusBadge> <StatusBadge v-if="c.errored" kind="fail">errored</StatusBadge><span v-if="!c.redundant && !c.errored" class="faint">—</span></td>
              <td class="small muted">{{ c.evidence ?? '' }}</td></tr></tbody></table></div>
          <p v-else class="card-pad muted">No tool calls were made, so per-call metrics do not apply.</p></section>

        <section id="trace" class="card sec"><div class="card-head"><h2>Execution timeline</h2><span class="faint">{{ run.result.trace.length }} events · agent output is shown as untrusted plain text</span></div><TraceTimeline :events="run.result.trace" :highlight-tools="failedTools" /></section>

        <section class="card sec"><div class="card-head"><h2>Run configuration</h2></div><div class="card-pad"><pre class="mono txt">{{ JSON.stringify(run.configSnapshot, null, 2) }}</pre></div></section>
      </template>
    </StateBox>
  </div>
</template>
<style scoped>
.crumbs { margin-bottom: 8px; font-size: 13px; } .sec { margin-top: 16px; } .small { font-size: 12px; } .big { display: block; font-size: 26px; letter-spacing: -0.02em; }
.tile { padding: 16px 20px; display: grid; gap: 4px; border-right: 1px solid var(--border); border-bottom: 1px solid var(--border); align-content: start; } .args { max-width: 340px; overflow-wrap: anywhere; } .tiles { gap: 0; }
.txt { margin: 0; white-space: pre-wrap; word-break: break-word; } .fail-box { padding: 16px 20px; background: var(--red-100); border-color: #f6c2bd; } .fail-box ul { margin: 8px 0 12px; padding-left: 20px; }
details summary { cursor: pointer; color: var(--text-2); }
</style>
