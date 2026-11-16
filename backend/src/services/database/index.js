import { SqliteDatabase } from './sqlite.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createDatabase(cfg) {
  switch (cfg.provider) {
    case 'sqlite': return assertContract('database', new SqliteDatabase(cfg.file));
    default: throw unsupportedProvider('Database', cfg.provider);   // e.g. 'postgres' for Amazon RDS
  }
}
