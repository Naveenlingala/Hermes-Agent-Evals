// `npm stop` — stops this project's launcher + backend processes (only ones whose working directory is this repo).
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') { console.error('npm stop is not supported on Windows; press Ctrl+C in the terminal running the app.'); process.exit(1); }
const root = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'));
const out = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8' }).stdout ?? '';
const cwdOf = (pid) => { const l = out('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).split('\n').find((x) => x.startsWith('n')); try { return l ? realpathSync(l.slice(1)) : null; } catch { return null; } };

const candidates = new Set(out('pgrep', ['-f', 'scripts/(start|setup)\\.mjs|backend/dist/main\\.js']).split('\n').filter(Boolean).map(Number));
const port = process.env.PORT ?? '3000';
for (const p of out('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN']).split('\n').filter(Boolean).map(Number)) candidates.add(p);
candidates.delete(process.pid); candidates.delete(process.ppid);
const mine = [...candidates].filter((pid) => cwdOf(pid) === root);
if (!mine.length) { console.log('Nothing of this project is running.'); process.exit(0); }
for (const pid of mine) { try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ } }
await new Promise((r) => setTimeout(r, 1500));
const left = mine.filter((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } });
for (const pid of left) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
console.log(`Stopped ${mine.length} process(es)${left.length ? ` (${left.length} needed SIGKILL)` : ''}.`);
