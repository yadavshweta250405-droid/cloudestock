import { LocalStorage } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createStorage(cfg) {
  switch (cfg.provider) {
    case 'local': return assertContract('storage', new LocalStorage(cfg.dir));
    default: throw unsupportedProvider('Storage', cfg.provider);    // e.g. 's3'
  }
}
