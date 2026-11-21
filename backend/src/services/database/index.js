import { SqliteDatabase } from './sqlite.js';
import { PostgresDatabase } from './postgres.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createDatabase(cfg) {
  switch (cfg.provider) {
    case 'sqlite': return assertContract('database', new SqliteDatabase(cfg.file));
    case 'postgres': return assertContract('database', new PostgresDatabase(cfg));
    default: throw unsupportedProvider('Database', cfg.provider);   // e.g. 'postgres' for Amazon RDS
  }
}
