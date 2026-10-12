import { execFile } from 'node:child_process';

export interface CatalogItem { name: string; label?: string; group?: string; enabled: boolean }
export interface Catalog {
  available: boolean; error?: string; fetchedAt: string;
  toolsets: CatalogItem[]; skills: CatalogItem[];
  /** Hermes' configured default model (from `hermes config get model`), if readable. */
  defaultModel?: string; defaultProvider?: string;
}

const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
export const stripAnsi = (s: string) => s.replace(ANSI, '');

/** Parses `hermes tools list`: lines like `  ✓ enabled  web  🔍 Web Search`, grouped under "<Group> (cli):" headers. */
export function parseToolsets(out: string): CatalogItem[] {
  const items: CatalogItem[] = []; let group = '';
  for (const raw of stripAnsi(out).split('\n')) {
    const head = /^(\S.*?)(?:\s*\([^)]*\))?:\s*$/.exec(raw);
    if (head) { group = head[1]; continue; }
    const m = /^\s*[✓✗]\s+(enabled|disabled)\s+(\S+)\s*(.*)$/.exec(raw);
    if (m && /^[A-Za-z0-9._:-]{1,60}$/.test(m[2])) items.push({ name: m[2], label: m[3].trim() || undefined, group: group || undefined, enabled: m[1] === 'enabled' });
  }
  return items;
}

/** Parses the `hermes skills list` table (│ Name │ Category │ Source │ Trust │ Status │). */
export function parseSkills(out: string): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const raw of stripAnsi(out).split('\n')) {
    if (!raw.includes('│')) continue;
    const cells = raw.split('│').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1 || false);
    const [name, category, , , status] = cells;
    if (!name || name === 'Name' || !/^[A-Za-z0-9._-]{1,60}$/.test(name)) continue;
    items.push({ name, group: category || undefined, enabled: (status ?? 'enabled').toLowerCase() === 'enabled' });
  }
  return items;
}

/** Parses `hermes config get model` ("default: X\nprovider: Y\n…"). */
export function parseModel(out: string): { model?: string; provider?: string } {
  const get = (k: string) => new RegExp(`^${k}:\\s*(\\S+)\\s*$`, 'm').exec(stripAnsi(out))?.[1];
  return { model: get('default'), provider: get('provider') };
}

type Exec = (bin: string, args: string[]) => Promise<string>;
const run: Exec = (bin, args) => new Promise((resolve, reject) => {
  // No shell; stdin closed so interactive prompts can never hang the request.
  const c = execFile(bin, args, { timeout: 15000, maxBuffer: 2_000_000, env: process.env }, (err, stdout) => (err ? reject(err) : resolve(stdout)));
  c.stdin?.end();
});

/** Reads what the local Hermes install offers. Never throws: failures become `available: false` with a reason. */
export async function readCatalog(bin = process.env.HERMES_BIN ?? 'hermes', exec: Exec = run): Promise<Catalog> {
  const base = { fetchedAt: new Date().toISOString(), toolsets: [] as CatalogItem[], skills: [] as CatalogItem[] };
  const [tools, skills, model] = await Promise.allSettled([exec(bin, ['tools', 'list']), exec(bin, ['skills', 'list']), exec(bin, ['config', 'get', 'model'])]);
  const errs = [['tools list', tools], ['skills list', skills]].flatMap(([n, r]) => ((r as PromiseSettledResult<string>).status === 'rejected' ? [`${n}: ${((r as PromiseRejectedResult).reason as Error).message.split('\n')[0]}`] : []));
  const m = model.status === 'fulfilled' ? parseModel(model.value) : {};
  const out: Catalog = {
    ...base, available: tools.status === 'fulfilled' || skills.status === 'fulfilled',
    toolsets: tools.status === 'fulfilled' ? parseToolsets(tools.value) : [], skills: skills.status === 'fulfilled' ? parseSkills(skills.value) : [],
    defaultModel: m.model, defaultProvider: m.provider,
  };
  if (errs.length) out.error = `Could not read from Hermes (${bin}): ${errs.join('; ')}`;
  return out;
}
