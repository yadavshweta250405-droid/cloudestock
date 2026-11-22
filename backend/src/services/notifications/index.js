import { LocalNotifications } from './local.js';
import { SnsNotifications } from './sns.js';
import { assertContract, unsupportedProvider } from '../contracts.js';

export function createNotifications(cfg, deps) {
  switch (cfg.provider) {
    case 'local': return assertContract('notifications', new LocalNotifications(deps));
    case 'sns': return assertContract('notifications', new SnsNotifications(cfg, deps));
    default: throw unsupportedProvider('Notifications', cfg.provider);   // e.g. 'sns'
  }
}
