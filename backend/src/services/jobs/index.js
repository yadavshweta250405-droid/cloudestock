import { LocalJobs } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createJobs(cfg, deps) {
  switch (cfg.provider) {
    case 'local': return assertContract('jobs', new LocalJobs(deps));
    default: throw unsupportedProvider('Jobs', cfg.provider);        // e.g. 'sqs'
  }
}
