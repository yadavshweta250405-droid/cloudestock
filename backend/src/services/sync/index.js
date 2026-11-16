import { LocalSync } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createSync(cfg, deps) {
  switch (cfg.provider) {
    case 'local': return assertContract('sync', new LocalSync({ cfg, ...deps }));
    default: throw unsupportedProvider('Sync', cfg.provider);        // e.g. 'lambda'
  }
}
