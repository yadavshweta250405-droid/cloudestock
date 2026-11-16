// Applies every database/migrations/*.sql file that has not been applied yet. Usage: npm run db:migrate
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate(db, log = console) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set(db.all('SELECT name FROM schema_migrations').map((r) => r.name));
  const applied = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.run('INSERT INTO schema_migrations(name, applied_at) VALUES(?,?)', [file, new Date().toISOString()]);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw new Error(`Migration ${file} failed: ${e.message}`); }
    applied.push(file);
    log.log?.(`  applied ${file}`);
  }
  return applied;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('../backend/src/config.js');
  const { createDatabase } = await import('../backend/src/services/database/index.js');
  const cfg = loadConfig();
  const db = createDatabase(cfg.db);
  console.log(`Migrating ${cfg.db.file}`);
  const applied = migrate(db);
  console.log(applied.length ? `Done: ${applied.length} migration(s) applied.` : 'Database already up to date.');
  db.close();
}
