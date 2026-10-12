import type { AgentRunResult, TraceEvent } from '../domain/types';
import { hashString, mulberry32 } from '../stats/stats';
import { AgentRunner, RunRequest, estimateTokens } from './runner';

/** Which toolset provides each mock tool (mock-only assumption; real Hermes toolset names are not verified). */
const TOOLSET_OF: Record<string, string> = { terminal: 'terminal', read_file: 'file', web_search: 'web' };
const SKILL_CATEGORY: Record<string, string> = { 'math-helper': 'math', 'extraction-helper': 'extraction' };

/**
 * MOCK runner. Does not call Hermes or any model. Outcomes are drawn from a seeded PRNG
 * keyed by (task, config, trial) so results are reproducible. Latency and tokens are simulated.
 */
export class MockRunner implements AgentRunner {
  readonly kind = 'mock' as const;

  async run({ task, config, trial }: RunRequest): Promise<AgentRunResult> {
    // Optional real delay so the live progress panel is visible in demos (results are unaffected; seeded runs use 0).
    const delay = Number(process.env.MOCK_DELAY_MS ?? 0);
    if (delay > 0) await new Promise((r) => setTimeout(r, delay * (0.5 + Math.random())));
    const rnd = mulberry32(hashString(`${task.id}|${config.id}|${trial}`));
    const m = config.mock ?? { skill: 0.5, latencyMs: 4000 };
    const scenario = task.mock;
    if (!scenario) {
      return { output: '', trace: [], latencyMs: 0, inputTokens: 0, outputTokens: 0, retries: 0, simulated: true, error: `Task "${task.id}" has no mock scenario; it can only run on a real Hermes config.` };
    }
    const skill = m.overrides?.[task.id] ?? m.skill;
    // Mock-only effects of the non-model dimensions, so ablations are demonstrable:
    const toolsets = config.toolsets ?? [];
    const missingTool = toolsets.length > 0 && scenario.good.tools.some((t) => !toolsets.includes(TOOLSET_OF[t.tool] ?? t.tool));
    const skillBonus = (config.skills ?? []).some((s) => SKILL_CATEGORY[s] === task.category) ? 0.12 : 0;
    const memoryBonus = config.memory !== 'off' && ['files', 'research'].includes(task.category ?? '') ? 0.06 : 0;
    const pGood = missingTool ? 0.03 : Math.max(0.02, Math.min(0.98, skill - scenario.difficulty * 0.35 + 0.15 + skillBonus + memoryBonus));
    const good = rnd() < pGood;
    const pick = good ? scenario.good : scenario.bad;
    const retries = rnd() < 0.08 ? 1 : 0;
    const trace: TraceEvent[] = [];
    let t = 0;
    const step = () => Math.round((0.15 + rnd() * 0.35) * m.latencyMs / (pick.tools.length + 1));
    trace.push({ t, type: 'message', role: 'system', content: '[mock] simulated run; no agent was executed' });
    if (retries) { t += step(); trace.push({ t, type: 'retry', content: 'Simulated transient provider error; retried once.' }); }
    if (scenario.good.tools.length) {
      const steps = scenario.good.tools.map((tc, i) => `${i + 1}. Use ${tc.tool} to ${i === 0 ? 'get what the task needs' : 'follow up'}`);
      trace.push({ t, type: 'message', role: 'assistant', content: `[mock] Plan:\n${steps.join('\n')}\n${steps.length + 1}. Report the result` });
    }
    pick.tools.forEach((tc, i) => {
      t += step();
      const callId = `c${i + 1}`;
      trace.push({ t, type: 'tool_call', callId, tool: tc.tool, args: tc.args });
      t += step();
      trace.push({ t, type: 'tool_result', callId, content: tc.result });
    });
    t += step();
    trace.push({ t, type: 'message', role: 'assistant', content: pick.output });
    const latencyMs = Math.round(t * (0.85 + rnd() * 0.3)) + retries * 800;
    const inputTokens = estimateTokens(task.prompt) + 300 + pick.tools.length * 220;
    const outputTokens = estimateTokens(pick.output) + pick.tools.length * 40;
    return { output: pick.output, trace, latencyMs, inputTokens, outputTokens, retries, simulated: true };
  }
}
