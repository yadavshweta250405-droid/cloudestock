import { LocalStorage } from './local.js';
import { S3Storage } from './s3.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createStorage(cfg) {
  switch (cfg.provider) {
    case 'local': return assertContract('storage', new LocalStorage(cfg.dir));
    case 's3': return assertContract('storage', new S3Storage(cfg));
    default: throw unsupportedProvider('Storage', cfg.provider);    // e.g. 's3'
  }
}
