// Minimal .env reader/updater. Preserves comments and unrelated lines; never logs values.
export function parseEnv(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    if (/^".*"$/.test(v)) v = v.slice(1, -1).replace(/\\(["\\])/g, '$1');
    else if (/^'.*'$/.test(v)) v = v.slice(1, -1);
    out.set(m[1], v);
  }
  return out;
}

const quote = (v) => {
  if (/[\r\n]/.test(v)) throw new Error('value must be a single line');
  return /^[A-Za-z0-9_./:@+=-]*$/.test(v) ? v : `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/** Sets KEY=value, replacing an existing assignment (commented-out ones are left alone). */
export function upsertEnv(text, key, value) {
  const line = `${key}=${quote(value)}`;
  const re = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=.*$`, 'm');
  if (re.test(text)) return text.replace(re, () => line);
  return text + (text === '' || text.endsWith('\n') ? '' : '\n') + line + '\n';
}
