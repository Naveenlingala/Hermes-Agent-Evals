import { spawn } from 'node:child_process';
import type { AgentConfig, AgentRunResult, TraceEvent } from '../domain/types';
import { AgentRunner, RunRequest, estimateTokens } from './runner';

/**
 * Parses `hermes chat --format stream-json` output.
 * Documented (hermes-agent.nousresearch.com/docs/reference/cli-commands): JSONL, one object per line with an
 * epoch-ms `timestamp`; event types system|text|tool_use|tool_result|result; `result` is terminal and carries
 * `exit_code`, `text` and token counts. Verified against Hermes v0.21.7 (init + result events, no-provider failure):
 * result has `tokens:{input,output,...}`, `duration_ms`, `error`. NOT yet observed: tool_use/tool_result field names,
 * which are read defensively from several candidate names.
 */
export function parseHermesStream(stdout: string, startedAt: number): Omit<AgentRunResult, 'latencyMs' | 'simulated'> {
  const trace: TraceEvent[] = [];
  let text = '';
  let segment = ''; // assistant text since the last tool call (stream deltas)
  let finalText: string | undefined;
  let inputTokens = 0, outputTokens = 0;
  let error: string | undefined;
  let sawResult = false;
  let n = 0;
  const first = (o: any, keys: string[]) => keys.map((k) => o?.[k]).find((v) => v !== undefined);
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; } // ignore non-JSON noise
    const t = typeof ev.timestamp === 'number' ? Math.max(0, ev.timestamp - startedAt) : 0;
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') trace.push({ t, type: 'message', role: 'system', content: `Hermes init: model=${ev.model ?? 'unknown'} session=${ev.session_id ?? 'unknown'}` });
        break;
      case 'text': { const d = String(ev.text ?? ev.delta ?? ev.content ?? ''); text += d; segment += d; break; }
      case 'tool_use':
        // Narration before a call (often the plan) becomes its own assistant message so trajectory metrics can see it.
        if (segment.trim()) trace.push({ t, type: 'message', role: 'assistant', content: segment.trim() });
        segment = '';
        trace.push({ t, type: 'tool_call', callId: String(first(ev, ['id', 'tool_use_id', 'call_id']) ?? `c${++n}`), tool: String(first(ev, ['name', 'tool', 'tool_name']) ?? 'unknown'), args: first(ev, ['input', 'arguments', 'args']) ?? {} });
        break;
      case 'tool_result': {
        const c = first(ev, ['content', 'output', 'result']);
        trace.push({ t, type: 'tool_result', callId: String(first(ev, ['tool_use_id', 'id', 'call_id']) ?? `c${n}`), content: typeof c === 'string' ? c : JSON.stringify(c ?? ''), isError: ev.is_error === true });
        break;
      }
      case 'result': {
        sawResult = true;
        if (typeof ev.text === 'string') finalText = ev.text;
        // Observed with Hermes v0.21.7: tokens: {input, output, total, cache_read, cache_write}
        const u = ev.tokens ?? ev.usage ?? ev;
        inputTokens = Number(first(u, ['input', 'input_tokens', 'prompt_tokens']) ?? 0) || 0;
        outputTokens = Number(first(u, ['output', 'output_tokens', 'completion_tokens']) ?? 0) || 0;
        if (ev.exit_code !== undefined && ev.exit_code !== 0) error = `Hermes reported exit_code ${ev.exit_code}${typeof ev.error === 'string' ? `: ${ev.error}` : ''}`;
        else if (typeof ev.error === 'string' && ev.error) error = `Hermes error: ${ev.error}`;
        break;
      }
    }
  }
  if (!sawResult) error = error ?? 'Hermes stream ended without a terminal "result" event';
  const output = finalText ?? (segment || text);
  if (text || finalText) trace.push({ t: trace.at(-1)?.t ?? 0, type: 'message', role: 'assistant', content: output });
  return { output, trace, inputTokens, outputTokens, retries: 0, error, raw: stdout.slice(0, 200000) };
}

/** Builds Hermes CLI args from a config. All flags are documented in the Hermes CLI reference. */
export function buildHermesArgs(config: Pick<AgentConfig, 'provider' | 'toolsets' | 'skills' | 'memory' | 'maxTurns'>): string[] {
  const args = ['chat', '--format', 'stream-json', '--query-file', '-'];
  if (config.provider) args.push('--provider', config.provider);
  if (config.toolsets?.length) args.push('--toolsets', config.toolsets.join(','));
  if (config.skills?.length) args.push('--skills', config.skills.join(','));
  if (config.maxTurns) args.push('--max-turns', String(config.maxTurns));
  if (config.memory === 'off') args.push('--ignore-rules');
  return args;
}

/** 'default' (or empty) means: do not override; use the model Hermes itself is configured with. */
export function hermesModelEnv(model: string | undefined): Record<string, string> {
  return model && model !== 'default' ? { HERMES_INFERENCE_MODEL: model } : {};
}

/** REAL runner: shells out to the Hermes CLI without a shell. The prompt goes via stdin (`--query-file -`). */
export class HermesRunner implements AgentRunner {
  readonly kind = 'hermes' as const;
  constructor(private bin = process.env.HERMES_BIN ?? 'hermes', private timeoutMs = Number(process.env.HERMES_TIMEOUT_MS ?? 300000)) {}

  /** Runs setup prompts (each its own Hermes session) and then the task prompt; metrics are summed, output is the task prompt's. */
  async run(req: RunRequest): Promise<AgentRunResult> {
    const steps = req.task.setupPrompts ?? [];
    if (!steps.length) return this.runOnce(req.task.prompt, req);
    const trace: TraceEvent[] = [];
    let offset = 0, inTok = 0, outTok = 0, retries = 0, raw = '';
    const absorb = (r: AgentRunResult, label: string) => {
      trace.push({ t: offset, type: 'message', role: 'system', content: `— ${label} —` });
      for (const e of r.trace) trace.push({ ...e, t: e.t + offset });
      offset += r.latencyMs; inTok += r.inputTokens; outTok += r.outputTokens; retries += r.retries;
      raw += `# ${label}\n${r.raw ?? ''}\n`;
    };
    for (let i = 0; i < steps.length; i++) {
      const r = await this.runOnce(steps[i], req);
      absorb(r, `setup step ${i + 1}/${steps.length}: ${steps[i].slice(0, 80)}`);
      if (r.error) return { output: '', trace, latencyMs: offset, inputTokens: inTok, outputTokens: outTok, retries, simulated: false, error: `Setup step ${i + 1} failed: ${r.error}`, raw };
    }
    const main = await this.runOnce(req.task.prompt, req);
    absorb(main, 'task prompt');
    return { ...main, trace, latencyMs: offset, inputTokens: inTok, outputTokens: outTok, retries, raw };
  }

  private runOnce(prompt: string, { task, config }: RunRequest): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const args = buildHermesArgs(config);
    const env = { ...process.env, ...hermesModelEnv(config.model) };
    const fail = (msg: string, stdout = ''): AgentRunResult => ({
      output: '', trace: [{ t: Date.now() - startedAt, type: 'error', content: msg }], latencyMs: Date.now() - startedAt,
      inputTokens: 0, outputTokens: 0, retries: 0, simulated: false, error: msg, raw: stdout.slice(0, 20000),
    });
    return new Promise((resolve) => {
      let stdout = '', stderr = '';
      const child = spawn(this.bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(fail(`Hermes timed out after ${this.timeoutMs}ms`, stdout)); }, this.timeoutMs);
      child.on('error', (e) => { clearTimeout(timer); resolve(fail(`Could not start "${this.bin}": ${e.message}. Is Hermes installed and on PATH (or HERMES_BIN set)?`)); });
      child.stdout.on('data', (d) => { if (stdout.length < 2_000_000) stdout += d; });
      child.stderr.on('data', (d) => { if (stderr.length < 20000) stderr += d; });
      child.on('close', (code) => {
        clearTimeout(timer);
        const parsed = parseHermesStream(stdout, startedAt);
        const latencyMs = Date.now() - startedAt;
        let error = parsed.error;
        if (code !== 0 && !error) error = `Hermes exited with code ${code}`;
        if (error && stderr.trim()) error += ` — stderr: ${stderr.trim().slice(0, 300)}`;
        const inTok = parsed.inputTokens || estimateTokens(prompt);
        const outTok = parsed.outputTokens || estimateTokens(parsed.output);
        resolve({ ...parsed, error, latencyMs, inputTokens: inTok, outputTokens: outTok, simulated: false });
      });
      child.stdin.on('error', () => { /* process may have exited early */ });
      child.stdin.end(prompt);
    });
  }
}
