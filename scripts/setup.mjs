// `npm run start:real` — verify/install everything for REAL Hermes runs, save keys to .env, smoke-test, then start.
//   Flags: --yes (non-interactive: accept install + smoke test; secrets are never prompted)  --no-smoke
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv, upsertEnv } from './env-file.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
const YES = process.argv.includes('--yes');
const NO_SMOKE = process.argv.includes('--no-smoke');
const TTY = !!(process.stdin.isTTY && process.stdout.isTTY);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const INSTALL_URL = 'https://hermes-agent.nousresearch.com/install.sh';
const step = (m) => console.log(`\n▸ ${m}`);
const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);
const die = (m) => { console.error(`\n✕ ${m}`); process.exit(1); };

async function ask(q, def = '') {
  if (!TTY) return def;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${q} `)).trim();
  rl.close();
  return a || def;
}
async function confirm(q, def = true) {
  if (YES) return true;
  if (!TTY) return false;
  const a = (await ask(`${q} [${def ? 'Y/n' : 'y/N'}]`)).toLowerCase();
  return a === '' ? def : a.startsWith('y');
}
function askSecret(q) { // input is not echoed
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin;
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let buf = '';
    const done = (v) => { stdin.setRawMode(false); stdin.pause(); stdin.off('data', on); process.stdout.write('\n'); resolve(v); };
    const on = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') return done(buf.trim());
        if (c === '\u0003') { stdin.setRawMode(false); process.exit(130); }
        if (c === '\u007f' || c === '\b') buf = buf.slice(0, -1);
        else if (c >= ' ') buf += c;
      }
    };
    stdin.on('data', on);
  });
}

// .env helpers: values are saved with mode 600 and never printed.
const readEnvText = () => (existsSync(envPath) ? readFileSync(envPath, 'utf8') : '');
function saveEnv(key, value) {
  writeFileSync(envPath, upsertEnv(readEnvText(), key, value), { mode: 0o600 });
  chmodSync(envPath, 0o600);
  process.env[key] = value;
}

// 1. Node ------------------------------------------------------------------
step('Checking Node.js');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) die(`Node >= 22.13 is required (found ${process.versions.node}).`);
ok(`Node ${process.versions.node}`);

// 2. Dependencies ----------------------------------------------------------
step('Checking project dependencies');
if (!existsSync(join(root, 'node_modules'))) {
  const r = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) die('npm install failed');
}
ok('npm dependencies present');

// Load existing .env into this process (real environment wins).
for (const [k, v] of parseEnv(readEnvText())) if (process.env[k] === undefined) process.env[k] = v;

// 3. Hermes ----------------------------------------------------------------
step('Checking Hermes Agent');
const probe = (bin) => { const r = spawnSync(bin, ['--version'], { encoding: 'utf8' }); return r.status === 0 ? (r.stdout || '').split('\n')[0].trim() : null; };
const candidates = () => [process.env.HERMES_BIN, 'hermes', join(homedir(), '.local', 'bin', 'hermes')].filter(Boolean);
function findHermes() {
  for (const bin of candidates()) { const v = probe(bin); if (v) return { bin, version: v }; }
  return null;
}
let hermes = findHermes();
if (!hermes) {
  warn('Hermes was not found.');
  if (process.platform === 'win32') die(`Install Hermes manually in PowerShell:  iex (irm https://hermes-agent.nousresearch.com/install.ps1)  — then re-run. (Windows is untested here.)`);
  if (!(await confirm(`Download and run the official installer from ${INSTALL_URL}? It installs Python, Node, ripgrep, ffmpeg and Hermes under ~/.hermes.`))) {
    die('Hermes is required for real runs. Install it (see README) or use `npm start` for the mock demo.');
  }
  const res = await fetch(INSTALL_URL);
  if (!res.ok) die(`Could not download the installer (HTTP ${res.status}).`);
  const body = Buffer.from(await res.arrayBuffer());
  if (body.length > 2_000_000 || !body.subarray(0, 2).equals(Buffer.from('#!'))) die('Downloaded installer does not look like a shell script; aborting.');
  const file = join(mkdtempSync(join(tmpdir(), 'hermes-install-')), 'install.sh');
  writeFileSync(file, body, { mode: 0o700 });
  console.log(`  Saved installer to ${file}\n  sha256 ${createHash('sha256').update(body).digest('hex')} (${body.length} bytes) — inspect it if you wish.`);
  const r = spawnSync('bash', [file], { stdio: 'inherit' });
  if (r.status !== 0) die('The Hermes installer failed.');
  hermes = findHermes();
  if (!hermes) die('Installer finished but `hermes` is not on PATH. Open a new shell (or `source ~/.zshrc`), or set HERMES_BIN in .env, then re-run.');
}
ok(`${hermes.version}  (${hermes.bin})`);
if (hermes.bin !== 'hermes' && hermes.bin !== process.env.HERMES_BIN) saveEnv('HERMES_BIN', hermes.bin);
process.env.HERMES_BIN = hermes.bin;

// 4. Backend build (needed by the smoke test and the server) ---------------
step('Building backend');
if (spawnSync(npm, ['run', 'build', '-w', 'backend'], { cwd: root, stdio: 'inherit' }).status !== 0) die('Backend build failed.');

// 5. Credentials + smoke test ----------------------------------------------
const PROVIDER_KEYS = ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY'];
const { HermesRunner } = await import(join(root, 'backend/dist/runner/hermes.runner.js'));

async function smoke() {
  console.log('  Running one tiny prompt through the same adapter the platform uses (a few tokens)...');
  const r = await new HermesRunner(hermes.bin, 120_000).run({ task: { id: 'smoke', prompt: 'Reply with exactly the single word: ok' }, config: { model: 'default', toolsets: [], skills: [], memory: 'on' }, trial: 1 });
  const types = [...new Set((r.raw ?? '').split('\n').map((l) => { try { return JSON.parse(l).type; } catch { return null; } }).filter(Boolean))];
  console.log(`  events: ${types.join(', ') || 'none'} · ${r.latencyMs}ms · tokens in/out ${r.inputTokens}/${r.outputTokens}`);
  if (!r.error && r.output.trim()) { ok(`Hermes answered: "${r.output.trim().slice(0, 60)}"`); return true; }
  warn(r.error ?? 'Hermes returned no output');
  return false;
}

if (NO_SMOKE) warn('Skipping Hermes smoke test (--no-smoke).');
else if (!(await confirm('Verify Hermes with one tiny test prompt (makes a real model call if Hermes is connected)?'))) warn('Skipped smoke test.');
else {
  step('Verifying Hermes end to end');
  let good = await smoke();
  while (!good && TTY) {
    console.log('\n  Hermes is not usable yet. Choose how to connect it:');
    console.log('   1) Use Hermes\' own setup (`hermes model`; the free Nous tier needs no API key)');
    console.log(`   2) Save a provider API key in .env (${PROVIDER_KEYS.join(', ')}, or other)`);
    console.log('   3) Skip (start the app anyway)');
    const c = await ask('  Choice [1/2/3]:', '3');
    if (c === '1') spawnSync(hermes.bin, ['model'], { stdio: 'inherit' });
    else if (c === '2') {
      const name = (await ask(`  Environment variable name [${PROVIDER_KEYS[0]}]:`, PROVIDER_KEYS[0])).toUpperCase();
      if (!/^[A-Z][A-Z0-9_]{2,60}$/.test(name)) { warn('Not a valid variable name.'); continue; }
      const value = await askSecret(`  ${name} (input hidden): `);
      if (!value) { warn('Nothing entered.'); continue; }
      saveEnv(name, value);
      ok(`Saved ${name} to .env (mode 600, git-ignored).`);
    } else break;
    good = await smoke();
  }
  if (!good) warn('Continuing without a verified Hermes. Real runs will show the failure; the mock demo still works.');
}

// 6. Optional LLM judge key ---------------------------------------------------
if (!process.env.ANTHROPIC_API_KEY && TTY && !YES) {
  step('Optional: LLM judge');
  console.log('  Real runs can be scored for quality by an Anthropic model. Without a key a clearly-labelled mock judge is used.');
  const v = await askSecret('  ANTHROPIC_API_KEY (input hidden; Enter to skip): ');
  if (v) {
    saveEnv('ANTHROPIC_API_KEY', v); ok('Saved ANTHROPIC_API_KEY to .env.');
    if (!process.env.ANTHROPIC_WORKSPACE_ID) {
      const ws = await ask('  Workspace ID (only needed if your key is not scoped to a workspace; Enter to skip):');
      if (ws) { saveEnv('ANTHROPIC_WORKSPACE_ID', ws); ok('Saved ANTHROPIC_WORKSPACE_ID to .env.'); }
    }
  }
}
ok(`Judge: ${process.env.ANTHROPIC_API_KEY && process.env.JUDGE_MODE !== 'mock' ? 'Anthropic (real runs only; mock-runner output always uses the mock judge)' : 'mock judge'}`);

// 7. Start -----------------------------------------------------------------
step('Starting the platform');
await import('./start.mjs');
