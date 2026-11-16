import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const bind = (params) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));

/** Local database implementation (Node's built-in SQLite). Synchronous, so a transaction can never interleave with another request. */
export class SqliteDatabase {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.file = file;
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
    this.depth = 0;
    this.cache = new Map();
  }
  prepare(sql) {
    let s = this.cache.get(sql);
    if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); }
    return s;
  }
  all(sql, params = []) { return this.prepare(sql).all(...bind(params)).map((r) => ({ ...r })); }
  get(sql, params = []) { const r = this.prepare(sql).get(...bind(params)); return r ? { ...r } : null; }
  run(sql, params = []) {
    const r = this.prepare(sql).run(...bind(params));
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }
  exec(sql) { this.db.exec(sql); }
  /** Runs fn atomically. Nested calls join the outer transaction. */
  transaction(fn) {
    if (this.depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ }
      throw err;
    } finally { this.depth--; }
  }
  close() { this.cache.clear(); this.db.close(); }
}
