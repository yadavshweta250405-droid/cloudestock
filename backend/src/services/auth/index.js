import { LocalAuth } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createAuth(cfg, deps) {
  switch (cfg.provider) {
    case 'local': return assertContract('auth', new LocalAuth({ db: deps.db, ttlHours: cfg.sessionTtlHours }));
    default: throw unsupportedProvider('Auth', cfg.provider);        // e.g. 'cognito'
  }
}
