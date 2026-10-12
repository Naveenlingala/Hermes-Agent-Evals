// One-command launcher: install deps if needed, build, start the backend (which also serves the UI), wait until healthy.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dev = process.argv.includes('--dev');
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 13)) {
  console.error(`Node >= 22.13 is required (found ${process.versions.node}); the backend uses the built-in node:sqlite.`);
  process.exit(1);
}
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const sh = (args, label) => {
  console.log(`\n▸ ${label}`);
  const r = spawnSync(npm, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✕ ${label} failed`); process.exit(r.status ?? 1); }
};

if (!existsSync(join(root, 'node_modules'))) sh(['install', '--no-audit', '--no-fund'], 'Installing dependencies');
sh(['run', 'build', '-w', 'backend'], 'Building backend');
if (!dev) sh(['run', 'build', '-w', 'frontend'], 'Building frontend');

const envFile = existsSync(join(root, '.env')) ? ['--env-file=.env'] : [];
const port = Number(process.env.PORT ?? 3000);
const children = [];
const backend = spawn(process.execPath, [...envFile, 'backend/dist/main.js'], { cwd: root, stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
children.push(backend);
backend.on('exit', (code) => { console.error(`\nBackend exited (code ${code}).`); stop(code ?? 1); });

function stop(code = 0) {
  for (const c of children) if (!c.killed) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
}
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// Readiness: the UI is only announced once the API (and demo seeding) answers.
const url = `http://127.0.0.1:${port}`;
const deadline = Date.now() + 90_000;
for (;;) {
  try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* not up yet */ }
  if (Date.now() > deadline) { console.error('✕ Backend did not become healthy within 90s'); stop(1); await new Promise(() => {}); }
  await new Promise((r) => setTimeout(r, 400));
}
if (dev) {
  const vite = spawn(npm, ['run', 'dev', '-w', 'frontend'], { cwd: root, stdio: 'inherit' });
  children.push(vite);
  console.log(`\n✓ API ready on ${url}; Vite dev server on http://localhost:5173`);
} else {
  console.log(`\n✓ Agent Evals is ready: ${url}\n  Stop with Ctrl+C.`);
}
