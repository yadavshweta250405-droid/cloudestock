import { LocalNotifications } from './local.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createNotifications(cfg, deps) {
  switch (cfg.provider) {
    case 'local': return assertContract('notifications', new LocalNotifications(deps));
    default: throw unsupportedProvider('Notifications', cfg.provider);   // e.g. 'sns'
  }
}
