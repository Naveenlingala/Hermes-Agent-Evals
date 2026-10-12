// Deletes the local SQLite data so the next start re-seeds the demo from scratch.
import { rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, process.env.DATA_DIR ?? '.data');
if (!dir.startsWith(root + '/')) { console.error(`Refusing to delete ${dir}: outside the repository.`); process.exit(1); }
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}`);
