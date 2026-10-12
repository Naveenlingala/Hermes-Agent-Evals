import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export type Collection = 'tasks' | 'configs' | 'experiments' | 'runs';

/** Tiny document store over SQLite: one JSON blob per entity. Plenty for a local-first tool. */
@Injectable()
export class DbService implements OnModuleDestroy {
  private db: DatabaseSync;

  constructor() {
    const file = process.env.DB_FILE ?? resolve(process.cwd(), process.env.DATA_DIR ?? '.data', 'evals.sqlite');
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL, id TEXT NOT NULL, seq INTEGER NOT NULL, json TEXT NOT NULL,
        parent TEXT, PRIMARY KEY (collection, id));
      CREATE INDEX IF NOT EXISTS docs_parent ON docs (collection, parent);`);
  }

  put<T extends { id: string }>(c: Collection, doc: T, parent?: string): T {
    const seq = this.db.prepare('SELECT COALESCE(MAX(seq),0)+1 AS n FROM docs WHERE collection=?').get(c) as { n: number };
    const existing = this.db.prepare('SELECT seq FROM docs WHERE collection=? AND id=?').get(c, doc.id) as { seq: number } | undefined;
    this.db
      .prepare('INSERT OR REPLACE INTO docs (collection,id,seq,json,parent) VALUES (?,?,?,?,?)')
      .run(c, doc.id, existing?.seq ?? seq.n, JSON.stringify(doc), parent ?? null);
    return doc;
  }
  get<T>(c: Collection, id: string): T | undefined {
    const r = this.db.prepare('SELECT json FROM docs WHERE collection=? AND id=?').get(c, id) as { json: string } | undefined;
    return r ? (JSON.parse(r.json) as T) : undefined;
  }
  list<T>(c: Collection, parent?: string): T[] {
    const rows = (parent === undefined
      ? this.db.prepare('SELECT json FROM docs WHERE collection=? ORDER BY seq')
          .all(c)
      : this.db.prepare('SELECT json FROM docs WHERE collection=? AND parent=? ORDER BY seq').all(c, parent)) as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as T);
  }
  count(c: Collection): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM docs WHERE collection=?').get(c) as { n: number }).n;
  }
  /** Deletes every document in every collection. */
  clear(): number {
    return Number(this.db.prepare('DELETE FROM docs').run().changes);
  }
  onModuleDestroy() { this.db.close(); }
}
