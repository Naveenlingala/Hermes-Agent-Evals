// `npm run judge:eval` — calibrate the LLM judge against a labelled golden set (see backend/src/grading/judge-golden.ts).
//   --repeats N (default 3)   --model ID (default JUDGE_MODEL or claude-haiku-5-5)   --yes (skip cost prompt)   --mock (self-test the harness with the keyword mock judge, no API calls)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from './env-file.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
if (existsSync(join(root, '.env'))) for (const [k, v] of parseEnv(readFileSync(join(root, '.env'), 'utf8'))) if (process.env[k] === undefined) process.env[k] = v;

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
if (!existsSync(join(root, 'node_modules'))) spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
if (spawnSync(npm, ['run', 'build', '-w', 'backend'], { cwd: root, stdio: 'ignore' }).status !== 0) { console.error('✕ backend build failed'); process.exit(1); }

const { AnthropicJudge, MockJudge } = await import(join(root, 'backend/dist/grading/judge.js'));
const { GOLDEN, GOLDEN_TOOL_CALLS } = await import(join(root, 'backend/dist/grading/judge-golden.js'));
const { evaluateJudge, THRESHOLDS } = await import(join(root, 'backend/dist/grading/judge-eval.js'));

const repeats = Math.max(1, Math.min(10, Number(opt('--repeats', 3)) || 3));
const model = opt('--model', process.env.JUDGE_MODEL ?? 'claude-haiku-5-5');
let judge;
if (flag('--mock')) judge = new MockJudge();
else if (process.env.ANTHROPIC_API_KEY) judge = new AnthropicJudge(process.env.ANTHROPIC_API_KEY, model, undefined, process.env.ANTHROPIC_WORKSPACE_ID || undefined);
else { console.error('✕ ANTHROPIC_API_KEY is not set (run `npm run start:real` to save it, or export it). Use --mock to self-test the harness without API calls.'); process.exit(1); }

const calls = (GOLDEN.length + GOLDEN_TOOL_CALLS.length) * repeats;
console.log(`Judge under test: ${judge.mode} / ${judge.model}\nGolden cases: ${GOLDEN.length} scored + ${GOLDEN_TOOL_CALLS.length} per-call × ${repeats} repeats = ${calls} judge calls${judge.mode === 'anthropic' ? ' (real, billed API calls; roughly 400-600 input tokens each)' : ' (mock; free)'}`);
if (judge.mode === 'anthropic' && !flag('--yes')) {
  if (!process.stdin.isTTY) { console.error('Non-interactive: pass --yes to confirm the spend.'); process.exit(1); }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question('Proceed? [y/N] ')).trim().toLowerCase(); rl.close();
  if (!a.startsWith('y')) process.exit(0);
}

const report = await evaluateJudge(judge, GOLDEN, { repeats, toolCallCases: GOLDEN_TOOL_CALLS, onProgress: (d, t) => { if (process.stdout.isTTY) process.stdout.write(`\r  ${d}/${t} calls`); } });
console.log('\n');
const cats = report.metrics.meanByCategory;
console.log('Mean score by category (1-5):', Object.entries(cats).map(([k, v]) => `${k} ${v === null ? 'n/a' : v.toFixed(2)}`).join(' · '));
console.log('Agreement by judge kind:', Object.entries(report.metrics.byKind).map(([k, v]) => `${k} ${(v.inBandRate * 100).toFixed(0)}% (n=${v.n})`).join(' · '));
if (report.metrics.toolCalls) console.log(`Per-call tool/argument verdicts: ${(report.metrics.toolCalls.accuracy * 100).toFixed(0)}% correct, ${(report.metrics.toolCalls.schemaValidRate * 100).toFixed(0)}% schema-valid (n=${report.metrics.toolCalls.n})`);
console.log(`Judge tokens used: ${report.metrics.usage.input} in / ${report.metrics.usage.output} out\n`);
console.log('Per case (scores across repeats; ✗ = outside expected band):');
for (const c of report.cases) {
  const bad = c.scores.some((s) => s < c.expected.min || s > c.expected.max) || c.errors.length;
  console.log(`  ${bad ? '✗' : '✓'} ${c.id.padEnd(24)} ${c.category.padEnd(9)} expect ${c.expected.min}-${c.expected.max}  got [${c.scores.join(', ')}]${c.errors.length ? `  ERRORS: ${[...new Set(c.errors)].join('; ').slice(0, 120)}` : ''}`);
}
console.log('\nChecks:');
for (const k of report.checks) console.log(`  ${k.passed ? '✓ PASS' : '✕ FAIL'}  ${k.name}: ${k.value} (needs ${k.threshold})`);
const dir = join(root, process.env.DATA_DIR ?? '.data'); mkdirSync(dir, { recursive: true });
const file = join(dir, `judge-eval-${judge.model.replace(/[^\w.-]/g, '_')}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(file, JSON.stringify({ ...report, thresholds: THRESHOLDS, goldenSize: GOLDEN.length, at: new Date().toISOString() }, null, 2));
console.log(`\nOverall: ${report.passed ? 'CALIBRATED against this golden set' : 'NOT calibrated — do not trust its scores yet'}${judge.mode === 'mock' ? '  (mock judge: the harness is working if this says NOT calibrated)' : ''}\nFull report (incl. judge evidence): ${file}`);
process.exit(report.passed ? 0 : 2);
