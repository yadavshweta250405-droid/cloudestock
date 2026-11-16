import { createDatabase } from './services/database/index.js';
import { createStorage } from './services/storage/index.js';
import { createAuth } from './services/auth/index.js';
import { createEvents } from './services/events/index.js';
import { createNotifications } from './services/notifications/index.js';
import { createJobs } from './services/jobs/index.js';
import { createSync } from './services/sync/index.js';
import { migrate } from '../../database/migrate.js';
import { nowIso } from './core/util.js';

import * as authModule from './modules/auth.js';
import * as inventoryModule from './modules/inventory.js';
import * as ordersModule from './modules/orders.js';
import * as deliveriesModule from './modules/deliveries.js';
import * as receivingModule from './modules/receiving.js';
import * as tasksModule from './modules/tasks.js';
import * as employeesModule from './modules/employees.js';
import * as warehouseModule from './modules/warehouse.js';
import * as dashboardModule from './modules/dashboard.js';
import * as miscModule from './modules/misc.js';

const MODULES = {
  auth: authModule, inventory: inventoryModule, orders: ordersModule, deliveries: deliveriesModule, receiving: receivingModule,
  tasks: tasksModule, employees: employeesModule, warehouse: warehouseModule, dashboard: dashboardModule, misc: miscModule,
};

const silent = process.env.WARETRACK_QUIET === '1';
export const defaultLogger = {
  info: (...a) => { if (!silent) console.log(...a); },
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};

/** Builds the application container: infrastructure services (swappable) + domain services (business logic). */
export function createContainer(config, { log = defaultLogger } = {}) {
  const ctx = { config, log, svc: {} };
  ctx.db = createDatabase(config.db);
  migrate(ctx.db, { log: () => {} });
  ctx.events = createEvents(config.events);
  ctx.storage = createStorage(config.storage);
  ctx.auth = createAuth(config.auth, { db: ctx.db });
  ctx.notifications = createNotifications(config.notifications, { db: ctx.db, events: ctx.events });
  ctx.jobs = createJobs(config.jobs, { log });
  ctx.sync = createSync(config.sync, {
    storage: ctx.storage, events: ctx.events, jobs: ctx.jobs, log,
    collect: () => ctx.svc.dashboard.snapshot(),
  });

  // Activity log (inside the same DB transaction as the change it describes)
  ctx.activity = {
    log(user, action, entityType, entityId, message, meta) {
      ctx.db.run(
        'INSERT INTO activity_logs(user_id, user_name, action, entity_type, entity_id, message, meta, created_at) VALUES(?,?,?,?,?,?,?,?)',
        [user?.id ?? null, user?.name ?? 'System', action, entityType ?? null, entityId ?? null, message, meta ? JSON.stringify(meta) : null, nowIso()],
      );
    },
  };

  // Coalesced "something changed" signal -> browsers refresh the 3D scene and open panels.
  let pending = new Set(); let timer = null;
  ctx.changed = (...scopes) => {
    scopes.forEach((s) => pending.add(s));
    if (timer) return;
    timer = setTimeout(() => { const s = [...pending]; pending = new Set(); timer = null; ctx.events.publish('changed', { scopes: s }); }, 40);
    timer.unref?.();
  };

  for (const [name, mod] of Object.entries(MODULES)) ctx.svc[name] = mod.createService(ctx);

  ctx.registerRoutes = (router) => { for (const mod of Object.values(MODULES)) mod.registerRoutes(router, ctx); };
  ctx.startBackground = () => {
    for (const mod of Object.values(MODULES)) mod.startJobs?.(ctx);
    ctx.sync.start();
  };
  ctx.close = () => { ctx.jobs.stop(); ctx.db.close(); };
  return ctx;
}
