import { LocalEvents } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createEvents(cfg) {
  switch (cfg.provider) {
    case 'local': return assertContract('events', new LocalEvents());
    default: throw unsupportedProvider('Events', cfg.provider);     // e.g. 'apigw-websocket', 'eventbridge'
  }
}
